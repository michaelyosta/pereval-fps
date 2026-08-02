// ============================================================
//  ОПЕРАЦИЯ «ПЕРЕВАЛ» — combat.js
//  Штурмовая винтовка M4A1: viewmodel, стрельба, трейсеры,
//  гильзы, частицы, перезарядка, отдача, ADS.
//  Контракт: init(g), update(dt, g), shoot(g, aimTarget),
//            reload(g), getMuzzlePos()
//  Вьюмодель — ребёнок g.viewRoot (камера смотрит в -Z).
// ============================================================
import * as THREE from 'three';

// ---------- константы оружия ----------
const FIRE_INTERVAL = 0.09;   // ~11 выстр/с
const RELOAD_DUR = 1.8;       // длительность перезарядки, с
const DMG = 22;
const TRACER_LIFE = 0.09;
const TRACER_MAX_DIST = 60;
const TRACER_N = 24;
const CASING_LIFE = 1.6;
const CASING_N = 16;
const FLASH_LIFE = 0.045;   // жизнь дульного выброса, с

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _ray = new THREE.Raycaster();
_ray.far = 120;

let g = null;
let botsMod = null, worldMod = null, uiMod = null;

// --- вьюмодель ---
let vm = null;            // группа всех мешей оружия (ребёнок g.viewRoot)
let magPivot = null;      // поворотная группа магазина (анимация выхода)
let muzzleAnchor = null;  // точка дула в локальных координатах оружия
let ejectAnchor = null;   // точка выброса гильзы
// — аномалия «ОБЛОМОК»: разрушенный артефакт —
let coreMat = null, coreAnchor = null, shardGroup = null;
let sparkT = 1.0, surgeT = 5.0;
const _muzzleWorld = new THREE.Vector3();
const _ejectWorld = new THREE.Vector3();

// --- поза / анимация ---
const curPose = {
  pos: new THREE.Vector3(0.27, -0.265, -0.56),
  rot: new THREE.Vector3(0, -0.02, 0.09)
};
const sway = { x: 0, y: 0 };
let kick = 0;
let fireCooldown = 0;
let spreadAccum = 0;
let reloadT = 0;
let magOut = 0, tilt = 0;

// --- пулы FX ---
let tracers = [], casingPool = [];
let sparkPool = null, matterPool = null;
let flashSprite = null, muzzleLight = null;
let tracerCursor = 0, casingCursor = 0;

// ---------- утилиты ----------
const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const ramp = (t, a, b) => smooth((t - a) / (b - a));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- canvas-текстуры (тёмная грязная палитра) ----------
function canvasTex(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  fn(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function noiseFill(ctx, w, h, base, spread, n) {
  for (let i = 0; i < n; i++) {
    const l = (base + (Math.random() * 2 - 1) * spread) | 0;
    ctx.fillStyle = `rgb(${l},${l},${l})`;
    ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 1 + ((Math.random() * 2) | 0), 1);
  }
}

function scratches(ctx, w, h, n, light) {
  ctx.strokeStyle = light ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.24)';
  for (let i = 0; i < n; i++) {
    const y = (Math.random() * h) | 0;
    ctx.beginPath();
    ctx.moveTo((Math.random() * w) | 0, y);
    ctx.lineTo((Math.random() * w) | 0, y + (Math.random() * 2 - 1));
    ctx.stroke();
  }
}

