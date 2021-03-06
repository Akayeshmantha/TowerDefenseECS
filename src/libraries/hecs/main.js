//
// App Boilerplate
//

const { World, System, EntityId, Read, Write, SparseArrayComponentStorage } = require("hecs");

const THREE = require("three");
const App = require("../../app.js");
const Scene = require("../../three-scene.js");

const APP = new App();
const scene = new Scene(update, APP.perfMode);

//
// ECS Setup
//

const world = new World();

//
// Components
//

class Velocity {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}
world.registerComponent(Velocity, new SparseArrayComponentStorage());

class Gravity {
  constructor() {
    this.force = -9.8;
  }
}
world.registerComponent(Gravity);

class Mesh {
  constructor(mesh) {
    this.mesh = mesh;
  }
}
world.registerComponent(Mesh, new SparseArrayComponentStorage());

class Collider {
  constructor(collider, collides = null) {
    this.collider = collider;
    this.collides = collides;
    this.collided = null;
    this.offsetCollider = new THREE.Box3();
  }
}
world.registerComponent(Collider, new SparseArrayComponentStorage());

class Explosive {
  constructor(destructible = true) {
    this.destructible = destructible;
  }
}
world.registerComponent(Explosive, new SparseArrayComponentStorage());

class ToRemove {}
world.registerComponent(ToRemove);

class Enemy {}
world.registerComponent(Enemy, new SparseArrayComponentStorage());

class Projectile {}
world.registerComponent(Projectile);

class Turret {
  constructor(firingRate = 1 / 2) {
    this.firingRate = firingRate;
    this.timeUntilFire = 1 / this.firingRate;
  }
}
world.registerComponent(Turret);

class Vehicle {
  constructor(onboard) {
    this.speed = 1;
    this.onboard = onboard;
  }
}
world.registerComponent(Vehicle);

class Collector {
  constructor() {
    this.rate = 20;
  }
}
world.registerComponent(Collector);

//
// Systems
//

function update() {
  world.update();
}

class GravitySystem extends System {
  setup() {
    return {
      entities: world.createQuery(Write(Velocity), Read(Gravity))
    };
  }
  update() {
    for (const [velocity, gravity] of this.ctx.entities) {
      velocity.y += gravity.force * scene.delta;
    }
  }
}

class VelocitySystem extends System {
  setup() {
    return {
      entities: world.createQuery(Read(Mesh), Read(Velocity))
    };
  }
  update() {
    for (const [mesh, velocity] of this.ctx.entities) {
      mesh.mesh.position.x += velocity.x * scene.delta;
      mesh.mesh.position.y += velocity.y * scene.delta;
      mesh.mesh.position.z += velocity.z * scene.delta;
    }
  }
}

class CollisionSystem extends System {
  constructor() {
    super();
  }
  setup() {
    return {
      entities: world.createQuery(Write(Collider), Read(Mesh)),
      e1: world.createQuery(Write(Collider), EntityId, Read(Mesh)),
      e2: world.createQuery(Write(Collider), EntityId, Read(Mesh))
    };
  }
  update() {
    for (const [collider, mesh] of this.ctx.entities) {
      collider.collided = null;
      mesh.mesh.updateMatrixWorld();
      scene.updateBox(collider.offsetCollider, collider.collider, mesh.mesh.matrixWorld);
    }
    let i = 0;
    for (const [c1, e1] of this.ctx.e1) {
      let j = 0;
      for (const [c2, e2] of this.ctx.e2) {
        if (j > i && (c1.collides === null || world.hasComponent(e2, c1.collides))) {
          if (c1.offsetCollider.intersectsBox(c2.offsetCollider)) {
            c1.collided = e2;
            c2.collided = e1;
          }
        }
        j++;
      }
      i++;
    }
  }
}

class ExplosiveSystem extends System {
  setup() {
    return {
      entities: world.createQuery(EntityId, Write(Collider), Read(Explosive), Read(Mesh))
    };
  }
  update() {
    for (const [entity, collider, explosive, mesh] of this.ctx.entities) {
      const { collided } = collider;
      const explosiveBelowFloor = mesh.mesh.position.y <= -0.5;
      if (explosiveBelowFloor || (collided && explosive.destructible)) {
        world.addComponent(entity, new ToRemove());
      }
      if (collided) {
        world.addComponent(collider.collided, new ToRemove());
      }
    }
  }
}

