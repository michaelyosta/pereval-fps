// ============================================================
//  ОПЕРАЦИЯ «ПЕРЕВАЛ» — world.js
//  Мир: укреплённая военная база на Ближнем Востоке (CoD:MW 2019):
//  двор ~70x50 м, бетонные стены, здания, контейнеры, укрытия,
//  тёплый золотой свет позднего дня, дымка и пыль.
//  API: init(g), update(dt, g), getColliders(), getShootables(),
//       demoWaypoints()
// ============================================================
import * as THREE from 'three';

// ---------- состояние модуля ----------
let built = false;
let shootGroup = null;            // вся статичная геометрия (для рейкастов пуль)
const colliders = [];             // {x,z,hw,hd,height,rotation} — height-aware capsule physics

const DUST_N = 250;
const dustBase = new Float32Array(DUST_N * 3);
const dustPh = new Float32Array(DUST_N);
let dustPoints = null;
let dustLayers = [];
let cloudGroup = null;
let dustPosAttr = null;

const lamps = [];                 // {light, phase} — едва светящиеся фонари
let skyMesh = null;
let _t = 0;

// ---------- canvas-текстуры (только процедурные) ----------
function makeTex(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  fn(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// монохромный шум-крапинка
function noiseGray(ctx, w, h, base, spread, n, alpha = 1) {
  for (let i = 0; i < n; i++) {
    const l = (base + (Math.random() * 2 - 1) * spread) | 0;
    ctx.fillStyle = `rgba(${l},${l},${l},${alpha})`;
    ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0,
      1 + ((Math.random() * 2) | 0), 1 + ((Math.random() * 2) | 0));
  }
}

// цветной шум (для грязи, ржавчины, песка)
function noiseRGB(ctx, w, h, r, g, b, spread, n, alpha = 1) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(${r + (Math.random() * 2 - 1) * spread | 0},` +
      `${g + (Math.random() * 2 - 1) * spread | 0},` +
      `${b + (Math.random() * 2 - 1) * spread | 0},${alpha})`;
    ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0,
      1 + ((Math.random() * 2) | 0), 1 + ((Math.random() * 2) | 0));
  }
}

// ломаные трещины
function drawCracks(ctx, w, h, n, style) {
  ctx.strokeStyle = style;
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let x = Math.random() * w, y = Math.random() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + ((Math.random() * 4) | 0);
    for (let s = 0; s < segs; s++) {
      x += (Math.random() * 2 - 1) * 26;
      y += (Math.random() * 2 - 1) * 22;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ржавые потёки сверху вниз
function rustDrips(ctx, w, h, n, color) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w;
    const len = 6 + Math.random() * h * 0.35;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 + Math.random() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, Math.random() * h * 0.3);
    ctx.lineTo(x + (Math.random() * 2 - 1) * 3, Math.min(h, Math.random() * h * 0.3 + len));
    ctx.stroke();
  }
}

// ---------- текстуры мира ----------
function buildTextures() {
  const T = {};

  // PBR-шум: bump-карта и вариация шероховатости (убирает «плоские заливки»)
  T.noise = makeTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(0, 0, w, h);
    noiseGray(ctx, w, h, 138, 60, 3200, 1);
    noiseGray(ctx, w, h, 128, 26, 1400, 0.6);
  });
  // шум для земли: отдельная текстура со своим repeat (не завязан на стены)
  T.groundNoise = makeTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(0, 0, w, h);
    noiseGray(ctx, w, h, 142, 64, 5200, 1);
    noiseGray(ctx, w, h, 128, 30, 2600, 0.6);
    for (let i = 0; i < 120; i++) { // камешки-крапинки
      ctx.fillStyle = `rgba(${120 + (Math.random() * 80) | 0},${110 + (Math.random() * 70) | 0},${95 + (Math.random() * 55) | 0},0.5)`;
      ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 2, 2);
    }
  });
  T.noise.colorSpace = THREE.NoColorSpace;
  T.groundNoise.colorSpace = THREE.NoColorSpace;

  // --- асфальт: шум, трещины, масляные пятна, песчаные проплешины ---
  T.asphalt = makeTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#4b4a47';
    ctx.fillRect(0, 0, w, h);
    noiseRGB(ctx, w, h, 75, 74, 71, 14, 22000, 0.5);
    // светлые песчаные пятна — много, разного размера и поворота (рвёт периодичность)
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(178,158,120,${0.07 + Math.random() * 0.17})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h,
        6 + Math.random() * 38, 5 + Math.random() * 22,
        Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // масляные пятна
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(18,17,16,${0.08 + Math.random() * 0.22})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h,
        5 + Math.random() * 38, 4 + Math.random() * 26,
        Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // гравийная крапинка
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${90 + Math.random() * 90 | 0},${86 + Math.random() * 84 | 0},${80 + Math.random() * 76 | 0},0.4)`;
      ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 1 + (Math.random() * 2 | 0), 1 + (Math.random() * 2 | 0));
    }
    drawCracks(ctx, w, h, 16, 'rgba(20,19,18,0.55)');
    drawCracks(ctx, w, h, 12, 'rgba(110,108,102,0.28)');
    noiseGray(ctx, w, h, 72, 16, 5200, 0.35);
  });

  // --- мягкое песчаное пятно (прозрачное) ---
  T.sandPatch = makeTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(196,176,132,0.85)');
    g.addColorStop(0.6, 'rgba(184,160,118,0.55)');
    g.addColorStop(1, 'rgba(180,156,114,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    noiseRGB(ctx, w, h, 196, 176, 132, 18, 700, 0.35);
  });

  // --- потёртая жёлтая разметка ---
  T.marking = makeTex(512, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(196,166,86,0.0)';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 4) {
      const a = 0.42 * (0.55 + Math.random() * 0.45);
      ctx.fillStyle = `rgba(205,178,104,${a})`;
      ctx.fillRect(x, 20, 3 + Math.random() * 3, 22);
    }
    noiseGray(ctx, w, h, 160, 40, 500, 0.2);
  });

  // --- бетон: шум, пятна, сколы, линии опалубки ---
  T.concrete = makeTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b3a992';
    ctx.fillRect(0, 0, w, h);
    noiseRGB(ctx, w, h, 179, 169, 146, 16, 9000, 0.6);
    // тёмные влажные пятна
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = `rgba(84,74,60,${0.08 + Math.random() * 0.14})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h,
        10 + Math.random() * 34, 6 + Math.random() * 20,
        Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // светлые потёки
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * w;
      ctx.strokeStyle = `rgba(215,207,188,${0.10 + Math.random() * 0.12})`;
      ctx.lineWidth = 2 + Math.random() * 4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (Math.random() * 2 - 1) * 8, h);
      ctx.stroke();
    }
    // линии опалубки
    ctx.fillStyle = 'rgba(90,82,66,0.25)';
    for (let y = 0; y < h; y += 64) ctx.fillRect(0, y, w, 2);
    drawCracks(ctx, w, h, 5, 'rgba(60,54,44,0.4)');
    noiseGray(ctx, w, h, 176, 22, 2200, 0.35);
  });

  // --- ржавый металл (контейнеры, бочки) ---
  T.metalRust = makeTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7c7468';
    ctx.fillRect(0, 0, w, h);
    noiseRGB(ctx, w, h, 124, 116, 104, 18, 8000, 0.6);
    rustDrips(ctx, w, h, 22, 'rgba(122,64,28,0.5)');
    rustDrips(ctx, w, h, 14, 'rgba(88,44,20,0.4)');
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(140,120,90,${0.15 + Math.random() * 0.2})`;
      ctx.fillRect(Math.random() * w, Math.random() * h,
        2 + Math.random() * 10, 1 + Math.random() * 3);
    }
    noiseGray(ctx, w, h, 120, 26, 2200, 0.3);
  });

  // --- оливковый металл с ржавчиной ---
  T.metalOlive = makeTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5a5d42';
    ctx.fillRect(0, 0, w, h);
    noiseRGB(ctx, w, h, 90, 93, 66, 14, 8000, 0.6);
    rustDrips(ctx, w, h, 14, 'rgba(122,64,28,0.45)');
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = `rgba(30,32,22,${0.12 + Math.random() * 0.16})`;
      ctx.fillRect(Math.random() * w, Math.random() * h,
        2 + Math.random() * 9, 1 + Math.random() * 3);
    }
    noiseGray(ctx, w, h, 100, 22, 2000, 0.3);
  });

  // --- песочный металл ---
  T.metalSand = makeTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#93825f';
    ctx.fillRect(0, 0, w, h);
    noiseRGB(ctx, w, h, 147, 130, 95, 16, 8000, 0.6);
    rustDrips(ctx, w, h, 12, 'rgba(122,64,28,0.4)');
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = `rgba(60,52,38,${0.12 + Math.random() * 0.15})`;
      ctx.fillRect(Math.random() * w, Math.random() * h,
        2 + Math.random() * 9, 1 + Math.random() * 3);
    }
    noiseGray(ctx, w, h, 140, 24, 2000, 0.3);
  });

  // --- профлист (ангар) ---
  T.corrugated = makeTex(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8d8574';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const l = 128 + ((x / 16) % 2) * 26 + (Math.random() * 2 - 1) * 8;
      ctx.fillStyle = `rgb(${l | 0},${(l * 0.94) | 0},${(l * 0.82) | 0})`;
      ctx.fillRect(x, 0, 16, h);
    }
    rustDrips(ctx, w, h, 10, 'rgba(122,64,28,0.5)');
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.10 + Math.random() * 0.14})`;
      ctx.fillRect(Math.random() * w, Math.random() * h,
        3 + Math.random() * 12, 2 + Math.random() * 6);
    }
    noiseGray(ctx, w, h, 140, 20, 1600, 0.3);
  });

  // --- мешки с песком: рябь ткани и швы ---
  T.sandbag = makeTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#a3926b';
    ctx.fillRect(0, 0, w, h);
    noiseRGB(ctx, w, h, 163, 146, 107, 16, 5200, 0.55);
    for (let y = 8; y < h; y += 16) {
      ctx.fillStyle = 'rgba(84,72,48,0.4)';
      ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = 'rgba(210,196,160,0.18)';
      ctx.fillRect(0, y + 2, w, 1);
    }
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(70,60,40,${0.12 + Math.random() * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h,
        5 + Math.random() * 14, 4 + Math.random() * 10,
        Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // --- дерево ящиков: доски, гвозди, потёртости ---
  T.wood = makeTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7d6b4c';
    ctx.fillRect(0, 0, w, h);
    noiseRGB(ctx, w, h, 125, 107, 76, 15, 7000, 0.6);
    // волокна: волнистые горизонтальные штрихи
    for (let y = 0; y < h; y += 5) {
      ctx.strokeStyle = `rgba(58,48,30,${0.10 + Math.random() * 0.14})`;
      ctx.lineWidth = 1 + Math.random();
      ctx.beginPath();
      let px = 0, py = y + (Math.random() * 2 - 1);
      ctx.moveTo(px, py);
      while (px < w) {
        px += 12 + Math.random() * 22;
        py += (Math.random() * 2 - 1) * 2.4;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // сучки
    for (let i = 0; i < 7; i++) {
      const kx = Math.random() * w, ky = Math.random() * h;
      for (let r = 8; r >= 2; r -= 2) {
        ctx.strokeStyle = `rgba(46,38,24,${0.4 - r * 0.03})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r, r * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (let x = 0; x <= w; x += 32) {
      ctx.fillStyle = 'rgba(40,32,20,0.5)';
      ctx.fillRect(x - 1, 0, 2, h);
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(60,50,34,${0.15 + Math.random() * 0.2})`;
      ctx.fillRect(Math.random() * w, Math.random() * h,
        2 + Math.random() * 8, 2 + Math.random() * 6);
    }
    // гвозди
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = 'rgba(35,32,28,0.8)';
      ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 2, 2);
    }
    drawCracks(ctx, w, h, 4, 'rgba(45,38,26,0.4)');
  });

  // --- пылинка (мягкая точка) ---
  T.dust = makeTex(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
    g.addColorStop(0, 'rgba(222,206,170,0.9)');
    g.addColorStop(0.5, 'rgba(210,192,158,0.35)');
    g.addColorStop(1, 'rgba(200,182,148,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  // --- glow для солнца (additive, ловит bloom) ---
  T.glow = makeTex(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,252,240,1)');
    g.addColorStop(0.06, 'rgba(255,244,214,0.98)');
    g.addColorStop(0.16, 'rgba(255,214,140,0.5)');
    g.addColorStop(0.38, 'rgba(255,180,110,0.16)');
    g.addColorStop(1, 'rgba(255,170,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  // --- скайбокс: закатный градиент, облака, диск солнца, гряды ---
  T.sky = makeTex(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, '#3a639f');
    g.addColorStop(0.18, '#4d76b0');
    g.addColorStop(0.42, '#8fa8cf');
    g.addColorStop(0.50, '#ecc895');
    g.addColorStop(0.53, '#d9b98a');
    g.addColorStop(0.64, '#c3a075');
    g.addColorStop(1.00, '#b0895f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // облака — мягкие вытянутые пятна
    for (let i = 0; i < 40; i++) {
      const cx = Math.random() * w;
      const cy = 0.04 * h + Math.random() * 0.36 * h;
      const rw = 60 + Math.random() * 150;
      const rh = 12 + Math.random() * 26;
      const a = 0.05 + Math.random() * 0.11;
      const warm = Math.random() < 0.4;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rw / rh, 1);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rh);
      rg.addColorStop(0, warm ? `rgba(255,234,210,${a})` : `rgba(255,255,255,${a})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(0, 0, rh, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // диск солнца + широкое тёплое гало (направление света (28,42,18))
    // SphereGeometry: uv.y = 1 - v (верх текстуры = зенит), u = atan2(dz,-dx)/2π
    const sx = 0.4090 * w, sy = 0.7871 * h;
    let rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 0.16 * w);
    rg.addColorStop(0, 'rgba(255,214,150,0.55)');
    rg.addColorStop(0.4, 'rgba(255,190,120,0.2)');
    rg.addColorStop(1, 'rgba(255,180,110,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(sx - 0.17 * w, sy - 0.17 * w, 0.34 * w, 0.34 * w);
    rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 0.024 * w);
    rg.addColorStop(0, 'rgba(255,248,228,1)');
    rg.addColorStop(0.65, 'rgba(255,232,184,0.92)');
    rg.addColorStop(1, 'rgba(255,222,164,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(sx - 0.03 * w, sy - 0.03 * w, 0.06 * w, 0.06 * w);

    // дальние горные гряды у горизонта
    const ridge = (baseY, amp, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      const steps = 26;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const y = baseY - Math.abs(Math.sin(i * 0.55 + 2.1)) * amp - Math.random() * amp * 0.3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    };
    ridge(0.518 * h, 0.02 * h, 'rgba(124,101,76,0.45)');
    ridge(0.54 * h, 0.012 * h, 'rgba(104,83,62,0.5)');
  });

  return T;
}