function buildMaterials() {
  const bumpTex = canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#888888'; ctx.fillRect(0, 0, w, h);
    noiseFill(ctx, w, h, 150, 60, 2200);
  });
  // металл ствольной коробки: светлее оригинала, шум + царапины + потёртости кромок
  const gunmetal = canvasTex(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#3d4249'; ctx.fillRect(0, 0, w, h);
    noiseFill(ctx, w, h, 62, 18, 2400);
    scratches(ctx, w, h, 30, true);
    scratches(ctx, w, h, 26, false);
    ctx.strokeStyle = 'rgba(214,218,224,0.16)'; // светлые потёртости (износ кромок)
    for (let i = 0; i < 14; i++) {
      const y = (Math.random() * h) | 0;
      ctx.beginPath();
      ctx.moveTo((Math.random() * w) | 0, y);
      ctx.lineTo((Math.random() * w) | 0, y + (Math.random() * 4 - 2));
      ctx.stroke();
    }
  });
  // чёрный полимер (приклад/цевьё/рукоять/магазин): глубокий, с волокнами
  const polymer = canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1e2126'; ctx.fillRect(0, 0, w, h);
    noiseFill(ctx, w, h, 30, 10, 1800);
    for (let i = 0; i < 46; i++) { // вертикальные волокна
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
      ctx.fillRect((Math.random() * w) | 0, 0, 1, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, (Math.random() * h) | 0, w, 2);
    scratches(ctx, w, h, 12, true);
  });
  const steel = canvasTex(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#4d5157'; ctx.fillRect(0, 0, w, h);
    noiseFill(ctx, w, h, 82, 20, 1500);
    scratches(ctx, w, h, 18, true);
  });
  // перчатки: тёмная ткань со швами
  const glove = canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#26292f'; ctx.fillRect(0, 0, w, h);
    noiseFill(ctx, w, h, 40, 12, 2600);
    ctx.strokeStyle = 'rgba(8,9,11,0.55)';      // швы
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(36, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(66, 0); ctx.lineTo(82, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(104, 0); ctx.lineTo(116, h); ctx.stroke();
    ctx.lineWidth = 1;
    scratches(ctx, w, h, 10, true);
  });
  return {
    gunmetal: new THREE.MeshStandardMaterial({ map: gunmetal, bumpMap: bumpTex, bumpScale: 0.02, roughnessMap: bumpTex, envMapIntensity: 0.9, roughness: 0.42, metalness: 0.72 }),
    polymer: new THREE.MeshStandardMaterial({ map: polymer, bumpMap: bumpTex, bumpScale: 0.03, roughnessMap: bumpTex, envMapIntensity: 0.32, roughness: 0.7, metalness: 0.05 }),
    steel: new THREE.MeshStandardMaterial({ map: steel, bumpMap: bumpTex, bumpScale: 0.015, roughnessMap: bumpTex, envMapIntensity: 0.95, roughness: 0.34, metalness: 0.84 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x171a1e, roughness: 0.6, metalness: 0.4 }),
    scorch: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95, metalness: 0 }),
    core: new THREE.MeshStandardMaterial({ color: 0x0e2a26, emissive: 0x38e8d0, emissiveIntensity: 2.0, roughness: 0.4, metalness: 0.1 }),
    shard: new THREE.MeshStandardMaterial({ color: 0x2b2e33, emissive: 0x38e8d0, emissiveIntensity: 0.8, roughness: 0.5, metalness: 0.6 }),
    warm: new THREE.MeshStandardMaterial({ map: gunmetal, bumpMap: bumpTex, bumpScale: 0.02, roughnessMap: bumpTex, envMapIntensity: 0.8, roughness: 0.45, metalness: 0.7, emissive: 0x3a2412, emissiveIntensity: 0.28 }),
    glove: new THREE.MeshStandardMaterial({ map: glove, bumpMap: bumpTex, bumpScale: 0.04, roughnessMap: bumpTex, envMapIntensity: 0.25, roughness: 0.93, metalness: 0.03 })
  };
}