class OnboardRemover extends System {
  setup() {
    return {
      entities: world.createQuery(Read(Vehicle), Read(ToRemove))
    };
  }
  update() {
    for (const [vehicle] of this.ctx.entities) {
      world.addComponent(vehicle.onboard, new ToRemove());
    }
  }
}

class MeshRemover extends System {
  setup() {
    return {
      entities: world.createQuery(EntityId, Read(Mesh), Read(ToRemove))
    };
  }
  update() {
    for (const [entity, mesh] of this.ctx.entities) {
      mesh.mesh.parent.remove(mesh.mesh);
      world.destroyEntity(entity);
    }
  }
}

class ResourceSystem extends System {
  constructor(entities) {
    super(entities);
  }
  setup() {
    return {
      entities: world.createQuery(Read(Collector))
    };
  }
  update() {
    let power = 0;
    for (const [collector] of this.ctx.entities) {
      power += collector.rate * scene.delta;
    }
    APP.updatePower(power);
  }
}

class PlacementSystem extends System {
  constructor() {
    super();
    this.worldPosition = new THREE.Vector3();
    this.placementValid = false;
    this.factories = {
      mine: createMine,
      turret: createTurret,
      vehicle: createTurretVehicle,
      collector: createCollector
    };
    APP.onCreate = (itemName, cost, e) => {
      scene.updatePointer(e);
      this.updatePlacement();
      if (!this.placementValid) return;
      let item = this.factories[itemName]();
      APP.updatePower(-cost);
      const mesh = world.getImmutableComponent(item, Mesh);
      mesh.mesh.position.copy(scene.placeholder.position);
    };
  }
  setup() {
    return {
      entities: world.createQuery(EntityId, Read(Mesh))
    };
  }
  update() {
    this.updatePlacement();
  }
  updatePlacement() {
    this.placementValid = !APP.currentItem.input.disabled;
    let x, z;
    const intersection = scene.getIntersection();
    if (intersection) {
      x = Math.round(intersection.point.x);
      z = Math.round(intersection.point.z);
      for (const [entity, mesh] of this.ctx.entities) {
        mesh.mesh.getWorldPosition(this.worldPosition);
        const [ex, ez] = [Math.round(this.worldPosition.x), Math.round(this.worldPosition.z)];
        if (!world.hasComponent(entity, Projectile) && x === ex && z === ez) {
          this.placementValid = false;
        }
      }
    } else {
      this.placementValid = false;
    }
    scene.updatePlacement(APP.deviceSupportsHover && this.placementValid, x, z);
  }
}

class TurretSystem extends System {
  setup() {
    return {
      entities: world.createQuery(Write(Turret), Read(Mesh))
    };
  }
  update() {
    for (const [turret, mesh] of this.ctx.entities) {
      turret.timeUntilFire -= scene.delta;
      if (turret.timeUntilFire <= 0) {
        const projectile = createProjectile();
        const projectileMesh = world.getImmutableComponent(projectile, Mesh);
        mesh.mesh.getWorldPosition(projectileMesh.mesh.position);
        turret.timeUntilFire = 1 / turret.firingRate;
      }
    }
  }
}

class VehicleSystem extends System {
  setup() {
    return {
      entities: world.createQuery(Write(Vehicle), Read(Mesh))
    };
  }
  update() {
    for (const [vehicle, mesh] of this.ctx.entities) {
      const { position } = mesh.mesh;
      if (Math.abs(position.x) >= 2) {
        position.x = Math.sign(position.x) * 2;
        vehicle.speed *= -1;
      }
      position.x += vehicle.speed * scene.delta;
    }
  }
}

class EnemyWaveSystem extends System {
  constructor() {
    super();
    this.currentWave = APP.waves[0];
  }
  setup() {
    return null;
  }
  update() {
    const currentWave = APP.getCurrentWave(scene.elapsed);
    if (currentWave === this.currentWave) return;
    this.currentWave = currentWave;
    this.generateWave(currentWave);
  }
  generateWave(wave) {
    if (!wave) return;
    const occupied = {};
    for (let i = 0; i < wave.enemies; i++) {
      const enemy = createEnemy();
      const lane = THREE.Math.randInt(-2, 2);
      const mesh = world.getImmutableComponent(enemy, Mesh);
      mesh.mesh.position.x = lane;
      occupied[lane] = occupied[lane] === undefined ? 0 : occupied[lane] - 2;
      mesh.mesh.position.z = occupied[lane] - 5;
    }
  }
}

