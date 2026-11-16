// The player's arsenal: weapon state, fire timing, spread, recoil, reload and the
// procedural viewmodel. The raycast itself lives in combat.js; this module decides
// when a shot may happen and how wild it is, then hands the shot off.
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { clamp } from './util.js';

export function createWeapons(camera, audio) {
  const state = {
    owned: { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } },
    current: 'pistol',
    cooldown: 0,
    reloading: false,
    reloadTimer: 0,
    scoped: false,
    grenades: { frag: 0, smoke: 0 },
    grenadeSelected: null, // 'frag' | 'smoke' | null
    spreadBloom: 0, // grows while firing, decays while idle
  };

  // Procedural viewmodel: a proper rifle built from boxes, parented to the
  // camera. One build, reconfigured per weapon: the sniper carries a scope,
  // the shotgun a pump, the SMG a suppressor, the pistol no stock.
  const gun = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.7 });
  const gunAccent = new THREE.MeshStandardMaterial({ color: 0x8a6a2f, roughness: 0.5, metalness: 0.6 });
  const gunDark = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.55, metalness: 0.5 });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.34), gunMat);
  receiver.position.set(0, 0, 0.08);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.18), gunDark);
  stock.position.set(0, -0.02, 0.32);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.3), gunDark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), gunMat);
  const muzzleBrake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.08), gunAccent);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.1), gunAccent);
  grip.position.set(0, -0.12, 0.16);
  grip.rotation.x = 0.35;
  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.06, 0.015), gunAccent);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), gunAccent);
  rearSight.position.set(0, 0.085, 0.05);
  const dotSight = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4444 }),
  );
  dotSight.position.set(0, 0.095, -0.02);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), gunMat);
  mag.position.set(0, -0.12, 0);
  mag.rotation.x = 0.25;
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 12), gunDark);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.11, -0.12);
  const scopeLens = new THREE.Mesh(
    new THREE.CircleGeometry(0.028, 12),
    new THREE.MeshBasicMaterial({ color: 0x1a3a5a }),
  );
  scopeLens.position.set(0, 0.11, -0.245);
  scopeLens.rotation.y = Math.PI;
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.18), gunAccent);
  const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 12), gunDark);
  suppressor.rotation.x = Math.PI / 2;
  gun.add(receiver, stock, handguard, barrel, muzzleBrake, grip, frontSight, rearSight, dotSight, mag, scope, scopeLens, pump, suppressor);
  gun.position.set(0.26, -0.24, -0.5);
  camera.add(gun);

  const muzzle = new THREE.Object3D();
  gun.add(muzzle);

  const bobPhase = { value: 0 };
  let kick = 0;
  let reloadDip = 0;

  function currentDef() {
    return WEAPONS[state.current];
  }

  function give(id) {
    const def = WEAPONS[id];
    if (!state.owned[id]) state.owned[id] = { mag: def.mag, reserve: def.reserve };
  }

  function buy(id) {
    give(id);
    return true;
  }

  function select(id) {
    if (!state.owned[id]) return false;
    if (state.current === id) return true;
    state.current = id;
    state.grenadeSelected = null;
    state.reloading = false;
    state.cooldown = 0.25;
    state.scoped = false;
    updateViewmodel();
    return true;
  }

  function cycle(dir) {
    const ids = Object.keys(state.owned);
    const idx = ids.indexOf(state.current);
    const next = ids[(idx + dir + ids.length) % ids.length];
    select(next);
  }

  function updateViewmodel() {
    const def = currentDef();
    const len = def.id === 'sniper' ? 0.78 : def.id === 'shotgun' ? 0.66 : def.id === 'smg' ? 0.52 : def.id === 'rifle' ? 0.62 : 0.36;
    const front = -0.09; // front face of the receiver
    const hg = Math.max(0.06, len - 0.3); // handguard length
    handguard.scale.z = hg / 0.3;
    handguard.position.set(0, 0.01, front - hg / 2);
    barrel.position.set(0, 0.02, front - hg - 0.09);
    muzzleBrake.position.set(0, 0.02, front - hg - 0.21);
    muzzle.position.set(0, 0.02, front - hg - 0.3);
    frontSight.position.set(0, 0.09, front - hg + 0.05);
    const isSniper = def.id === 'sniper';
    scope.visible = isSniper;
    scopeLens.visible = isSniper;
    dotSight.visible = !isSniper;
    frontSight.visible = !isSniper;
    pump.visible = def.id === 'shotgun';
    if (pump.visible) pump.position.set(0, -0.075, front - hg / 2);
    suppressor.visible = def.id === 'smg';
    if (suppressor.visible) suppressor.position.set(0, 0.02, front - hg - 0.11);
    stock.visible = def.id !== 'pistol';
    gun.visible = true;
  }

  function spread(moving, airborne, crouched) {
    const def = currentDef();
    let s = def.spread + state.spreadBloom;
    if (moving) s += def.spreadMove;
    if (airborne) s += 0.03;
    if (crouched) s *= 0.7;
    if (state.scoped) s *= 0.25;
    return s;
  }

  function canFire() {
    const def = currentDef();
    const ammo = state.owned[state.current];
    return !state.reloading && state.cooldown <= 0 && ammo.mag > 0 && def;
  }

  function fire() {
    const def = currentDef();
    const ammo = state.owned[state.current];
    if (!canFire()) return null;
    ammo.mag -= 1;
    state.cooldown = 1 / def.rate;
    state.spreadBloom = Math.min(0.05, state.spreadBloom + def.recoil * 0.55);
    kick = Math.min(0.09, kick + def.kick * 0.02);
    return { def, ammo };
  }

  function reload() {
    const def = currentDef();
    const ammo = state.owned[state.current];
    if (state.reloading || ammo.mag === def.mag || ammo.reserve <= 0) return false;
    state.reloading = true;
    state.reloadTimer = def.reload;
    state.scoped = false;
    audio.reload();
    return true;
  }

  function toggleScope() {
    const def = currentDef();
    if (!def.scoped || state.reloading) return false;
    state.scoped = !state.scoped;
    audio.scope();
    return state.scoped;
  }

  function step(dt, moving) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.spreadBloom = Math.max(0, state.spreadBloom - dt * 0.09);
    kick = Math.max(0, kick - dt * 0.35);
    if (state.reloading) {
      state.reloadTimer -= dt;
      reloadDip = Math.min(1, reloadDip + dt * 5);
      if (state.reloadTimer <= 0) {
        const def = currentDef();
        const ammo = state.owned[state.current];
        const need = def.mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
        state.reloading = false;
      }
    } else {
      reloadDip = Math.max(0, reloadDip - dt * 5);
    }
    // Viewmodel bob and kick, all from the same clock.
    if (moving > 0.5) bobPhase.value += dt * moving * 1.9;
    const bobY = Math.sin(bobPhase.value * 2) * 0.008 * Math.min(1, moving / 4);
    const bobX = Math.cos(bobPhase.value) * 0.006 * Math.min(1, moving / 4);
    gun.position.set(
      0.26 + bobX + (state.scoped ? -0.26 : 0),
      -0.24 + bobY - reloadDip * 0.14 + (state.scoped ? 0.155 : 0),
      -0.5 + kick + (state.scoped ? -0.12 : 0),
    );
    gun.rotation.x = kick * 2.2 + reloadDip * 0.5;
  }

  function muzzleWorld(out) {
    return muzzle.getWorldPosition(out);
  }

  function reset() {
    state.owned = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
    state.current = 'pistol';
    state.cooldown = 0;
    state.reloading = false;
    state.scoped = false;
    state.grenades = { frag: 0, smoke: 0 };
    state.grenadeSelected = null;
    state.spreadBloom = 0;
    updateViewmodel();
  }

  updateViewmodel();
  return {
    state, gun, muzzle,
    currentDef, give, buy, select, cycle, spread, canFire, fire, reload,
    toggleScope, step, muzzleWorld, reset,
  };
}
