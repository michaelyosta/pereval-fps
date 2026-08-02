// ============================================================
//  ОПЕРАЦИЯ «ПЕРЕВАЛ» — ядро игры (движок, ввод, игрок, цикл)
//  Three.js r160 · ES modules · контракт GAME (g)
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const $ = (s) => document.querySelector(s);
const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has('demo');

// ---------- ошибки на экран (для отладки) ----------
window.addEventListener('error', (e) => {
  const el = $('#err');
  el.style.display = 'block';
  el.textContent = 'ERR: ' + (e.message || e);
});

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// защита от потери контекста (чёрный экран при фоне/глюке драйвера)
renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  if (typeof g !== 'undefined' && g.renderer) { g.renderer.render(g.scene, g.camera); }
}, false);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // мягкая полутень через shadow.radius
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 500);
camera.rotation.order = 'YXZ';

// корень viewmodel-оружия (ребёнок камеры)
const viewRoot = new THREE.Object3D();
camera.add(viewRoot);
scene.add(camera);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.6, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// кинематографичное зерно плёнки (после тон-маппинга)
const GrainShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0.05 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float amount; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float g = (rnd(vUv * vec2(1920.0, 1080.0) + vec2(time, time * 0.7)) - 0.5) * amount;
      gl_FragColor = vec4(c.rgb + g, 1.0);
    }`
};
const grainPass = new ShaderPass(GrainShader);
composer.addPass(grainPass);

// ---------- контракт GAME ----------
const g = {
  renderer, scene, camera, composer, viewRoot,
  demo: DEMO,
  noLock: false,          // fallback: игра без захвата мыши (если pointer lock недоступен)
  clock: new THREE.Clock(),
  input: {
    forward: 0, strafe: 0, sprint: false, fire: false, ads: false,
    reload: false, jump: false, lookDX: 0, lookDY: 0
  },
  state: {
    health: 100, maxHealth: 100, alive: true,
    kills: 0, ammo: 30, reserve: 120, magSize: 30, weaponName: 'ОБЛОМОК-7',
    reloading: false, time: 0, paused: true
  },
  events: { onEnemyHit: null, onPlayerDamage: null, onShoot: null },
  recoil: { pitch: 0, y: 0 },
  ads: { amount: 0 },          // 0..1 плавное прицеливание
  player: {
    pos: new THREE.Vector3(0, 1.62, 14),   // позиция глаза
    vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    onGround: true, bobPhase: 0, bobSpeed: 0, moveSpeed: 0,
    spawn: new THREE.Vector3(0, 1.62, 14)
  },
  staticGroup: null,           // заполняет world.js (стены, ящики, земля)
  demoTime: 0
};
window.g = g; // доступ из консоли

// ---------- загрузка модулей (устойчивая к ошибкам) ----------
const mods = {};
async function loadMod(name, url) {
  try { mods[name] = await import(url); return true; }
  catch (e) { console.error('MODULE FAIL:', name, e); return false; }
}

// ---------- ввод ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyR') g.input.reload = true;
  if (e.code === 'Space' && !g.demo) g.input.jump = true;
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyR') g.input.reload = false;
  if (e.code === 'Space') g.input.jump = false;
});
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement && !g.noLock) return;
  g.player.yaw -= e.movementX * 0.0022;
  g.player.pitch -= e.movementY * 0.0022;
  g.player.pitch = Math.max(-1.45, Math.min(1.45, g.player.pitch));
  g.input.lookDX = e.movementX; g.input.lookDY = e.movementY;
});
window.addEventListener('mousedown', (e) => {
  if (g.demo || !g.state.alive) return;
  if (document.pointerLockElement !== renderer.domElement && !g.noLock) return;
  if (e.button === 0) g.input.fire = true;
  if (e.button === 2) g.input.ads = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) g.input.fire = false;
  if (e.button === 2) g.input.ads = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

const titleEl = $('#title');
// старт по клику на баннер (баннер перекрывает canvas — вешаем обработчик на него)
titleEl.addEventListener('click', () => {
  if (g.demo) return;
  if (!g.state.alive) return;
  titleEl.style.display = 'none';
  if (document.pointerLockElement !== renderer.domElement) {
    try { renderer.domElement.requestPointerLock(); } catch (e) {}
  }
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) g.noLock = false;
  g.state.paused = !locked;
  if (locked) titleEl.style.display = 'none';
});
document.addEventListener('pointerlockerror', () => {
  // браузер отклонил захват — играем без него (fallback)
  g.noLock = true;
  g.state.paused = false;
  titleEl.style.display = 'none';
});

// ---------- физика игрока (горизонталь: окружность против AABBs) ----------
function resolveCollision(x, z, r) {
  const cols = (mods.world && mods.world.getColliders) ? mods.world.getColliders() : [];
  for (const c of cols) {
    const cx = Math.max(c.x - c.hw, Math.min(x, c.x + c.hw));
    const cz = Math.max(c.z - c.hd, Math.min(z, c.z + c.hd));
    let dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; z = cz + (dz / d) * r;
      } else {
        // центр внутри бокса — выталкиваем по ближайшей грани
        const left = x - (c.x - c.hw), right = (c.x + c.hw) - x;
        const top = z - (c.z - c.hd), bot = (c.z + c.hd) - z;
        const m = Math.min(left, right, top, bot);
        if (m === left) x = c.x - c.hw - r;
        else if (m === right) x = c.x + c.hw + r;
        else if (m === top) z = c.z - c.hd - r;
        else z = c.z + c.hd + r;
      }
    }
  }
  return [x, z];
}

const EYE = 1.62;
function updatePlayer(dt) {
  const p = g.player, inp = g.input;
  const ads = g.ads.amount;

  // направление движения (относительно yaw)
  let fwd = inp.forward, str = inp.strafe;
  const len = Math.hypot(fwd, str);
  if (len > 0) { fwd /= len; str /= len; }

  const sprinting = inp.sprint && fwd > 0 && !inp.ads && !g.state.reloading && g.state.alive;
  const baseSpeed = ads > 0.5 ? 2.6 : (sprinting ? 6.9 : 4.3);
  const accel = 55, friction = 11;

  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  const wx = (-sin * fwd + cos * str);
  const wz = (-cos * fwd - sin * str);

  p.vel.x += (wx * baseSpeed - p.vel.x) * Math.min(1, accel * dt * (p.vel.length() > 0.01 ? 1 : 1));
  p.vel.z += (wz * baseSpeed - p.vel.z) * Math.min(1, accel * dt);
  if (wx === 0 && wz === 0) {
    const f = Math.max(0, 1 - friction * dt);
    p.vel.x *= f; p.vel.z *= f;
  }

  // гравитация / прыжок
  if (inp.jump && p.onGround && g.state.alive && ads < 0.4) {
    p.vel.y = 6.4; p.onGround = false; inp.jump = false;
    if (mods.ui && mods.ui.sfx) mods.ui.sfx('jump', 0.35);
  }
  if (!p.onGround) p.vel.y -= 22 * dt;
  p.pos.y += p.vel.y * dt;
  if (p.pos.y <= EYE) { p.pos.y = EYE; p.vel.y = 0; if (!p.onGround) { p.onGround = true; if (mods.ui && mods.ui.sfx) mods.ui.sfx('land', 0.3); } }

  // коллизии по осям
  let [nx, nz] = resolveCollision(p.pos.x + p.vel.x * dt, p.pos.z, 0.42);
  p.pos.x = nx;
  [nx, nz] = resolveCollision(p.pos.x, p.pos.z + p.vel.z * dt, 0.42);
  p.pos.z = nz;

  // bob
  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  p.moveSpeed = hSpeed;
  const bobTarget = (hSpeed > 0.4 && p.onGround) ? Math.min(hSpeed * 1.7, 10) : 0;
  p.bobSpeed += (bobTarget - p.bobSpeed) * Math.min(1, 5 * dt);
  p.bobPhase += p.bobSpeed * dt;

  // прицел
  const adsTarget = (inp.ads && !sprinting && g.state.alive && !g.demo) ? 1 : 0;
  g.ads.amount += (adsTarget - g.ads.amount) * Math.min(1, 9 * dt);

  // отдача
  const rc = g.recoil;
  const decay = Math.pow(0.0001, dt); // ~8/с
  rc.pitch *= decay; rc.y *= decay;

  // FOV
  const fovTarget = ads > 0.5 ? 54 : (sprinting ? 84 : 75);
  camera.fov += (fovTarget - camera.fov) * Math.min(1, 8 * dt);
  camera.updateProjectionMatrix();

  // bob-смещение камеры
  const bobX = Math.sin(p.bobPhase * 2) * 0.028 * (p.bobSpeed / 10);
  const bobY = Math.abs(Math.sin(p.bobPhase)) * -0.035 * (p.bobSpeed / 10);
  camera.position.set(p.pos.x + bobX, p.pos.y + bobY + rc.y * 0.05, p.pos.z);
  camera.rotation.set(p.pitch + rc.pitch * 1.4, p.yaw, 0);

  // сглаживание резких движений мыши (sway viewmodel считает сам combat)
  g.input.lookDX *= 0.4; g.input.lookDY *= 0.4;
}

// ---------- демо-режиссёр (для скриншотов и критика) ----------
const demo = {
  wp: [], idx: 0, t: 0,
  curP: new THREE.Vector3(), curL: new THREE.Vector3(),
  fireT: 2.0, init() {
    const wps = (mods.world && mods.world.demoWaypoints) ? mods.world.demoWaypoints() : [];
    this.wp = (wps && wps.length) ? wps : [
      { p: [0, 2.2, 18], l: [0, 1.6, 0] },
      { p: [-12, 2.4, 6], l: [6, 1.6, 0] },
      { p: [10, 2.2, -4], l: [-4, 1.6, 2] }
    ];
    this.curP.fromArray(this.wp[0].p);
    this.curL.fromArray(this.wp[0].l);
  },
  update(dt) {
    this.t += dt;
    const wp = this.wp[this.idx % this.wp.length];
    const next = this.wp[(this.idx + 1) % this.wp.length];
    const hold = 2.2, move = 4.0, cycle = hold + move;
    const tt = this.t % cycle;
    const k = tt < hold ? 0 : Math.min(1, (tt - hold) / move);
    const s = k * k * (3 - 2 * k);
    this.curP.lerpVectors(
      new THREE.Vector3().fromArray(wp.p), new THREE.Vector3().fromArray(next.p), s);
    this.curL.lerpVectors(
      new THREE.Vector3().fromArray(wp.l), new THREE.Vector3().fromArray(next.l), s);
    if (tt >= cycle - dt) this.idx++;
    camera.position.copy(this.curP);
    camera.lookAt(this.curL);

    // автострельба по ближайшему боту
    this.fireT -= dt;
    if (this.fireT <= 0 && mods.combat && mods.bots && mods.bots.getBots) {
      this.fireT = 1.6 + Math.random() * 1.6;
      const bots = mods.bots.getBots().filter(b => b.alive);
      if (bots.length) {
        let best = null, bd = 1e9;
        for (const b of bots) {
          const d = b.mesh.position.distanceTo(camera.position);
          if (d < bd) { bd = d; best = b; }
        }
        if (best) {
          const head = best.mesh.position.clone().add(new THREE.Vector3(0, 0.55, 0));
          mods.combat.shoot(g, head);
        }
      }
    }
  }
};

// ---------- смерть игрока / респаун ----------
let deathTimer = -1;
function hurtPlayer(dmg) {
  if (!g.state.alive || g.demo) return;
  g.state.health = Math.max(0, g.state.health - dmg);
  if (g.events.onPlayerDamage) g.events.onPlayerDamage(dmg);
  if (g.state.health <= 0) {
    g.state.alive = false;
    g.input.fire = false; g.input.ads = false;
    $('#death').style.display = 'flex';
    deathTimer = 3.0;
  }
}
g.events.onPlayerDamage = hurtPlayer;

function respawn() {
  g.state.alive = true;
  g.state.health = g.state.maxHealth;
  g.player.pos.copy(g.player.spawn);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0; g.player.pitch = 0;
  g.recoil.pitch = 0; g.recoil.y = 0;
  g.state.ammo = g.state.magSize;
  g.state.reserve = 120;
  g.state.reloading = false;
  $('#death').style.display = 'none';
  if (mods.bots && mods.bots.respawnAll) mods.bots.respawnAll(g);
}

// ---------- главный цикл ----------
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(g.clock.getDelta(), 0.05);
  g.state.time += dt;
  grainPass.uniforms.time.value = g.state.time;

  // WASD-движение и спринт (каждый кадр — надёжнее обработчиков)
  g.input.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  g.input.strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  g.input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');

  if (g.demo) {
    demo.update(dt);
    g.player.bobPhase = 0;
  } else if (!g.state.paused) {
    if (g.state.alive) updatePlayer(dt);
    else if (deathTimer > 0) { deathTimer -= dt; if (deathTimer <= 0) respawn(); }
    // поворот камеры даже стоя (для прицеливания)
    camera.rotation.x = g.player.pitch + g.recoil.pitch * 1.4;
    camera.rotation.y = g.player.yaw;
  }

  if (mods.world && mods.world.update) mods.world.update(dt, g);
  if (mods.combat && mods.combat.update) mods.combat.update(dt, g);
  if (mods.bots && mods.bots.update) mods.bots.update(dt, g);
  if (mods.ui && mods.ui.update) mods.ui.update(dt, g);

  composer.render();
}

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
});

// ---------- старт ----------
async function boot() {
  await loadMod('world', './world.js');
  await loadMod('combat', './combat.js');
  await loadMod('bots', './bots.js');
  await loadMod('ui', './ui.js');

  if (mods.world && mods.world.init) mods.world.init(g);
  if (mods.combat && mods.combat.init) mods.combat.init(g);
  if (mods.bots && mods.bots.init) mods.bots.init(g);
  if (mods.ui && mods.ui.init) mods.ui.init(g);

  if (g.demo) {
    titleEl.style.display = 'none';
    document.body.classList.add('demo');
    $('#hud').style.display = 'block';
    demo.init();
    if (mods.bots && mods.bots.spawnBots) mods.bots.spawnBots(g, 8);
  } else {
    $('#hud').style.display = 'block';
  }
  frame();
}
boot();