class GameOverSystem extends System {
  constructor(enemyWaveSystem) {
    super();
    this.enemyWaveSystem = enemyWaveSystem;
    this.tempBox = new THREE.Box3();
    this.collider = new THREE.Box3();
    this.collider.setFromCenterAndSize(new THREE.Vector3(0, 0, 6), new THREE.Vector3(5, 1, 1));
  }
  setup() {
    return {
      entities: world.createQuery(Read(Collider), Read(Mesh), Read(Enemy))
    };
  }
  update() {
    if (this.ctx.entities.isEmpty() && !this.enemyWaveSystem.currentWave) {
      scene.stop();
      APP.setInfo("You Win!");
      return;
    }
    for (const [collider, mesh] of this.ctx.entities) {
      scene.updateBox(this.tempBox, collider.collider, mesh.mesh.matrixWorld);
      if (this.tempBox.intersectsBox(this.collider)) {
        scene.stop();
        APP.setInfo("Game Over");
        break;
      }
    }
  }
}

world.registerSystem(new GravitySystem());
world.registerSystem(new VelocitySystem());
world.registerSystem(new CollisionSystem());
world.registerSystem(new ExplosiveSystem());
world.registerSystem(new OnboardRemover());
world.registerSystem(new MeshRemover());
world.registerSystem(new ResourceSystem());
world.registerSystem(new PlacementSystem());
world.registerSystem(new TurretSystem());
world.registerSystem(new VehicleSystem());
const enemyWaveSystem = new EnemyWaveSystem();
world.registerSystem(enemyWaveSystem);
if (!APP.perfMode) {
  world.registerSystem(new GameOverSystem(enemyWaveSystem));
}

//
// Entity factories
//

function createEnemy() {
  const entity = world.createEntity();
  world.addComponent(entity, new Enemy());
  const mesh = scene.createBox("green");
  world.addComponent(entity, new Mesh(mesh));
  world.addComponent(entity, new Velocity(0, 0, 1.5));
  world.addComponent(entity, new Collider(new THREE.Box3().setFromObject(mesh)));
  world.addComponent(entity, new Explosive(false));
  scene.add(mesh);
  return entity;
}

function createMine() {
  const entity = world.createEntity();
  const mesh = scene.createBox("red");
  world.addComponent(entity, new Mesh(mesh));
  world.addComponent(entity, new Collider(new THREE.Box3().setFromObject(mesh), Enemy));
  world.addComponent(entity, new Explosive());
  scene.add(mesh);
  return entity;
}

function createProjectile() {
  const entity = world.createEntity();
  world.addComponent(entity, new Projectile());
  const mesh = scene.createBox("red", 0.2);
  world.addComponent(entity, new Mesh(mesh));
  world.addComponent(entity, new Collider(new THREE.Box3().setFromObject(mesh), Enemy));
  world.addComponent(entity, new Explosive());
  world.addComponent(entity, new Gravity());
  world.addComponent(entity, new Velocity(0, 0, -20));
  scene.add(mesh);
  return entity;
}

function createTurret(withCollider = true, firingRate) {
  const entity = world.createEntity();
  world.addComponent(entity, new Turret(firingRate));
  const mesh = scene.createBox("blue");
  world.addComponent(entity, new Mesh(mesh));
  if (withCollider) {
    world.addComponent(entity, new Collider(new THREE.Box3().setFromObject(mesh), Enemy));
  }
  scene.add(mesh);
  return entity;
}

function createTurretVehicle() {
  const turret = createTurret(false, 1);
  const turretMesh = world.getImmutableComponent(turret, Mesh);
  turretMesh.mesh.position.y = 0.5;

  const entity = world.createEntity();
  world.addComponent(entity, new Vehicle(turret));
  const mesh = scene.createBox("yellow", 0.9);
  mesh.add(turretMesh.mesh);
  world.addComponent(entity, new Mesh(mesh));
  world.addComponent(entity, new Collider(new THREE.Box3().setFromObject(mesh), Enemy));

  scene.add(mesh);
  return entity;
}

function createCollector() {
  const entity = world.createEntity();
  world.addComponent(entity, new Collector());
  const mesh = scene.createBox("orange");
  world.addComponent(entity, new Mesh(mesh));
  world.addComponent(entity, new Collider(new THREE.Box3().setFromObject(mesh), Enemy));
  scene.add(mesh);
  return entity;
}

if (APP.perfMode) {
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      const turret = createTurretVehicle();
      const turretMesh = world.getImmutableComponent(turret, Mesh);
      turretMesh.mesh.position.set(i - 2, 0, j + 2);
    }
  }
}