// ---------- вьюмодель M4A1 из примитивов ----------
// Ось канала ствола — Y=0, оружие смотрит в -Z, +X вправо.
// vm.scale 1.1 — крупный силуэт, читаемый на тёмном фоне.
function buildWeapon(root) {
  const M = buildMaterials();
  vm = new THREE.Group();
  vm.scale.setScalar(1.1);

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = false;
    m.receiveShadow = false;
    vm.add(m);
    return m;
  };
  const B = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) =>
    add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  const C = (rt, rb, h, seg, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.rotation.x = Math.PI / 2; // ось цилиндра вдоль Z
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = false;
    vm.add(m);
    return m;
  };
  // округлый палец: цилиндр вдоль оси X (seg 8 — мягкие грани вместо кубоида)
  const F = (len, r, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
    m.rotation.set(0, ry, Math.PI / 2);
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = false;
    vm.add(m);
    return m;
  };

  // — приклад телескопический (M4 collapsible): трубка крепится К коробке —
  C(0.022, 0.022, 0.29, 10, M.steel, 0, 0.04, 0.035);        // буферная трубка (от коробки до приклада)
  C(0.03, 0.03, 0.04, 10, M.steel, 0, 0.04, -0.078);         // гайка крепления (castle nut) — читаемый металл
  B(0.055, 0.09, 0.15, M.polymer, 0, 0.042, 0.175);          // корпус приклада (поверх трубки)
  B(0.057, 0.097, 0.02, M.dark, 0, 0.042, 0.255);            // затыльник
  B(0.008, 0.014, 0.022, M.dark, 0, -0.028, 0.238);          // задняя антабка

  // — ствольная коробка —
  B(0.056, 0.10, 0.28, M.gunmetal, 0, 0.045, -0.24);         // коробка
  B(0.014, 0.016, 0.075, M.warm, 0, 0.118, -0.135);          // рукоятка взвода
  B(0.007, 0.036, 0.07, M.dark, 0.031, 0.072, -0.295);       // окно выброса гильз (правая сторона)
  B(0.01, 0.02, 0.02, M.gunmetal, 0.033, 0.052, -0.185);     // forward assist
  B(0.058, 0.036, 0.085, M.dark, 0, -0.004, -0.245);         // магазинная горловина

  // — целик (диоптр) —
  B(0.022, 0.012, 0.04, M.warm, 0, 0.108, -0.33);            // основание
  B(0.024, 0.026, 0.012, M.warm, 0, 0.127, -0.33);           // корпус с апертурой

  // — планка Пикатинни (ресивер + цевьё) —
  B(0.03, 0.013, 0.50, M.gunmetal, 0, 0.101, -0.365);        // несущая рельса
  for (let i = 0; i < 4; i++) B(0.032, 0.007, 0.018, M.warm, 0, 0.114, -0.19 - i * 0.11); // зубья

  // — цевьё: две половинки с пазом под газовую трубку + рёбра —
  B(0.021, 0.068, 0.19, M.polymer, -0.014, 0.02, -0.505);
  B(0.021, 0.068, 0.19, M.polymer, 0.014, 0.02, -0.505);
  B(0.005, 0.082, 0.018, M.dark, -0.026, 0.02, -0.455);      // рёбра жёсткости
  B(0.005, 0.082, 0.018, M.dark, 0.026, 0.02, -0.455);
  B(0.005, 0.082, 0.018, M.dark, -0.026, 0.02, -0.555);
  B(0.005, 0.082, 0.018, M.dark, 0.026, 0.02, -0.555);
  C(0.024, 0.024, 0.018, 12, M.steel, 0, 0.02, -0.415);      // дельта-кольцо
  C(0.005, 0.005, 0.20, 8, M.steel, 0, 0.03, -0.505);        // газовая трубка (видна в пазу)
  B(0.01, 0.018, 0.012, M.dark, 0, -0.045, -0.415);          // передняя антабка (на кольце)

  // — газовая муфта + мушка (A2, с ушками) —
  B(0.028, 0.03, 0.05, M.gunmetal, 0, 0.028, -0.605);        // газовая муфта
  B(0.006, 0.05, 0.008, M.warm, 0, 0.103, -0.61);            // стойка мушки (верх y≈0.128 — линия прицела)
  B(0.006, 0.03, 0.014, M.warm, -0.013, 0.106, -0.61);       // ушко Л
  B(0.006, 0.03, 0.014, M.warm, 0.013, 0.106, -0.61);        // ушко П

  // — ствол + пламегаситель (A2) —
  C(0.0135, 0.0135, 0.27, 10, M.steel, 0, 0, -0.735);        // ствол
  C(0.0195, 0.0195, 0.09, 12, M.dark, 0, 0, -0.90);          // пламегаситель

  // — магазин (30 патронов, STANAG, изгиб назад) —
  magPivot = new THREE.Group();
  magPivot.position.set(0, 0, -0.24);
  vm.add(magPivot);
  B(0.044, 0.10, 0.06, M.polymer, 0, -0.072, 0, -0.06);      // верх магазина
  B(0.042, 0.095, 0.056, M.polymer, 0, -0.158, -0.014, -0.24); // низ (изгиб назад)
  B(0.046, 0.009, 0.062, M.dark, 0, -0.095, -0.003, -0.10);  // ребро 1
  B(0.044, 0.009, 0.058, M.dark, 0, -0.165, -0.017, -0.24);  // ребро 2
  B(0.046, 0.016, 0.056, M.dark, 0, -0.215, -0.021, -0.24);  // донная пластина

  // — рукоять + спусковая скоба —
  B(0.034, 0.13, 0.052, M.polymer, 0, -0.08, -0.075, -0.38); // пистолетная рукоять (наклон назад)
  B(0.036, 0.008, 0.012, M.dark, 0, -0.07, -0.103, -0.38);   // рифление рукояти
  B(0.026, 0.006, 0.06, M.dark, 0, -0.056, -0.115);          // скоба (низ)
  B(0.006, 0.03, 0.006, M.dark, -0.012, -0.033, -0.115);     // скоба (бок Л)
  B(0.006, 0.03, 0.006, M.dark, 0.012, -0.033, -0.115);      // скоба (бок П)
  B(0.007, 0.032, 0.01, M.dark, 0, -0.031, -0.117, 0.15);    // спусковой крючок

  // — левая рука в перчатке: держит цевьё (ладонь слева, пальцы поверх) —
  B(0.045, 0.05, 0.12, M.glove, -0.095, -0.085, -0.42, -0.66, 0, -0.66);  // предплечье
  C(0.024, 0.027, 0.035, 10, M.dark, -0.062, -0.055, -0.452);            // манжета перчатки
  B(0.03, 0.08, 0.07, M.glove, -0.045, 0.01, -0.50, 0, 0, 0.15);          // кисть
  B(0.023, 0.027, 0.062, M.glove, -0.057, 0.004, -0.512, 0, 0, 0.28);     // большой палец
  F(0.052, 0.008, M.glove, -0.006, 0.056, -0.478, -0.12);   // палец 1 — округлый (цилиндр)
  F(0.052, 0.0085, M.glove, 0, 0.058, -0.50, 0);            // палец 2
  F(0.052, 0.008, M.glove, 0.006, 0.056, -0.522, 0.12);     // палец 3
  B(0.016, 0.012, 0.012, M.dark, -0.006, 0.056, -0.505, -0.12, 0, -0.1);  // кончики пальцев (объём)
  B(0.016, 0.013, 0.013, M.dark, 0, 0.058, -0.526, 0, 0, -0.1);
  B(0.016, 0.012, 0.012, M.dark, 0.006, 0.056, -0.547, 0.12, 0, -0.1);

  // — правая рука в перчатке: рукоять, указательный палец на спусковом крючке —
  B(0.045, 0.055, 0.12, M.glove, 0.10, -0.14, -0.045, -0.85, 0, 1.1);     // предплечье
  C(0.026, 0.029, 0.035, 10, M.dark, 0.094, -0.108, -0.068);              // манжета перчатки
  B(0.03, 0.045, 0.06, M.glove, 0.033, -0.09, -0.088, 0, 0, 0.1);         // кисть
  F(0.05, 0.008, M.glove, 0.028, -0.068, -0.102, 0);        // палец 1 — округлый
  F(0.05, 0.008, M.glove, 0.028, -0.088, -0.102, 0);        // палец 2
  B(0.015, 0.013, 0.045, M.glove, 0.023, -0.05, -0.104, 0.28, 0.42, 0);   // указательный (на крючке)
  B(0.019, 0.035, 0.048, M.glove, 0.0, -0.04, -0.083, 0.5, 0, 0.22);      // большой палец

  // — точки-якоря —
  muzzleAnchor = new THREE.Object3D();
  muzzleAnchor.position.set(0, 0, -0.95);
  vm.add(muzzleAnchor);
  ejectAnchor = new THREE.Object3D();
  ejectAnchor.position.set(0.04, 0.05, -0.30);
  vm.add(ejectAnchor);

  // — «ОБЛОМОК»: обугленные пятна, аномальная трещина, парящие осколки —
  const scorchSpots = [
    [0, 0.075, -0.1, 0.05, 0.02, 0.12], [0, 0.018, -0.36, 0.058, 0.012, 0.09],
    [0, 0.028, 0.2, 0.055, 0.02, 0.1], [-0.014, 0.018, -0.55, 0.045, 0.014, 0.08],
    [0.02, 0.026, -0.78, 0.03, 0.018, 0.06]
  ];
  for (const [x, y, z, w, h, d] of scorchSpots) B(w, h, d, M.scorch, x, y, z);
  // светящаяся трещина с аномальной энергией (теал) вдоль коробки
  coreMat = M.core;
  B(0.064, 0.012, 0.17, M.core, 0, 0.058, -0.24);
  coreAnchor = new THREE.Object3D();
  coreAnchor.position.set(0, 0.05, -0.22);
  vm.add(coreAnchor);
  // парящие осколки вокруг оружия (магия)
  shardGroup = new THREE.Group();
  shardGroup.name = 'shards';
  for (let i = 0; i < 3; i++) {
    const sh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.016 + Math.random() * 0.014, 0), M.shard);
    sh.position.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.16, -0.2 + (Math.random() - 0.5) * 0.35);
    sh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    shardGroup.add(sh);
  }
  vm.add(shardGroup);

  root.add(vm);
}