// ---------- материалы (грязная палитра, без ярких цветов) ----------
function buildMaterials() {
  const T = buildTextures();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    T,
    asphalt: std({ map: T.asphalt, bumpMap: T.noise, bumpScale: 0.05, roughnessMap: T.noise, roughness: 0.92, metalness: 0.0 }),
    ground: std({ map: T.asphalt, bumpMap: T.groundNoise, bumpScale: 0.08, roughnessMap: T.groundNoise, roughness: 0.9, metalness: 0 }),
    sand: std({ map: T.sandPatch, transparent: true, depthWrite: false, roughness: 1, metalness: 0 }),
    marking: new THREE.MeshBasicMaterial({ map: T.marking, transparent: true, depthWrite: false }),
    concrete: std({ map: T.concrete, bumpMap: T.noise, bumpScale: 0.06, roughnessMap: T.noise, color: 0xc4b9a4, roughness: 0.9, metalness: 0.05 }),
    concreteDark: std({ map: T.concrete, bumpMap: T.noise, bumpScale: 0.06, roughnessMap: T.noise, color: 0x9d9080, roughness: 0.88, metalness: 0.05 }),
    rust: std({ map: T.metalRust, bumpMap: T.noise, bumpScale: 0.03, roughnessMap: T.noise, envMapIntensity: 0.7, roughness: 0.66, metalness: 0.55 }),
    olive: std({ map: T.metalOlive, bumpMap: T.noise, bumpScale: 0.025, roughnessMap: T.noise, envMapIntensity: 0.6, roughness: 0.65, metalness: 0.5 }),
    sandMetal: std({ map: T.metalSand, bumpMap: T.noise, bumpScale: 0.025, roughnessMap: T.noise, envMapIntensity: 0.6, roughness: 0.7, metalness: 0.5 }),
    corr: std({ map: T.corrugated, bumpMap: T.noise, bumpScale: 0.04, roughnessMap: T.noise, envMapIntensity: 0.7, color: 0x8a8578, roughness: 0.6, metalness: 0.7 }),
    sandbag: std({ map: T.sandbag, bumpMap: T.noise, bumpScale: 0.09, roughnessMap: T.noise, roughness: 0.95, metalness: 0 }),
    wood: std({ map: T.wood, bumpMap: T.noise, bumpScale: 0.12, roughnessMap: T.noise, roughness: 0.85, metalness: 0.02 }),
    window: std({ color: 0x060708, roughness: 0.95, metalness: 0 }),
    windowLit: std({ color: 0x3a2310, emissive: 0xff9a3c, emissiveIntensity: 1.7, roughness: 0.55, metalness: 0.05 }),
    lamp: std({ color: 0x3a3a38, emissive: 0xffb26a, emissiveIntensity: 0.22, roughness: 0.6, metalness: 0.4 }),
    pole: std({ color: 0x4a4a46, roughness: 0.7, metalness: 0.6 }),
    tire: std({ color: 0x1c1c1c, roughness: 0.95, metalness: 0 }),
    truck: std({ color: 0x8a7a5c, roughness: 0.85, metalness: 0.1 }),
    glass: std({ color: 0x12151a, roughness: 0.3, metalness: 0.4 })
  };
}