// ---------- пул частиц (THREE.Points + ShaderMaterial, без аллокаций в update) ----------
function makeParticlePool(cap, blending) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 3);
  const col = new Float32Array(cap * 3);
  const size = new Float32Array(cap);
  const alpha = new Float32Array(cap);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending,
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, aSize * (20.0 / max(1.0, -mv.z)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.10, d);
        gl_FragColor = vec4(vColor, a * vAlpha);
      }`
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 20;
  // vx,vy,vz, grav, life, maxLife, sizePx
  const state = new Float32Array(cap * 7);
  return { geo, mat, pts, pos, col, size, alpha, state, cap, cursor: 0 };
}

function spawnParticles(pool, origin, dir, n, o) {
  for (let k = 0; k < n; k++) {
    const i = pool.cursor++ % pool.cap;
    const p = i * 3, s = i * 7;
    const sp = rand(o.speed[0], o.speed[1]);
    pool.pos[p] = origin.x + dir.x * 0.03;
    pool.pos[p + 1] = origin.y + dir.y * 0.03;
    pool.pos[p + 2] = origin.z + dir.z * 0.03;
    const jit = sp * o.jitter;
    pool.state[s] = dir.x * sp + rand(-jit, jit);
    pool.state[s + 1] = dir.y * sp + rand(-jit, jit);
    pool.state[s + 2] = dir.z * sp + rand(-jit, jit);
    pool.state[s + 3] = rand(o.grav[0], o.grav[1]);
    const life = rand(o.life[0], o.life[1]);
    pool.state[s + 4] = life;
    pool.state[s + 5] = life;
    pool.state[s + 6] = rand(o.size[0], o.size[1]);
    const c = o.colors[(Math.random() * o.colors.length) | 0];
    pool.col[p] = ((c >> 16) & 255) / 255;
    pool.col[p + 1] = ((c >> 8) & 255) / 255;
    pool.col[p + 2] = (c & 255) / 255;
    pool.size[i] = pool.state[s + 6];
    pool.alpha[i] = 1;
  }
  pool.geo.attributes.position.needsUpdate = true;
  pool.geo.attributes.aColor.needsUpdate = true;
  pool.geo.attributes.aSize.needsUpdate = true;
  pool.geo.attributes.aAlpha.needsUpdate = true;
}

function updateParticles(dt) {
  for (const pool of [sparkPool, matterPool]) {
    const { pos, state, size, alpha, cap, geo } = pool;
    let dirty = false;
    for (let i = 0; i < cap; i++) {
      const s = i * 7;
      const life = state[s + 4];
      if (life <= 0) {
        if (alpha[i] !== 0) { alpha[i] = 0; size[i] = 0; dirty = true; }
        continue;
      }
      const nl = life - dt;
      state[s + 4] = nl;
      const p = i * 3;
      pos[p] += state[s] * dt;
      pos[p + 1] += state[s + 1] * dt;
      pos[p + 2] += state[s + 2] * dt;
      state[s + 1] -= state[s + 3] * dt;
      const t = nl / state[s + 5];
      const a = t < 1 ? t * t : 1;
      if (alpha[i] !== a) { alpha[i] = a; dirty = true; }
      dirty = true;
    }
    if (dirty) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
    }
  }
}

// ---------- FX: трейсеры, гильзы, вспышка, свет ----------
function buildFX(scene) {
  // трейсеры: удлинённый бокс 0.015x0.015xL, additive, #ffd9a0
  const tGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  for (let i = 0; i < TRACER_N; i++) {
    const tMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const m = new THREE.Mesh(tGeo, tMat);
    m.visible = false;
    m.frustumCulled = false;
    m.renderOrder = 25;
    scene.add(m);
    tracers.push({ mesh: m, life: 0 });
  }

  // гильзы: маленькие боксы, гравитация + отскок + вращение
  const cGeo = new THREE.BoxGeometry(0.011, 0.011, 0.026);
  const cMat = new THREE.MeshStandardMaterial({ color: 0xc9994a, roughness: 0.4, metalness: 0.78 });
  for (let i = 0; i < CASING_N; i++) {
    const m = new THREE.Mesh(cGeo, cMat);
    m.visible = false;
    m.castShadow = false;
    scene.add(m);
    casingPool.push({ mesh: m, vel: new THREE.Vector3(), rotV: new THREE.Vector3(), life: 0 });
  }

  // частицы: единый пул точек — искры (additive) + пыль/кровь (normal)
  sparkPool = makeParticlePool(140, THREE.AdditiveBlending);
  matterPool = makeParticlePool(140, THREE.NormalBlending);
  scene.add(sparkPool.pts, matterPool.pts);

  // дульный выброс: спрайт радиального градиента
  const fc = document.createElement('canvas');
  fc.width = fc.height = 64;
  const fctx = fc.getContext('2d');
  const grad = fctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.22, 'rgba(255,214,110,0.95)');
  grad.addColorStop(0.5, 'rgba(255,140,40,0.45)');
  grad.addColorStop(1, 'rgba(255,110,20,0)');
  fctx.fillStyle = grad;
  fctx.fillRect(0, 0, 64, 64);
  flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(fc), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  flashSprite.visible = false;
  flashSprite.frustumCulled = false;
  flashSprite.renderOrder = 30;
  scene.add(flashSprite);

  // свет дула
  muzzleLight = new THREE.PointLight(0xffa050, 0, 14, 2.2);
  scene.add(muzzleLight);
}

function spawnTracer(start, end) {
  const t = tracers[tracerCursor];
  tracerCursor = (tracerCursor + 1) % TRACER_N;
  _v1.subVectors(end, start);
  const len = _v1.length();
  if (len < 0.001) return;
  _v1.normalize();
  const m = t.mesh;
  m.visible = true;
  t.life = TRACER_LIFE;
  m.scale.set(1, 1, len);
  m.position.copy(start).add(end).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Z_AXIS, _v1);
  m.material.opacity = 0.85;
}

function updateTracers(dt) {
  for (const t of tracers) {
    if (!t.mesh.visible) continue;
    t.life -= dt;
    if (t.life <= 0) { t.mesh.visible = false; continue; }
    t.mesh.material.opacity = 0.85 * (t.life / TRACER_LIFE);
  }
}

function spawnCasing() {
  const c = casingPool[casingCursor];
  casingCursor = (casingCursor + 1) % CASING_N;
  ejectAnchor.getWorldPosition(_ejectWorld);
  const q = g.camera.quaternion;
  _v1.set(1, 0, 0).applyQuaternion(q);   // право
  _v2.set(0, 1, 0).applyQuaternion(q);   // верх
  _v3.set(0, 0, -1).applyQuaternion(q);  // вперёд
  c.mesh.visible = true;
  c.mesh.scale.set(1, 1, 1);
  c.mesh.position.copy(_ejectWorld).addScaledVector(_v1, 0.015).addScaledVector(_v2, 0.01);
  c.vel.copy(_v1).multiplyScalar(rand(1.5, 2.2))
    .addScaledVector(_v2, rand(2.0, 3.0))
    .addScaledVector(_v3, rand(-0.5, -0.2))
    .addScaledVector(g.player.vel, 0.35);
  c.rotV.set(rand(-10, 10), rand(-10, 10), rand(-10, 10));
  c.life = CASING_LIFE;
}

function updateCasings(dt) {
  for (const c of casingPool) {
    if (!c.mesh.visible) continue;
    c.life -= dt;
    if (c.life <= 0) { c.mesh.visible = false; continue; }
    c.vel.y -= 17 * dt;
    c.mesh.position.addScaledVector(c.vel, dt);
    if (c.mesh.position.y < 0.012) {
      c.mesh.position.y = 0.012;
      if (c.vel.y < 0) c.vel.y = -c.vel.y * 0.34;
      c.vel.x *= 0.55; c.vel.z *= 0.55;
      c.rotV.multiplyScalar(0.86);
    }
    c.rotV.multiplyScalar(Math.max(0, 1 - 1.2 * dt));
    c.mesh.rotation.x += c.rotV.x * dt;
    c.mesh.rotation.y += c.rotV.y * dt;
    c.mesh.rotation.z += c.rotV.z * dt;
    if (c.life < 0.35) c.mesh.scale.setScalar(Math.max(0.12, c.life / 0.35));
  }
}

function spawnFlash() {
  flashSprite.visible = true;
  flashSprite.life = FLASH_LIFE;
  flashSprite.position.copy(_muzzleWorld);
  const s = rand(0.75, 1.3);
  flashSprite.scale.set(s, s, 1);
  flashSprite.material.rotation = Math.random() * Math.PI * 2;
  flashSprite.material.opacity = 1;
}

function updateFlash(dt) {
  if (!flashSprite.visible) return;
  flashSprite.life -= dt;
  if (flashSprite.life <= 0) {
    flashSprite.visible = false;
    flashSprite.material.opacity = 0;
    return;
  }
  flashSprite.material.opacity = flashSprite.life / FLASH_LIFE;
}

function spawnMuzzleLight() {
  muzzleLight.position.copy(_muzzleWorld);
  muzzleLight.intensity = 26;
}

function updateMuzzleLight(dt) {
  if (muzzleLight.intensity <= 0.01) return;
  muzzleLight.intensity *= Math.exp(-95 * dt);
  if (muzzleLight.intensity < 0.5) muzzleLight.intensity = 0;
}

// ---------- ударные эффекты ----------
function spawnImpact(point, dir) {
  spawnParticles(sparkPool, point, dir, 12, {
    speed: [3, 8], jitter: 1.3, grav: [18, 26], life: [0.35, 0.7],
    colors: [0xffb347, 0xff8c2e, 0xffd66b], size: [2, 4.5]
  });
  spawnParticles(matterPool, point, dir, 7, {
    speed: [0.5, 1.8], jitter: 0.6, grav: [1.5, 3], life: [0.55, 1.0],
    colors: [0x8f8f8b, 0x6e6e6a], size: [4, 8]
  });
}

function spawnBlood(point, dir) {
  spawnParticles(matterPool, point, dir, 10, {
    speed: [1.2, 3.4], jitter: 0.9, grav: [8, 13], life: [0.18, 0.35],
    colors: [0xa31313, 0x7d0f0f, 0xc41a1a], size: [2.2, 4.2]
  });
}

// ---------- разброс ----------
function applySpread(dir, angle) {
  if (angle <= 0.0001) return;
  _v3.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5));
  _v3.crossVectors(dir, _v3);
  if (_v3.lengthSq() < 1e-8) _v3.set(1, 0, 0);
  _v3.normalize();
  dir.applyAxisAngle(_v3, angle * Math.random());
}

// ---------- перезарядка ----------
export function reload(g) {
  if (!g || g.state.reloading || !g.state.alive) return;
  if (g.state.ammo >= g.state.magSize || g.state.reserve <= 0) return;
  g.state.reloading = true;
  reloadT = 0;
  if (uiMod && uiMod.sfx) uiMod.sfx('reload', 1);
}

function dryFire(g) {
  fireCooldown = 0.3;
  if (uiMod && uiMod.sfx) uiMod.sfx('empty', 1);
  if (g.state.reserve > 0) reload(g);
}

function finishReload() {
  const need = g.state.magSize - g.state.ammo;
  const take = Math.min(need, g.state.reserve);
  g.state.ammo += take;
  g.state.reserve -= take;
  g.state.reloading = false;
}

// ---------- стрельба ----------
export function shoot(g, aimTarget) {
  if (!g || !g.state.alive || g.state.reloading) return;
  if (fireCooldown > 0) return;
  if (g.state.ammo <= 0) { dryFire(g); return; }

  g.state.ammo--;
  fireCooldown = FIRE_INTERVAL;

  // отдача: импульсы в g.recoil (main сам гасит) + подброс viewRoot
  g.recoil.pitch += 0.014;
  g.recoil.y += 0.02;
  kick = Math.min(1, kick + 0.6);

  // разброс: растёт при стрельбе/движении, падает в ADS
  spreadAccum = Math.min(0.024, spreadAccum + 0.0011);
  const adsAmt = g.ads ? g.ads.amount : 0;
  const base = adsAmt > 0.5 ? 0.0011 : 0.0042;
  const move = (g.player.moveSpeed || 0) * 0.0007;
  const air = g.player.onGround ? 0 : 0.0035;
  const spread = base + move + air + spreadAccum;

  // направление: из камеры, либо на aimTarget (demo)
  g.camera.getWorldPosition(_v1);
  let dir;
  if (aimTarget) {
    dir = _v2.copy(aimTarget).sub(_v1).normalize();
  } else {
    dir = _v2.set(0, 0, -1).applyQuaternion(g.camera.quaternion).normalize();
  }
  applySpread(dir, spread);

  muzzleAnchor.getWorldPosition(_muzzleWorld);

  // рейкаст по ботам и статике
  _v3.copy(_v1).addScaledVector(dir, TRACER_MAX_DIST);
  const targets = [];
  if (botsMod && botsMod.getGroup) { const bg = botsMod.getGroup(); if (bg) targets.push(bg); }
  if (worldMod && worldMod.getShootables) { const sg = worldMod.getShootables(); if (sg) targets.push(sg); }
  else if (g.staticGroup) targets.push(g.staticGroup);

  _ray.set(_v1, dir);
  let hit = null;
  if (targets.length) {
    const arr = _ray.intersectObjects(targets, true);
    if (arr.length) hit = arr[0];
  }

  if (hit) {
    _v3.copy(hit.point);
    // поднимаемся по parent до корня бота (userData.bot)
    let node = hit.object, bot = null;
    while (node) {
      if (node.userData && node.userData.bot) { bot = node.userData.bot; break; }
      node = node.parent;
    }
    if (bot && botsMod && botsMod.applyDamage) {
      const res = botsMod.applyDamage(g, bot, DMG, dir, hit.point);
      const killed = !!(res && res.killed);
      spawnBlood(hit.point, dir);
      if (g.events && g.events.onEnemyHit) g.events.onEnemyHit(DMG, killed);
    } else {
      spawnImpact(hit.point, dir); // статика: искры + пыль
    }
  }

  // FX выстрела
  spawnTracer(_muzzleWorld, _v3);
  spawnFlash();
  spawnMuzzleLight();
  spawnCasing();

  if (g.events && g.events.onShoot) g.events.onShoot();
  else if (uiMod && uiMod.sfx) uiMod.sfx('shoot', 1);

  // магазин пуст — щелчок + автоперезарядка
  if (g.state.ammo === 0) {
    if (uiMod && uiMod.sfx) uiMod.sfx('empty', 0.9);
    reload(g);
  }
}

// ---------- поза viewmodel ----------
function computePose(dt, adsAmt) {
  const a = smooth(adsAmt);
  let px = 0.27, py = -0.265, pz = -0.56;
  let rx = 0, ry = -0.02, rz = 0.09;

  // ADS: оружие по центру; линия прицелов (локальный y≈0.128,
  // с учётом vm.scale 1.1 → 0.141) ложится точно на ось камеры
  if (a > 0) {
    px += (0 - px) * a; py += (-0.141 - py) * a; pz += (-0.36 - pz) * a;
    rx += (0 - rx) * a; ry += (0 - ry) * a; rz += (0 - rz) * a;
  }
  // спринт: оружие справа-внизу, наклон вбок (как в CoD); при стрельбе — hip-поза
  if (g.input.sprint && !g.input.fire && adsAmt < 0.25 && !g.state.reloading) {
    const s = 1 - smooth(adsAmt / 0.25);
    px += (0.26 - px) * s; py += (-0.45 - py) * s; pz += (-0.78 - pz) * s;
    rx += (0.10 - rx) * s; rz += (0.34 - rz) * s;
  }
  // перезарядка: наклон вниз-вправо
  if (tilt > 0) {
    px += 0.055 * tilt; py += -0.07 * tilt; pz += 0.06 * tilt;
    rx += 0.44 * tilt; ry += 0.10 * tilt; rz += 0.30 * tilt;
  }
  // bob
  const bamp = Math.min(1, (g.player.bobSpeed || 0) / 10) * (1 - a * 0.85);
  const bp = g.player.bobPhase || 0;
  px += Math.sin(bp * 2) * 0.016 * bamp;
  py += Math.abs(Math.sin(bp)) * -0.02 * bamp;
  rx += Math.sin(bp * 2) * 0.012 * bamp;
  rz += Math.sin(bp) * 0.010 * bamp;
  // sway (запаздывающий, от lookDX/lookDY)
  const sw = 1 - a * 0.9;
  rz += sway.x * 0.00022 * sw;
  rx -= sway.y * 0.00026 * sw;
  px -= sway.x * 0.0005 * sw;
  py -= sway.y * 0.0004 * sw;
  // отдача: лёгкий подброс viewRoot вверх/назад
  py -= kick * 0.014;
  pz += kick * 0.028;
  rx += kick * 0.026;
  rz += kick * 0.010;

  // плавное сглаживание
  const k = Math.min(1, 14 * dt);
  curPose.pos.x += (px - curPose.pos.x) * k;
  curPose.pos.y += (py - curPose.pos.y) * k;
  curPose.pos.z += (pz - curPose.pos.z) * k;
  curPose.rot.x += (rx - curPose.rot.x) * k;
  curPose.rot.y += (ry - curPose.rot.y) * k;
  curPose.rot.z += (rz - curPose.rot.z) * k;

  g.viewRoot.position.copy(curPose.pos);
  g.viewRoot.rotation.set(curPose.rot.x, curPose.rot.y, curPose.rot.z);
}

// ---------- init / update ----------
export function init(_g) {
  g = _g;
  buildWeapon(g.viewRoot);
  buildFX(g.scene);
  g.viewRoot.position.copy(curPose.pos);
  g.viewRoot.rotation.set(curPose.rot.x, curPose.rot.y, curPose.rot.z);
  // ленивая загрузка соседних модулей (не ломаем игру, если их нет)
  import('./bots.js').then((m) => { botsMod = m; }).catch(() => {});
  import('./world.js').then((m) => { worldMod = m; }).catch(() => {});
  import('./ui.js').then((m) => { uiMod = m; }).catch(() => {});
}

export function update(dt, _g) {
  g = _g;
  if (!g) return;
  fireCooldown -= dt;

  // перезарядка по R (main даёт одноразовый импульс true)
  if (g.input && g.input.reload) { g.input.reload = false; reload(g); }

  // автоогонь
  if (!g.demo && !g.state.paused && g.state.alive && !g.state.reloading &&
      g.input.fire && fireCooldown <= 0) {
    if (g.state.ammo > 0) shoot(g, null);
    else dryFire(g);
  }

  // прогресс перезарядки
  if (g.state.reloading) {
    reloadT += dt;
    if (reloadT >= RELOAD_DUR) finishReload();
  }

  // demo: автопополнение боезапаса, чтобы цикл не умирал на 0/0
  if (g.demo && g.state.ammo === 0 && g.state.reserve === 0 && !g.state.reloading) {
    g.state.ammo = g.state.magSize;
    g.state.reserve = 90;
  }

  // анимация магазина: выход, пауза, возврат
  const rt = clamp01(reloadT / RELOAD_DUR);
  magOut = g.state.reloading ? ramp(rt, 0.0, 0.30) * (1 - ramp(rt, 0.68, 0.95)) : 0;
  tilt = g.state.reloading ? ramp(rt, 0.0, 0.26) * (1 - ramp(rt, 0.60, 1.0)) : 0;
  const mk = Math.min(1, 12 * dt);
  magPivot.rotation.x += (-0.95 * magOut - magPivot.rotation.x) * mk;
  magPivot.position.y += (-0.028 * magOut - magPivot.position.y) * mk;

  // запаздывающий sway
  const sRate = Math.min(1, 9 * dt);
  sway.x += ((g.input.lookDX || 0) - sway.x) * sRate;
  sway.y += ((g.input.lookDY || 0) - sway.y) * sRate;

  // поза
  computePose(dt, g.ads ? g.ads.amount : 0);

  // FX
  updateTracers(dt);
  updateCasings(dt);
  updateParticles(dt);
  updateFlash(dt);

  // — аномалия «ОБЛОМКА»: пульс ядра, осколки, искры, всплески —
  const t = g.state.time;
  if (coreMat) coreMat.emissiveIntensity = 1.5 + Math.sin(t * 3.2) * 0.7;
  if (shardGroup) {
    shardGroup.rotation.y += dt * 0.8;
    shardGroup.rotation.x = Math.sin(t * 0.9) * 0.2;
    for (let i = 0; i < shardGroup.children.length; i++) {
      shardGroup.children[i].position.y += Math.sin(t * 2.2 + i * 2.1) * dt * 0.05;
    }
  }
  sparkT -= dt;
  if (sparkT <= 0 && coreAnchor && sparkPool) {
    sparkT = 0.6 + Math.random() * 0.9;
    coreAnchor.getWorldPosition(_v1);
    _v2.set(0, 1, 0);
    spawnParticles(sparkPool, _v1, _v2, 4, {
      speed: [0.4, 1.4], jitter: 1.6, grav: [-1, 1], life: [0.3, 0.6],
      colors: [0x38e8d0, 0x9ff6ea, 0x1fb8a8], size: [1.5, 3.5]
    });
  }
  surgeT -= dt;
  if (surgeT <= 0) {
    surgeT = 4.5 + Math.random() * 2.5;
    if (coreMat) coreMat.emissiveIntensity = 3.4;
    if (coreAnchor && sparkPool) {
      coreAnchor.getWorldPosition(_v1);
      _v2.set(0, 1, 0);
      spawnParticles(sparkPool, _v1, _v2, 14, {
        speed: [0.8, 2.6], jitter: 2.0, grav: [-2, 1], life: [0.4, 0.8],
        colors: [0x38e8d0, 0x9ff6ea, 0x1fb8a8], size: [2, 4.5]
      });
    }
  }
  updateMuzzleLight(dt);

  // затухание
  kick *= Math.exp(-11 * dt);
  spreadAccum *= Math.exp(-6.5 * dt);
}

// ---------- точка дула в мировых координатах ----------
export function getMuzzlePos() {
  muzzleAnchor.getWorldPosition(_muzzleWorld);
  return _muzzleWorld.clone();
}