let M = null;

// добавить статичный меш в shootGroup (shootable + тени)
function addStatic(mesh, cast = true) {
  mesh.userData.shootable = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  shootGroup.add(mesh);
  return mesh;
}

// ---------- скайбокс ----------
function buildSky() {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.MeshBasicMaterial({
    map: M.T.sky, side: THREE.BackSide, fog: false, depthWrite: false
  });
  skyMesh = new THREE.Mesh(geo, mat);
  skyMesh.renderOrder = -1;
  skyMesh.frustumCulled = false;
  return skyMesh;
}

// ---------- солнце: спрайт-диск + glow (additive — ловит bloom) ----------
function buildSun() {
  const dir = new THREE.Vector3(28, 42, 18).normalize();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: M.T.glow,
    color: new THREE.Color(1.35, 1.2, 1.0),
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false
  }));
  sp.position.copy(dir).multiplyScalar(370);
  sp.scale.set(64, 64, 1);
  sp.renderOrder = 40;
  sp.frustumCulled = false;
  return sp;
}

// ---------- освещение (тёплый золотой полдень) ----------
function buildLights() {
  const hemi = new THREE.HemisphereLight(0x9fc0ff, 0x54432f, 0.5);
  const amb = new THREE.AmbientLight(0xfff1dd, 0.12);
  const sun = new THREE.DirectionalLight(0xffb066, 2.6);
  sun.position.set(28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 6;   // мягкая полутень (PCFShadowMap)
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  return [hemi, amb, sun];
}

// ---------- земля: асфальт + песчаные проплешины + разметка ----------
function buildGround() {
  const g = new THREE.PlaneGeometry(300, 300);
  g.rotateX(-Math.PI / 2);
  // плотный тайлинг — земля перестаёт быть «плоской заливкой»
  M.ground.map.repeat.set(16, 16); M.ground.map.needsUpdate = true;
  M.ground.bumpMap.repeat.set(16, 16); M.ground.bumpMap.needsUpdate = true;
  M.ground.roughnessMap.repeat.set(16, 16); M.ground.roughnessMap.needsUpdate = true;
  const mesh = new THREE.Mesh(g, M.ground);
  mesh.userData.shootable = true;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  shootGroup.add(mesh);

  // огромный непериодический шум-оверлей: рвёт равномерность тайлов
  const gndNoiseTex = makeTex(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const r = 30 + Math.random() * 120;
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
      g.addColorStop(0, `rgba(${30 + Math.random() * 40 | 0},${28 + Math.random() * 36 | 0},${24 + Math.random() * 30 | 0},${0.10 + Math.random() * 0.16})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(Math.random() * w, Math.random() * h);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  });
  gndNoiseTex.wrapS = gndNoiseTex.wrapT = THREE.ClampToEdgeWrapping;
  const gnm = new THREE.Mesh(new THREE.PlaneGeometry(300, 300),
    new THREE.MeshBasicMaterial({ map: gndNoiseTex, transparent: true, depthWrite: false, opacity: 0.55 }));
  gnm.rotation.x = -Math.PI / 2;
  gnm.position.set(0, 0.03, 0);
  gnm.renderOrder = 4;
  shootGroup.add(gnm);

  // песчаные участки
  const patches = [
    [-24, 8, 16, 10, 0.3], [10, -14, 14, 9, -0.5],
    [4, 18, 12, 8, 0.9], [-10, 18, 10, 7, -0.2],
    [22, 2, 9, 6, 0.6], [-28, -16, 12, 8, -0.7]
  ];
  for (const [px, pz, pw, ph, rot] of patches) {
    const pg = new THREE.PlaneGeometry(pw, ph);
    pg.rotateX(-Math.PI / 2);
    const pm = new THREE.Mesh(pg, M.sand);
    pm.position.set(px, 0.015, pz);
    pm.rotation.z = rot;
    pm.receiveShadow = true;
    pm.renderOrder = 1;
    shootGroup.add(pm);
  }

  // потёртая жёлтая линия вдоль двора
  const lg = new THREE.PlaneGeometry(66, 2.6);
  lg.rotateX(-Math.PI / 2);
  const lm = new THREE.Mesh(lg, M.marking);
  lm.position.set(0, 0.02, 0);
  lm.renderOrder = 2;
  shootGroup.add(lm);

  // крупные непериодические пятна грязи/износа (рвут тайлинг-«сетку»)
  const stainTex = makeTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const r = 20 + Math.random() * 70;
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
      g.addColorStop(0, 'rgba(58,52,42,0.4)');
      g.addColorStop(1, 'rgba(58,52,42,0)');
      ctx.save();
      ctx.translate(Math.random() * w, Math.random() * h);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  });
  stainTex.wrapS = stainTex.wrapT = THREE.ClampToEdgeWrapping;
  const stains = [[-14, 6, 26, 20], [18, -10, 34, 24], [4, 16, 22, 16], [-26, -18, 30, 22], [12, 8, 28, 18]];
  for (const [sx, sz, sw, sh] of stains) {
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh),
      new THREE.MeshBasicMaterial({ map: stainTex, transparent: true, depthWrite: false }));
    sm.rotation.x = -Math.PI / 2;
    sm.position.set(sx, 0.022, sz);
    sm.renderOrder = 3;
    shootGroup.add(sm);
  }
}

// ---------- периметр: бетонные стены 3.5 м с повреждениями ----------
const WALL_H = 3.5;
function addBox(x, y, z, sx, sy, sz, mat, rx = 0, ry = 0, rz = 0, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return addStatic(m, cast);
}

function addCol(x, z, hw, hd, tag, height = WALL_H, rotation = 0) {
  colliders.push({ x, z, hw, hd, tag: tag || '', height, rotation });
}

function buildPerimeter() {
  const C = M.concrete;
  // сегменты: [x, z, hw(вдоль X), hd(вдоль Z)] — ось бокса совпадает с коллайдером
  const segs = [
    // юг (z=25), ворота x∈[-8,8]
    [-21.5, 25, 13.5, 0.3], [21.5, 25, 13.5, 0.3],
    // север (z=-25), два пролома x∈[-10,-3.5] и x∈[3.5,10]
    [-22.5, -25, 12.5, 0.3], [0, -25, 3.5, 0.3], [22.5, -25, 12.5, 0.3],
    // запад (x=-35)
    [-35, -12.5, 0.3, 12.5], [-35, 12.5, 0.3, 12.5],
    // восток (x=35)
    [35, -18.5, 0.3, 6.5], [35, 0, 0.3, 12], [35, 18.5, 0.3, 6.5]
  ];
  for (const [x, z, hw, hd] of segs) {
    addBox(x, WALL_H / 2, z, hw * 2, WALL_H, hd * 2, C);
    addCol(x, z, hw, hd, 'wall', WALL_H);
  }

  // ворота: два бетонных пилона
  addBox(-8, 1.5, 25, 1.0, 3.0, 1.0, C);
  addBox(8, 1.5, 25, 1.0, 3.0, 1.0, C);

  // повреждения: сколотые зубцы на верху стен
  const dmgSpots = [[-21.5, 25, 1], [22.5, -25, 0], [-35, -12.5, 1], [35, 0, 0]];
  for (const [x, z] of dmgSpots) {
    for (let i = 0; i < 2; i++) {
      const s = 0.7 + Math.random() * 0.9;
      addBox(x + (Math.random() * 2 - 1) * 8, WALL_H - 0.15,
        z + (Math.random() * 2 - 1) * (Math.abs(z) > 20 ? 3 : 7),
        s, 0.55, s * 0.8, C, 0, 0, (Math.random() - 0.5) * 0.8);
    }
  }
  // завалы у углов
  addRubble(-33, -23, 3);
  addRubble(33, 23, 3);
}

// куча щебня из наклонённых глыб
function addRubble(x, z, n) {
  for (let i = 0; i < n; i++) {
    const s = 0.5 + Math.random() * 0.9;
    addBox(x + (Math.random() * 2 - 1) * 1.6, s * 0.45,
      z + (Math.random() * 2 - 1) * 1.6, s, s * 0.8, s * 0.7, M.concreteDark,
      (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9);
  }
}

// ---------- двухэтажное бетонное здание (окна-проёмы, выбитые) ----------
function buildBuilding() {
  const CX = -22, CZ = -4, W = 16, D = 9, H = 7.5, TH = 0.5;
  const C = M.concreteDark, Win = M.windowLit;
  const eastX = CX + W / 2, westX = CX - W / 2, northZ = CZ - D / 2, southZ = CZ + D / 2;

  // каркас: 4 стены + перекрытие + крыша
  addBox(eastX, H / 2, CZ, TH, H, D, C);          // восток (во двор)
  addBox(westX, H / 2, CZ, TH, H, D, C);
  addBox(CX, H / 2, northZ, W, H, TH, C);
  addBox(CX, H / 2, southZ, W, H, TH, C);
  addBox(CX, 3.75, CZ, W, 0.3, D, C);              // межэтажное перекрытие
  addBox(CX, H + 0.17, CZ, W + TH * 2, 0.35, D + TH * 2, M.concrete);

  // парапет крыши
  addBox(eastX, H + 0.55, CZ, TH, 0.5, D, C);
  addBox(westX, H + 0.55, CZ, TH, 0.5, D, C);
  addBox(CX, H + 0.55, northZ, W, 0.5, TH, C);
  addBox(CX, H + 0.55, southZ, W, 0.5, TH, C);
  // кондиционер и труба на крыше
  addBox(CX - 2, H + 0.75, CZ + 1.5, 1.1, 0.7, 0.9, M.rust);
  addBox(CX + 4, H + 0.75, CZ - 2, 0.4, 1.1, 0.4, M.pole);

  // тёмные проёмы окон (2 этажа), чуть выступают из стен
  const win = (fx, fz, wy, rx, ry, rz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.4, 0.09), Win);
    m.position.set(fx, wy, fz);
    m.rotation.set(rx, ry, rz);
    return addStatic(m, false);
  };
  const push = 0.34; // выступ за плоскость стены
  // восточный фасад: 3+3 окна
  for (const z of [-6.2, -3.1, 0]) {
    win(eastX + push, z, 1.55, 0, 0, 0);
    win(eastX + push, z, 5.15, 0, 0, 0);
  }
  // северный фасад: 3+3 окна
  for (const x of [-26, -22, -18]) {
    win(x, northZ - push, 1.55, 0, Math.PI / 2, 0);
    win(x, northZ - push, 5.15, 0, Math.PI / 2, 0);
  }
  // южный фасад: 2+2 окна
  for (const x of [-25, -19]) {
    win(x, southZ + push, 1.55, 0, Math.PI / 2, 0);
    win(x, southZ + push, 5.15, 0, Math.PI / 2, 0);
  }
  // западный фасад: одно выбитое окно + пролом
  win(westX - push, -1, 1.55, 0, 0, 0);
  const breach = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 0.09), Win);
  breach.position.set(westX - push, 4.9, 3);
  addStatic(breach, false);

  // осыпавшийся угол
  addRubble(CX - W / 2 + 1.5, CZ + D / 2 + 0.5, 4);
  addRubble(CX - W / 2 + 2.5, CZ - D / 2 + 0.5, 3);

  addCol(CX, CZ, W / 2 + TH / 2, D / 2 + TH / 2, 'building', H);
}

// ---------- сторожевая вышка (~6 м, дерево/металл, лестница) ----------
function buildTower() {
  const TX = 14, TZ = -16;
  const Wd = M.wood, Rust = M.rust;
  // ноги
  for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
    addBox(TX + lx, 3.1, TZ + lz, 0.25, 6.2, 0.25, Wd);
  }
  // раскосы (X-образно, упрощённо)
  addBox(TX, 2.2, TZ - 1.1, 2.1, 0.12, 0.12, Wd, 0, 0, 0.5);
  addBox(TX, 2.2, TZ + 1.1, 2.1, 0.12, 0.12, Wd, 0, 0, -0.5);
  // платформа
  addBox(TX, 6.15, TZ, 3.0, 0.15, 3.0, Wd);
  // перила
  addBox(TX, 6.55, TZ - 1.5, 3.0, 0.1, 0.08, Wd);
  addBox(TX, 6.55, TZ + 1.5, 3.0, 0.1, 0.08, Wd);
  addBox(TX - 1.5, 6.55, TZ, 0.08, 0.1, 3.0, Wd);
  addBox(TX + 1.5, 6.55, TZ, 0.08, 0.1, 3.0, Wd);
  // крыша на столбиках
  addBox(TX, 7.35, TZ, 3.5, 0.1, 3.5, Rust);
  for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    addBox(TX + lx, 6.75, TZ + lz, 0.1, 0.9, 0.1, Wd);
  }
  // лестница (южная сторона): поручни + перекладины
  addBox(TX + 0.42, 3.4, TZ + 1.55, 0.06, 5.6, 0.06, Wd, 0, 0, 0.09);
  addBox(TX - 0.42, 3.4, TZ + 1.55, 0.06, 5.6, 0.06, Wd, 0, 0, 0.09);
  for (const ry of [1.2, 2.4, 3.6, 4.8]) {
    addBox(TX, ry, TZ + 1.6, 0.9, 0.05, 0.05, Wd);
  }

  addCol(TX, TZ, 1.35, 1.35, 'tower', 6.2);
}

// ---------- ангар-навес из профлиста на столбах ----------
function buildHangar() {
  const HX = 16, HZ = 8;
  // столбы
  for (const [px, pz] of [[10, 5], [16, 5], [22, 5], [10, 11], [16, 11], [22, 11]]) {
    addBox(HX + (px - HX), 1.6, HZ + (pz - HZ), 0.22, 3.2, 0.22, M.rust);
    addCol(px, pz, 0.16, 0.16, 'hangar', 3.2);
  }
  // крыша из профлиста
  addBox(HX, 3.28, HZ, 12.6, 0.14, 6.6, M.corr);
  // боковая стенка (западный торец)
  addBox(9.9, 1.3, HZ, 0.1, 2.6, 6.6, M.corr);
}

// ---------- морские контейнеры (рёбра жёсткости, ржавчина) ----------
function makeContainer(len, w, h, mat, x, z, ry, tilt) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, h, w), mat);
  body.userData.shootable = true;
  body.castShadow = true; body.receiveShadow = true;
  grp.add(body);
  // угловые рёбра жёсткости
  for (const [cx, cz] of [[-len / 2 + 0.06, -w / 2 + 0.06], [len / 2 - 0.06, -w / 2 + 0.06],
    [-len / 2 + 0.06, w / 2 - 0.06], [len / 2 - 0.06, w / 2 - 0.06]]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.14, h, 0.14), M.pole);
    rib.position.set(cx, 0, cz);
    rib.userData.shootable = true;
    rib.castShadow = true; rib.receiveShadow = true;
    grp.add(rib);
  }
  grp.position.set(x, h / 2, z);
  grp.rotation.y = ry;
  if (tilt === 'side') grp.rotation.z = Math.PI / 2;
  shootGroup.add(grp);
  return grp;
}

function buildContainers() {
  // оливковый, стоит ровно (лёгкий поворот)
  makeContainer(6, 2.4, 2.6, M.olive, -6, -12, 0.05);
  addCol(-6, -12, 3.0, 1.2, 'container', 2.6, 0.05);
  // ржаво-оранжевый, лежит на боку (смятый)
  makeContainer(6, 2.4, 2.6, M.rust, 10, -4, 0, 'side');
  addCol(10, -4, 3.0, 1.3, 'container', 1.3);
  // песочный, стоит у западной стороны
  makeContainer(6, 2.4, 2.6, M.sandMetal, -16, 12, -0.1);
  addCol(-16, 12, 3.0, 1.2, 'container', 2.6, -0.1);
}

// ---------- мешки с песком (2 ряда по 4, два слоя, ~1.1 м) ----------
function sandbagRow(x, z0, dir) {
  for (let layer = 0; layer < 2; layer++) {
    const y = 0.275 + layer * 0.55;
    const off = layer === 0 ? 0 : 0.55;
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.55), M.sandbag);
      m.position.set(x, y, z0 + i * 1.1 + off);
      m.rotation.y = (Math.random() - 0.5) * 0.1 * dir;
      addStatic(m);
    }
  }
}

function buildCover() {
  // два ряда по бокам подхода к центру двора
  sandbagRow(-3.4, 6.5, 1);
  sandbagRow(3.4, 6.5, -1);
  addCol(-3.4, 7.05, 0.3, 0.95, 'sandbags', 1.1);
  addCol(-3.4, 9.25, 0.3, 1.1, 'sandbags', 1.1);
  addCol(3.4, 7.05, 0.3, 0.95, 'sandbags', 1.1);
  addCol(3.4, 9.25, 0.3, 1.1, 'sandbags', 1.1);
  // одиночные мешки у укрытий
  const singles = [[5.2, 5.4], [-7.2, 4.2], [-2.2, -7.2]];
  for (const [sx, sz] of singles) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.55), M.sandbag);
    m.position.set(sx, 0.275, sz);
    m.rotation.y = (Math.random() - 0.5) * 0.4;
    addStatic(m);
  }

  // ящики и паллеты
  addBox(-8, 0.625, 5, 1.25, 1.25, 1.25, M.wood);       // низ стопки
  addBox(-8, 1.875, 5, 1.25, 1.25, 1.25, M.wood);       // верх стопки
  addCol(-8, 5, 0.65, 0.65, 'crates', 2.5);
  addBox(6, 0.07, 6, 1.5, 0.14, 1.5, M.wood);           // паллета
  addBox(5.5, 0.19, 6, 0.14, 0.1, 1.3, M.wood);
  addBox(6.5, 0.19, 6, 0.14, 0.1, 1.3, M.wood);
  addBox(6, 0.79, 6, 1.25, 1.25, 1.25, M.wood);          // ящик на паллете
  addCol(6, 6, 0.75, 0.75, 'crates', 1.4);
  addBox(-14, 0.625, -8, 1.25, 1.25, 1.25, M.wood);
  addCol(-14, -8, 0.65, 0.65, 'crates', 1.25);

  // бочки
  const barrels = [[-3.2, -7.8], [-2.6, -8.4], [-3.6, -8.7]];
  for (const [bx, bz] of barrels) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), M.rust);
    b.position.set(bx, 0.45, bz);
    addStatic(b);
    addCol(bx, bz, 0.3, 0.3, 'barrel', 0.9);
  }

  // куча щебня в северном проломе
  addRubble(6.75, -25, 6);
  addCol(6.75, -25, 2.0, 1.0, 'rubble', 0.9);
}

// ---------- фонарные столбы (едва светящиеся плафоны + PointLight) ----------
function buildLamps(scene) {
  const spots = [[-7, 9, -1], [13, -9, 1], [5, 15, -1]];
  for (const [lx, lz, armDir] of spots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 5.0, 8), M.pole);
    pole.position.set(lx, 2.5, lz);
    addStatic(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.14, 8), M.concrete);
    base.position.set(lx, 0.07, lz);
    addStatic(base, false);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), M.pole);
    arm.position.set(lx, 4.95, lz + armDir * 0.25);
    arm.rotation.z = armDir > 0 ? -0.5 : 0.5;
    addStatic(arm);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.28), M.lamp);
    lamp.position.set(lx, 4.85, lz + armDir * 0.55);
    addStatic(lamp);
    const light = new THREE.PointLight(0xffb06a, 0.5, 10, 2);
    light.position.set(lx, 4.8, lz + armDir * 0.55);
    scene.add(light);
    lamps.push({ light, phase: Math.random() * Math.PI * 2 });
    addCol(lx, lz, 0.12, 0.12, 'lamp', 5);
  }
}

// ---------- колючая проволока (столбики + нити) ----------
function buildWire() {
  const FX = 33.4;
  for (let z = -8; z <= 4; z += 2) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), M.rust);
    p.position.set(FX, 0.65, z);
    addStatic(p);
  }
  for (const y of [0.55, 0.8, 1.05]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 12.4, 5), M.rust);
    s.rotation.x = Math.PI / 2;
    s.position.set(FX, y, -2);
    addStatic(s);
  }
  addCol(FX, -3, 0.15, 7, 'wire', 1.3);
}

// ---------- припаркованный пикап (кабина, кузов, колёса) ----------
function buildPickup() {
  const PX = -18, PZ = 18;
  // кузов
  addBox(PX - 1.3, 0.72, PZ, 2.0, 0.6, 1.9, M.truck);
  // кабина
  addBox(PX + 0.6, 1.35, PZ, 1.8, 1.9, 1.9, M.truck);
  // капот
  addBox(PX + 1.9, 0.52, PZ, 0.8, 0.45, 1.9, M.truck);
  // стёкла
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.65, 1.7), M.glass);
  glass.position.set(PX + 1.52, 1.62, PZ);
  glass.rotation.z = -0.18;
  addStatic(glass);
  // колёса
  for (const [wx, wz] of [[-2.1, -0.95], [-2.1, 0.95], [1.0, -0.95], [1.0, 0.95]]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.25, 10), M.tire);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(PX + wx, 0.38, PZ + wz);
    addStatic(wh);
  }
  // бампер
  addBox(PX + 2.35, 0.35, PZ, 1.9, 0.15, 0.12, M.pole);
  addCol(PX, PZ, 2.3, 1.0, 'pickup', 2.3);
}

// ---------- пыль в воздухе (Points, медленный дрейф) ----------
function buildDust() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N; i++) {
    const i3 = i * 3;
    dustBase[i3] = (Math.random() * 2 - 1) * 38;
    dustBase[i3 + 1] = 0.15 + Math.random() * 3.0;
    dustBase[i3 + 2] = (Math.random() * 2 - 1) * 34;
    dustPh[i] = Math.random() * Math.PI * 2;
    pos[i3] = dustBase[i3];
    pos[i3 + 1] = dustBase[i3 + 1];
    pos[i3 + 2] = dustBase[i3 + 2];
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustPosAttr = geo.attributes.position;
  const mat = new THREE.PointsMaterial({
    map: M.T.dust, color: 0xd9c8a4, size: 0.5,
    transparent: true, opacity: 0.32, depthWrite: false, sizeAttenuation: true
  });
  dustPoints = new THREE.Points(geo, mat);
  dustPoints.frustumCulled = false;
  dustPoints.renderOrder = 10;
  // второй слой: крупная тёмная пыль — глубина и объём взвеси
  const geo2 = geo.clone();
  const mat2 = new THREE.PointsMaterial({
    map: M.T.dust, color: 0xcbb68f, size: 1.2,
    transparent: true, opacity: 0.13, depthWrite: false, sizeAttenuation: true
  });
  const dustPoints2 = new THREE.Points(geo2, mat2);
  dustPoints2.frustumCulled = false;
  dustPoints2.renderOrder = 9;
  const group = new THREE.Group();
  group.add(dustPoints, dustPoints2);
  dustLayers = [
    { points: dustPoints, attr: dustPosAttr, sp: 1.0 },
    { points: dustPoints2, attr: geo2.attributes.position, sp: 0.45 }
  ];
  return group;
}

// ============================================================
//  API
// ============================================================
// ---------- мелкий декор: камни, доски, гильзы, обломки ----------
function buildDeco() {
  const stoneMats = [0x8a8177, 0x756d63, 0x99907f, 0x6f675d].map(c =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0 }));
  const plankMats = [M.wood, M.concrete, M.rust];
  for (let i = 0; i < 55; i++) {
    let x = 0, z = 0, guard = 0;
    do {
      x = (Math.random() * 2 - 1) * 30;
      z = (Math.random() * 2 - 1) * 22;
      guard++;
    } while (guard < 12 && (Math.abs(x) < 3.5 && z > 6 && z < 20)); // коридор спавна свободен
    const r = Math.random();
    let m;
    if (r < 0.45) {
      const s = 0.12 + Math.random() * 0.3;
      m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stoneMats[(Math.random() * stoneMats.length) | 0]);
      m.scale.y = 0.6 + Math.random() * 0.5;
      m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    } else if (r < 0.78) {
      const w = 0.5 + Math.random() * 1.4;
      m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05 + Math.random() * 0.08, 0.12 + Math.random() * 0.3), plankMats[(Math.random() * plankMats.length) | 0]);
      m.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
    } else {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.045, 6), M.rust);
      m.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 1.2, Math.random() * Math.PI, 0);
    }
    m.position.set(x, 0.05 + Math.random() * 0.06, z);
    m.receiveShadow = true;
    m.userData.shootable = true;
    shootGroup.add(m);
  }
}

// ---------- дальний план: силуэты на горизонте ----------
function buildSkyline() {
  const silMat = new THREE.MeshBasicMaterial({ color: 0x4a4238, fog: true });
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
    const rad = 150 + Math.random() * 30;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const kind = Math.random();
    let m;
    if (kind < 0.4) {
      const w = 8 + Math.random() * 14, h = 6 + Math.random() * 16, d = 6 + Math.random() * 10;
      m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), silMat);
      m.position.y = h / 2 - 1;
      m.rotation.y = Math.random() * Math.PI;
    } else if (kind < 0.7) {
      const h = 10 + Math.random() * 14;
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.6, h, 5), silMat);
      m.position.y = h / 2;
    } else {
      m = new THREE.Mesh(new THREE.ConeGeometry(6 + Math.random() * 8, 5 + Math.random() * 9, 6), silMat);
      m.position.y = 1;
      m.rotation.y = Math.random() * Math.PI;
    }
    m.position.x = x; m.position.z = z;
    m.renderOrder = -2;
    shootGroup.add(m);
  }
}

// ---------- облака: альфа-планины, медленный дрейф ----------
function buildClouds() {
  const ctex = makeTex(256, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const r = 18 + Math.random() * 46;
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
      g.addColorStop(0, 'rgba(255,250,240,0.95)');
      g.addColorStop(0.55, 'rgba(255,248,236,0.55)');
      g.addColorStop(1, 'rgba(255,248,236,0)');
      ctx.save();
      ctx.translate(Math.random() * w, Math.random() * h);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  });
  const group = new THREE.Group();
  group.name = 'clouds';
  const layers = [
    { y: 35, scale: 1.6, opacity: 0.8, n: 8, tint: 0xfff0da },
    { y: 60, scale: 2.2, opacity: 0.6, n: 8, tint: 0xffffff },
    { y: 88, scale: 3.0, opacity: 0.42, n: 7, tint: 0xdfe8ff }
  ];
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: ctex, transparent: true, opacity: L.opacity, depthWrite: false, fog: false, color: L.tint, side: THREE.DoubleSide });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(90 * L.scale, 40 * L.scale), mat);
      p.position.set((Math.random() * 2 - 1) * 260, L.y, (Math.random() * 2 - 1) * 190);
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = Math.random() * Math.PI;
      group.add(p);
    }
  }
  // ближний слой: крупные облака прямо над ареной — всегда в кадре
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshBasicMaterial({ map: ctex, transparent: true, opacity: 0.7, depthWrite: false, fog: false, color: 0xfff2dc, side: THREE.DoubleSide });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(110 + Math.random() * 80, 50 + Math.random() * 30), mat);
    const ang = Math.random() * Math.PI * 2;
    const rad = 60 + Math.random() * 70;
    p.position.set(Math.cos(ang) * rad, 40 + Math.random() * 16, Math.sin(ang) * rad);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = Math.random() * Math.PI;
    group.add(p);
  }
  // billboard-облака (Sprite — всегда лицом к камере, видны с любого ракурса)
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ctex, transparent: true, opacity: 0.55 + Math.random() * 0.2,
      depthWrite: false, fog: false, color: Math.random() < 0.5 ? 0xfff2dc : 0xffffff
    }));
    const ang = Math.random() * Math.PI * 2;
    const rad = 45 + Math.random() * 70;
    s.scale.set(50 + Math.random() * 45, 22 + Math.random() * 20, 1);
    s.position.set(Math.cos(ang) * rad, 30 + Math.random() * 26, Math.sin(ang) * rad);
    group.add(s);
  }
  return group;
}

export function init(g) {
  if (!g || !g.scene) return;
  if (built) {
    // повторный вызов — просто убедиться, что группа в сцене
    if (g.staticGroup && !g.staticGroup.parent) g.scene.add(g.staticGroup);
    return;
  }
  built = true;

  M = buildMaterials();
  shootGroup = new THREE.Group();
  shootGroup.name = 'staticWorld';

  // атмосфера: туман, скайбокс, солнце, свет
  g.scene.fog = new THREE.Fog(0xd8bc98, 50, 235);
  const sky = buildSky();
  g.scene.add(sky);
  g.scene.add(buildSun());
  for (const l of buildLights()) g.scene.add(l);

  // лёгкое окружение для PBR-отражений (тёплый закат) — металл получает блики
  try {
    const pmrem = new THREE.PMREMGenerator(g.renderer);
    const envScene = new THREE.Scene();
    const envTex = makeTex(64, 32, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#6f96c9');
      grad.addColorStop(0.45, '#e8c49a');
      grad.addColorStop(0.62, '#f7d9a8');
      grad.addColorStop(1, '#7d6144');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
    const envMesh = new THREE.Mesh(
      new THREE.SphereGeometry(10, 16, 16),
      new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide })
    );
    envScene.add(envMesh);
    const envRT = pmrem.fromScene(envScene, 0.03);
    g.scene.environment = envRT.texture;
    if ('environmentIntensity' in g.scene) g.scene.environmentIntensity = 0.45;
    pmrem.dispose();
  } catch (e) { console.warn('env map failed', e); }

  // мир
  buildGround();
  buildPerimeter();
  buildBuilding();
  buildTower();
  buildHangar();
  buildContainers();
  buildCover();
  buildLamps(g.scene);
  buildWire();
  buildPickup();
  buildDeco();
  buildSkyline();
  cloudGroup = buildClouds();
  g.scene.add(cloudGroup);
  g.scene.add(buildDust());

  g.scene.add(shootGroup);
  g.staticGroup = shootGroup;
}

export function update(dt, g) {
  if (!built) return;
  if (!(typeof dt === 'number' && dt > 0)) dt = 0.016;
  _t += dt;
  const t = _t;

  // медленный дрейф пыли (без аллокаций), 2 слоя
  for (const layer of dustLayers) {
    const pos = layer.attr.array;
    const sp = layer.sp;
    for (let i = 0; i < DUST_N; i++) {
      const i3 = i * 3;
      const ph = dustPh[i];
      pos[i3] = dustBase[i3] + Math.sin(t * 0.16 * sp + ph) * 0.9;
      pos[i3 + 1] = dustBase[i3 + 1] + Math.sin(t * 0.1 * sp + ph * 2.1) * 0.22;
      pos[i3 + 2] = dustBase[i3 + 2] + Math.cos(t * 0.13 * sp + ph * 1.3) * 0.9;
    }
    layer.attr.needsUpdate = true;
  }

  // едва заметное мерцание фонарей
  for (const l of lamps) {
    if (!l.light) continue;
    l.light.intensity = 0.4 + Math.sin(t * 2.4 + l.phase) * 0.06
      + Math.sin(t * 7.3 + l.phase * 3.0) * 0.012;
  }

  // лёгкий дрейф облаков
  if (skyMesh) skyMesh.rotation.y += dt * 0.0022;
  if (cloudGroup) cloudGroup.rotation.y += dt * 0.0012;
}

export function getColliders() {
  return colliders;
}

export function getShootables() {
  return shootGroup;
}

// кинематографичные точки для demo-камеры (позиция + взгляд)
export function demoWaypoints() {
  return [
    { p: [0, 2.2, 18], l: [0, 1.8, -2] },       // от спавна к центру двора
    { p: [-13, 2.6, 15], l: [2, 1.8, -6] },     // запад: на здание и двор
    { p: [5.5, 2.4, -6], l: [-14, 2.0, -4] },   // контейнеры, взгляд на здание
    { p: [20, 2.8, 14], l: [2, 1.6, 2] },       // ангар, взгляд в центр
    { p: [-6, 2.3, -16], l: [10, 1.6, -12] },   // север: вышка и контейнеры
    { p: [6, 2.2, 20], l: [-4, 1.6, 6] },       // юг: весь двор
    { p: [2, 2.4, 4], l: [0, 30, -10] },        // зенит: облака над двором
    { p: [-8, 2.6, 12], l: [8, 22, -8] }        // небо + силуэты + облака
  ];
}
