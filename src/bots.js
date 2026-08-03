// ============================================================
//  ВРАГИ: солдаты-гуманоиды из примитивов
//  Патруль / атака / смерть, стрельба очередями по игроку, кровь.
//  Модуль: init, update, spawnBots, getGroup, getBots,
//          applyDamage, respawnAll
//  Контракт GAME (g) — см. main.js. Мир — mods.world.
// ============================================================
import * as THREE from 'three';
import { applyEnemyDamage } from './core/gameplay.js';
import { isBlockedByWall, rayCapsuleDistance } from './core/ballistics.js';
import { resolveCapsuleMotion, pointBlockedByCollider } from './core/collision.js';
import { getEnemyDefinition } from './data/enemies/index.js';
import { ConnectorAwarePlanner, NavigationAgent } from './expedition/navigation.js';

// Зависимости приходят через g.services, чтобы боевой, мировой и UI-модули не образовывали цикл.
let gRef = null;
const getWorld = () => {
  const legacy = gRef?.services?.world || { getColliders: () => [], getShootables: () => null };
  const expedition = gRef?.expeditionScene;
  if (!expedition) return legacy;
  return {
    getColliders: () => expedition.colliders ?? [],
    getShootables: () => expedition.group ?? legacy.getShootables?.() ?? null,
  };
};
const sfx = (n, v) => gRef?.services?.ui?.sfx?.(n, v);

// ============================================================
//  ОБЩИЕ РЕСУРСЫ (создаются один раз, переиспользуются всеми ботами)
// ============================================================
let GEO = null;
let pouchGeo = null;   // общая геометрия подсумков (создаётся лениво)
let bandGeo = null;     // красная повязка фракции «чужие»
let markerTex = null;   // текстура маркера врага (красный треугольник)

function makeMarkerTex() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = '#e53935';
  ctx.beginPath();
  ctx.moveTo(16, 2); ctx.lineTo(30, 26); ctx.lineTo(2, 26);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(16, 10); ctx.lineTo(23, 21); ctx.lineTo(9, 21);
  ctx.closePath(); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ============================================================
//  ПОДСУМКИ С ПАТРОНАМИ: дроп с убитых врагов, подбор проходом
// ============================================================
let pickupGroup = null, pickupGeo = null, pickupMat = null, pickupBandMat = null;
const pickups = [];
const PICKUP_MAX = 10, PICKUP_LIFE = 45, PICKUP_RADIUS = 1.7;

function initPickups(scene) {
  pickupGroup = new THREE.Group();
  pickupGroup.name = 'pickups';
  scene.add(pickupGroup);
  pickupGeo = new THREE.BoxGeometry(0.3, 0.2, 0.2);
  pickupMat = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.7, metalness: 0.35 });
  pickupBandMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff8c2e, emissiveIntensity: 1.5, roughness: 0.5, metalness: 0.2 });
}

function dropPickup(g, pos) {
  if (!pickupGroup) return;
  if (pickups.length >= PICKUP_MAX) { // вытеснить старейший
    const old = pickups.shift();
    pickupGroup.remove(old.mesh);
  }
  const m = new THREE.Mesh(pickupGeo, pickupMat);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.06, 0.21), pickupBandMat);
  band.position.y = 0.05;
  m.add(band);
  m.position.set(pos.x, 0.3, pos.z);
  m.rotation.y = Math.random() * Math.PI * 2;
  pickupGroup.add(m);
  pickups.push({ mesh: m, t: 0, life: PICKUP_LIFE });
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    pk.t += dt;
    pk.mesh.position.y = 0.3 + Math.sin(pk.t * 2.2) * 0.06;   // боббинг
    pk.mesh.rotation.y += dt * 1.2;                            // вращение
    if (pk.t > pk.life) { pickupGroup.remove(pk.mesh); pickups.splice(i, 1); continue; }
    // подбор игроком (в demo не подбираем — просто лежат)
    if (!gRef || gRef.demo) continue;
    const pp = gRef.player.pos;
    const dx = pp.x - pk.mesh.position.x, dz = pp.z - pk.mesh.position.z;
    if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
      const st = gRef.state;
      if (st.ammo < st.magSize || st.reserve < 240) {
        st.ammo = st.magSize;
        st.reserve = Math.min(240, st.reserve + 60);
        sfx('pickup', 0.7);
        pickupGroup.remove(pk.mesh);
        pickups.splice(i, 1);
      }
    }
  }
}
function buildGeos() {
  if (GEO) return GEO;
  GEO = {
    leg: new THREE.BoxGeometry(0.22, 0.78, 0.26),
    boot: new THREE.BoxGeometry(0.24, 0.12, 0.3),
    torso: new THREE.BoxGeometry(0.52, 0.62, 0.3),
    vest: new THREE.BoxGeometry(0.42, 0.4, 0.08),
    head: new THREE.BoxGeometry(0.3, 0.3, 0.3),
    helm: new THREE.BoxGeometry(0.35, 0.13, 0.37),
    arm: new THREE.BoxGeometry(0.16, 0.7, 0.18),
    foreArm: new THREE.BoxGeometry(0.14, 0.3, 0.16),
    hand: new THREE.BoxGeometry(0.1, 0.05, 0.12),
    finger: new THREE.BoxGeometry(0.03, 0.03, 0.13),
    recv: new THREE.BoxGeometry(0.06, 0.1, 0.36),
    barrel: (() => { const b = new THREE.CylinderGeometry(0.021, 0.021, 0.42, 6); b.rotateX(Math.PI / 2); return b; })(),
    mag: new THREE.BoxGeometry(0.05, 0.2, 0.08),
    stock: new THREE.BoxGeometry(0.05, 0.09, 0.18),
    grip: new THREE.BoxGeometry(0.04, 0.12, 0.05)
  };
  return GEO;
}

// canvas-текстура камуфляжа: база + шумные пятна
function makeCamoTex(base, blotches) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 48; i++) {
    ctx.globalAlpha = 0.3 + Math.random() * 0.45;
    ctx.fillStyle = blotches[(Math.random() * blotches.length) | 0];
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 2 + Math.random() * 9, 2 + Math.random() * 7);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 3 варианта палитры: олива / песок / тёмная
const PALETTES = [
  { camo: '#4a4f35', blotches: ['#39402a', '#575c3c', '#33371f'], helmet: '#3d4229', vest: '#3a3e2b', skin: '#8a6b4f', boots: '#1d1c16' },
  { camo: '#8a7a52', blotches: ['#7a6a44', '#96865e', '#6b5c39'], helmet: '#6e5f3e', vest: '#75653f', skin: '#a07850', boots: '#2a241a' },
  { camo: '#33343a', blotches: ['#26272c', '#3c3e46', '#1e1f24'], helmet: '#2c2d33', vest: '#4a2626', skin: '#7a5c42', boots: '#101013' }
];

let MATS = null; // { palettes:[{uni,helm,vest,skin,boots}], weapon }
function buildMats() {
  if (MATS) return MATS;
  MATS = {
    palettes: PALETTES.map(p => ({
      uni: new THREE.MeshLambertMaterial({ map: makeCamoTex(p.camo, p.blotches), color: 0xffffff }),
      helm: new THREE.MeshLambertMaterial({ color: new THREE.Color(p.helmet) }),
      vest: new THREE.MeshLambertMaterial({ color: new THREE.Color(p.vest) }),
      skin: new THREE.MeshLambertMaterial({ color: new THREE.Color(p.skin) }),
      boots: new THREE.MeshLambertMaterial({ color: new THREE.Color(p.boots) })
    })),
    weapon: new THREE.MeshLambertMaterial({ color: 0x191a18 }),
    redBand: new THREE.MeshLambertMaterial({ color: 0xb3202a })
  };
  return MATS;
}

// ============================================================
//  СОЗДАНИЕ МОДЕЛИ СОЛДАТА (рост ~1.8 м, ноль меша — у ног)
// ============================================================
function createBotMesh(bot, pal) {
  const g = buildGeos(), M = buildMats();
  const mats = {
    uni: M.palettes[pal].uni.clone(),
    helm: M.palettes[pal].helm.clone(),
    vest: M.palettes[pal].vest.clone(),
    skin: M.palettes[pal].skin.clone(),
    boots: M.palettes[pal].boots.clone(),
    weapon: M.weapon.clone()
  };
  const mesh = new THREE.Group();

  // --- торс (бедра на y=0.78) ---
  const hips = new THREE.Group();
  hips.position.y = 0.78;
  const torso = new THREE.Mesh(g.torso, mats.uni);
  torso.position.y = 0.31;
  hips.add(torso);
  const vestM = new THREE.Mesh(g.vest, mats.vest);
  vestM.position.set(0, 0.36, 0.13);
  hips.add(vestM);
  // разгрузка: подсумки на бронежилете — детализирует силуэт
  if (!pouchGeo) pouchGeo = new THREE.BoxGeometry(0.14, 0.12, 0.06);
  for (let pi = -1; pi <= 1; pi++) {
    const pouch = new THREE.Mesh(pouchGeo, mats.vest);
    pouch.position.set(pi * 0.16, 0.29, 0.185);
    hips.add(pouch);
  }

  // --- голова: череп + каска ---
  const head = new THREE.Group();
  head.position.y = 0.6;
  const skull = new THREE.Mesh(g.head, mats.skin);
  skull.position.y = 0.15;
  head.add(skull);
  const helmM = new THREE.Mesh(g.helm, mats.helm);
  helmM.position.y = 0.31;
  head.add(helmM);
  hips.add(head);

  // --- винтовка: ствол-цилиндр + коробка + магазин + приклад ---
  const weapon = new THREE.Group();
  weapon.position.set(0, 0.4, 0.13);
  const recv = new THREE.Mesh(g.recv, mats.weapon); weapon.add(recv);
  const barrel = new THREE.Mesh(g.barrel, mats.weapon);
  barrel.position.set(0, 0.02, 0.26); weapon.add(barrel);
  const magM = new THREE.Mesh(g.mag, mats.weapon);
  magM.position.set(0, -0.15, -0.05); weapon.add(magM);
  const stockM = new THREE.Mesh(g.stock, mats.weapon);
  stockM.position.set(0, 0, -0.26); weapon.add(stockM);
  const gripM = new THREE.Mesh(g.grip, mats.weapon);
  gripM.position.set(0, -0.06, 0.12); weapon.add(gripM);
  // дуло: Object3D на самом конце ствола (ствол смотрит в +Z; конец barrel = 0.26 + 0.21 = 0.47)
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, 0.47); weapon.add(muzzle);
  hips.add(weapon);
  mesh.add(hips);

  // --- ноги (пивот в бедре) + берцы ---
  const legL = new THREE.Group(); legL.position.set(-0.13, 0.78, 0);
  const legLM = new THREE.Mesh(g.leg, mats.uni); legLM.position.y = -0.39; legL.add(legLM);
  const bootL = new THREE.Mesh(g.boot, mats.boots); bootL.position.set(0, -0.72, 0.02); legL.add(bootL);
  const legR = new THREE.Group(); legR.position.set(0.13, 0.78, 0);
  const legRM = new THREE.Mesh(g.leg, mats.uni); legRM.position.y = -0.39; legR.add(legRM);
  const bootR = new THREE.Mesh(g.boot, mats.boots); bootR.position.set(0, -0.72, 0.02); legR.add(bootR);
  mesh.add(legL, legR);

  // --- руки (пивот в плече, дети hips): плечо + предплечье + кисть с 3 пальцами ---
  // IK-длины: плечо 0.3, предплечье 0.3; конец предплечья (0,-0.3,0) — точка кисти
  const armL = new THREE.Group(); armL.position.set(-0.36, 0.58, 0);
  const armLM = new THREE.Mesh(g.arm, mats.uni); armLM.scale.y = 0.43; armLM.position.y = -0.15; armL.add(armLM);
  const foreL = new THREE.Group(); foreL.position.y = -0.3; armL.add(foreL);
  const foreLM = new THREE.Mesh(g.foreArm, mats.uni); foreLM.position.y = -0.15; foreL.add(foreLM);
  const handL = new THREE.Mesh(g.hand, mats.skin); handL.position.set(0, -0.31, 0.03); foreL.add(handL);
  for (const fx of [-0.035, 0, 0.035]) {
    const f = new THREE.Mesh(g.finger, mats.skin);
    f.position.set(fx, -0.3, 0.07);
    foreL.add(f);
  }
  const armR = new THREE.Group(); armR.position.set(0.36, 0.58, 0);
  const armRM = new THREE.Mesh(g.arm, mats.uni); armRM.scale.y = 0.43; armRM.position.y = -0.15; armR.add(armRM);
  const foreR = new THREE.Group(); foreR.position.y = -0.3; armR.add(foreR);
  const foreRM = new THREE.Mesh(g.foreArm, mats.uni); foreRM.position.y = -0.15; foreR.add(foreRM);
  const handR = new THREE.Mesh(g.hand, mats.skin); handR.position.set(0, -0.31, 0.03); foreR.add(handR);
  for (const fx of [-0.035, 0, 0.035]) {
    const f = new THREE.Mesh(g.finger, mats.skin);
    f.position.set(fx, -0.3, 0.07);
    foreR.add(f);
  }
  hips.add(armL, armR);

  // все враги — с красной повязкой на руке и полосой на каске (читаемо с дистанции)
  if (!bandGeo) bandGeo = new THREE.BoxGeometry(0.06, 0.1, 0.18);
  const band = new THREE.Mesh(bandGeo, MATS.redBand);
  band.position.set(0, 0.03, 0.06);
  armR.add(band);
  const hband = new THREE.Mesh(bandGeo, MATS.redBand);
  hband.scale.set(1.2, 0.5, 0.6);
  hband.position.set(0, 0.3, 0.02);
  head.add(hband);

  // --- служебные точки: голова (для рейкастов); дуло теперь внутри weapon ---
  const headObj = new THREE.Object3D(); headObj.position.set(0, 1.55, 0); mesh.add(headObj);
  // маркер врага над головой (красный треугольник, виден сквозь стены и с дистанции)
  if (!markerTex) markerTex = makeMarkerTex();
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, transparent: true, depthTest: false, depthWrite: false }));
  marker.scale.set(1.1, 1.1, 1);
  marker.position.set(0, 2.0, 0);
  marker.renderOrder = 20;
  marker.raycast = () => {};   // маркер не ловит пули
  mesh.add(marker);

  // тени + userData.bot на меше и всех детях (combat поднимается по parent)
  mesh.traverse(o => {
    o.userData.bot = bot;
    if (o.isMesh) o.castShadow = true;
  });

  bot.mats = [mats.uni, mats.helm, mats.vest, mats.skin, mats.boots, mats.weapon];
  bot.parts = { hips, head, legL, legR, armL, armR, foreL, foreR, weapon };
  bot.muzzleObj = muzzle;
  bot.headObj = headObj;
  bot.mesh = mesh;
  return mesh;
}

// ============================================================
//  ТОЧКИ СПАВНА (кольцо 14–30 м от центра, у укрытий)
// ============================================================
const SPAWN_CANDIDATES = [
  [14, 10], [-16, 8], [0, -18], [20, -6], [-22, -10], [12, -20],
  [-12, -22], [24, 14], [-26, 16], [8, 22], [-8, 20], [18, 18]
];
let spawnPoints = [];

function buildSpawnPoints() {
  spawnPoints = [];
  for (const [x, z] of SPAWN_CANDIDATES) {
    const [fx, fz] = findFree(x, z, 0.7);
    spawnPoints.push(new THREE.Vector3(fx, 0, fz));
  }
}

// точка внутри коллайдера мира?
function pointBlocked(x, z, margin) {
  const worldMod = getWorld();
  const cols = worldMod.getColliders ? worldMod.getColliders() : [];
  for (const c of cols) {
    if (pointBlockedByCollider(x, z, margin, c, { bottomY: 0, topY: 1.8, stepHeight: 0.45 })) return true;
  }
  return false;
}

// поиск свободной точки по спирали (если кандидат в стене)
function findFree(x, z, margin) {
  if (!pointBlocked(x, z, margin)) return [x, z];
  for (let ring = 1; ring <= 6; ring++) {
    const step = ring * 0.9;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + ring * 0.7;
      const nx = x + Math.cos(a) * step, nz = z + Math.sin(a) * step;
      if (!pointBlocked(nx, nz, margin)) return [nx, nz];
    }
  }
  return [x, z];
}

// круг против AABB — как у игрока в main.js
function resolveCircle(x, z, r) {
  const worldMod = getWorld();
  const cols = worldMod.getColliders ? worldMod.getColliders() : [];
  if (Array.isArray(cols)) return resolveCapsuleMotion(x, z, r, cols, { bottomY: 0, topY: 1.8, stepHeight: 0.45 });
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

// 2–3 точки патруля рядом со спавном
function genPatrolPath(b) {
  const path = [];
  const sp = b.spawn;
  const n = 2 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n; i++) {
    let x = 0, z = 0, ok = false;
    for (let k = 0; k < 6 && !ok; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 4.5;
      x = Math.max(-27, Math.min(27, sp.x + Math.cos(a) * r));
      z = Math.max(-27, Math.min(27, sp.z + Math.sin(a) * r));
      ok = !pointBlocked(x, z, 0.6);
    }
    path.push(new THREE.Vector3(x, 0, z));
  }
  return path;
}

// ============================================================
//  ФАБРИКА БОТОВ
// ============================================================
let bots = [];
let botsGroup = null;
let navigationGraph = null;
let navigationPlanner = null;
let navigationMesh = null;

function createBot(spawnPos, archetype = 'soldier') {
  const definition = getEnemyDefinition(archetype);
  const bot = {
    mesh: null, health: definition.health, maxHealth: definition.health, alive: true, state: 'patrol',
    archetype: definition.id, definition, role: definition.role,
    speed: definition.speed + Math.random() * 0.25,
    fireT: 0.6 + Math.random() * 0.8, burstT: 0, burstLeft: 0,
    strafeDir: Math.random() < 0.5 ? -1 : 1, strafeT: 1.5 + Math.random() * 1.5,
    patrolWp: 0, patrolPath: [], pauseT: 0,
    respawnT: 0, hitFlash: 0, flashOn: false, walkPhase: Math.random() * Math.PI * 2,
    deadT: 0, fadeT: 0, deathRoll: (Math.random() - 0.5) * 0.6,
    spawn: spawnPos.clone(), yaw: Math.random() * Math.PI * 2,
    visT: Math.random() * 0.15, canSee: false,
    moving: false, stuck: false,
    watcherActive: definition.role !== 'watcher',
    palette: definition.palette % PALETTES.length,
    mats: [], parts: {}, muzzleObj: null, headObj: null,
    aim: 0, recoil: 0,
    attackT: 0, chargeT: 0,
    navigationAgent: null,
  };
  const mesh = createBotMesh(bot, bot.palette);
  mesh.userData.archetype = definition.id;
  if (definition.role === 'melee' || definition.role === 'watcher') bot.parts.weapon.visible = false;
  if (definition.role === 'watcher') mesh.visible = false;
  mesh.position.copy(spawnPos);
  bot.patrolPath = genPatrolPath(bot);
  botsGroup.add(mesh);
  return bot;
}

function spawnEnemyGroup(g, enemyGroup, maxCount = enemyGroup.count) {
  const spawned = [];
  const count = Math.max(0, Math.min(enemyGroup.count | 0, maxCount | 0));
  for (let index = 0; index < count; index += 1) {
    const [x, z] = findFree(
      enemyGroup.position.x + (index % 2) * 1.1,
      enemyGroup.position.z + Math.floor(index / 2) * 1.1,
      0.7,
    );
    const spawn = { position: new THREE.Vector3(x, 0, z), nodeId: enemyGroup.nodeId };
    const bot = createBot(spawn.position, enemyGroup.archetype);
    bot.id = `runtime-${enemyGroup.id}-${index}-${bots.length}`;
    bot.expeditionGroupId = enemyGroup.id;
    bot.expeditionNodeId = enemyGroup.nodeId;
    bot.expeditionGroupIndex = index;
    bots.push(bot);
    spawned.push(bot);
    if (bot.role === 'watcher') {
      g.expedition?.watcher?.registerCandidate({
        id: bot.id,
        nodeId: enemyGroup.nodeId,
        position: { x: bot.mesh.position.x, z: bot.mesh.position.z },
        bot,
      });
    } else {
      g.expedition?.threatDirector?.registerEnemy(bot);
    }
  }
  return spawned;
}

// ============================================================
//  ПУЛЫ: кровь (Points), дульные вспышки (спрайты), трассеры (линии)
//  Без new в update — всё создаётся заранее.
// ============================================================
const BLOOD_N = 36;
const bloodPos = new Float32Array(BLOOD_N * 3);
const bloodVel = new Float32Array(BLOOD_N * 3);
const bloodCol = new Float32Array(BLOOD_N * 3);
const bloodLife = new Float32Array(BLOOD_N);
const bloodMax = new Float32Array(BLOOD_N);
let bloodIdx = 0;
let bloodPoints = null, bloodGeom = null;

const flashPool = [];
let flashIdx = 0;
const tracerPool = [];
let tracerIdx = 0;

function makeBloodTex() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  gr.addColorStop(0, 'rgba(160,20,20,1)');
  gr.addColorStop(0.55, 'rgba(120,12,12,0.85)');
  gr.addColorStop(1, 'rgba(90,8,8,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeFlashTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,240,190,1)');
  gr.addColorStop(0.4, 'rgba(255,170,60,0.85)');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function initPools(scene) {
  // кровь — единый Points-пул
  if (!bloodPoints) {
    for (let i = 0; i < BLOOD_N; i++) bloodPos[i * 3 + 1] = -999;
    bloodGeom = new THREE.BufferGeometry();
    bloodGeom.setAttribute('position', new THREE.BufferAttribute(bloodPos, 3).setUsage(THREE.DynamicDrawUsage));
    bloodGeom.setAttribute('color', new THREE.BufferAttribute(bloodCol, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size: 0.09, map: makeBloodTex(), vertexColors: true,
      transparent: true, depthWrite: false, sizeAttenuation: true
    });
    bloodPoints = new THREE.Points(bloodGeom, mat);
    bloodPoints.frustumCulled = false;
    scene.add(bloodPoints);
  }
  // дульные вспышки — 4 спрайта
  if (!flashPool.length) {
    for (let i = 0; i < 4; i++) {
      const sm = new THREE.SpriteMaterial({
        map: makeFlashTex(), color: 0xffd9a0,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0
      });
      const s = new THREE.Sprite(sm);
      s.visible = false;
      scene.add(s);
      flashPool.push({ s, life: 0 });
    }
  }
  // трассеры — 8 линий
  if (!tracerPool.length) {
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
      const lm = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, lm);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      tracerPool.push({ line, life: 0 });
    }
  }
}

function spawnBlood(point, dir) {
  for (let i = 0; i < 6; i++) {
    const idx = bloodIdx; bloodIdx = (bloodIdx + 1) % BLOOD_N;
    const i3 = idx * 3;
    bloodPos[i3] = point.x + (Math.random() - 0.5) * 0.12;
    bloodPos[i3 + 1] = point.y + (Math.random() - 0.5) * 0.12;
    bloodPos[i3 + 2] = point.z + (Math.random() - 0.5) * 0.12;
    let dx = 0, dy = 0, dz = 0;
    if (dir) { dx = dir.x; dy = dir.y * 0.6; dz = dir.z; }
    const spd = 1.2 + Math.random() * 1.6;
    bloodVel[i3] = dx * spd + (Math.random() - 0.5) * 1.4;
    bloodVel[i3 + 1] = dy * spd + 0.8 + Math.random() * 1.2;
    bloodVel[i3 + 2] = dz * spd + (Math.random() - 0.5) * 1.4;
    bloodLife[idx] = bloodMax[idx] = 0.25 + Math.random() * 0.15;
  }
}

function spawnTracer(from, dir, len) {
  const t = tracerPool[tracerIdx]; tracerIdx = (tracerIdx + 1) % tracerPool.length;
  const pos = t.line.geometry.attributes.position.array;
  pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
  pos[3] = from.x + dir.x * len; pos[4] = from.y + dir.y * len; pos[5] = from.z + dir.z * len;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.visible = true;
  t.line.material.opacity = 1;
  t.life = 0.07;
}

function spawnMuzzle(pos) {
  const f = flashPool[flashIdx]; flashIdx = (flashIdx + 1) % flashPool.length;
  f.s.position.copy(pos);
  f.s.scale.setScalar(0.12 + Math.random() * 0.09);
  f.s.material.rotation = Math.random() * Math.PI;
  f.s.material.opacity = 1;
  f.s.visible = true;
  f.life = 0.045 + Math.random() * 0.02;
}

function updatePools(dt) {
  // кровь
  let any = false;
  for (let i = 0; i < BLOOD_N; i++) {
    if (bloodLife[i] <= 0) continue;
    any = true;
    bloodLife[i] -= dt;
    const i3 = i * 3;
    if (bloodLife[i] <= 0) { bloodPos[i3 + 1] = -999; continue; }
    bloodVel[i3 + 1] -= 13 * dt; // гравитация
    bloodPos[i3] += bloodVel[i3] * dt;
    bloodPos[i3 + 1] += bloodVel[i3 + 1] * dt;
    bloodPos[i3 + 2] += bloodVel[i3 + 2] * dt;
    const t = 1 - bloodLife[i] / bloodMax[i]; // темнеет к концу жизни
    bloodCol[i3] = (0xc0 + (0x4a - 0xc0) * t) / 255;
    bloodCol[i3 + 1] = (0x28 + (0x0a - 0x28) * t) / 255;
    bloodCol[i3 + 2] = (0x28 + (0x0a - 0x28) * t) / 255;
  }
  if (any) {
    bloodGeom.attributes.position.needsUpdate = true;
    bloodGeom.attributes.color.needsUpdate = true;
  }
  // вспышки
  for (const f of flashPool) {
    if (f.life <= 0) { if (f.s.visible) f.s.visible = false; continue; }
    f.life -= dt;
    if (f.life <= 0) { f.s.visible = false; continue; }
    f.s.material.opacity = Math.min(1, f.life / 0.05);
    f.s.material.rotation += dt * 12;
  }
  // трассеры
  for (const t of tracerPool) {
    if (t.life <= 0) { if (t.line.visible) t.line.visible = false; continue; }
    t.life -= dt;
    if (t.life <= 0) { t.line.visible = false; continue; }
    t.line.material.opacity = t.life / 0.07;
  }
}

// ============================================================
//  API
// ============================================================
export function init(g) {
  gRef = g;
  buildGeos();
  buildMats();
  if (!botsGroup) {
    botsGroup = new THREE.Group();
    botsGroup.name = 'bots';
    g.scene.add(botsGroup);
  }
  initPools(g.scene);
  initPickups(g.scene);
  buildSpawnPoints();
  // в обычной игре ботов создаём сразу (в demo это делает main)
  if (!g.demo) spawnBots(g, 6);
}

export function spawnBots(g, n = 8) {
  if (!spawnPoints.length) buildSpawnPoints();
  for (const pickup of pickups) pickup.mesh?.parent?.remove(pickup.mesh);
  pickups.length = 0;
  // очистить старых (повторный вызов идемпотентен)
  for (const b of bots) {
    if (b.mesh && b.mesh.parent) b.mesh.parent.remove(b.mesh);
  }
  bots = [];
  navigationGraph = null;
  navigationPlanner = null;
  navigationMesh = null;
  const expeditionGroups = g.expedition?.run?.map?.enemyGroups;
  if (expeditionGroups?.length) {
    const groups = g.expedition.encounterDirector?.claimInitialGroups?.(n, {
      playerPosition: { x: g.player.pos.x, z: g.player.pos.z },
    }) ?? expeditionGroups;
    let remaining = Math.max(1, n | 0);
    const spawned = [];
    for (const enemyGroup of groups) {
      if (remaining <= 0) break;
      const groupBots = spawnEnemyGroup(g, enemyGroup, Math.min(enemyGroup.count, remaining));
      if (groupBots.length) {
        g.expedition.encounterDirector?.markSpawned?.(
          enemyGroup.id,
          groupBots.map((bot) => bot.id),
        );
        spawned.push(...groupBots);
        remaining -= groupBots.length;
      } else {
        g.expedition.encounterDirector?.markFailed?.(enemyGroup.id, 'initial-spawn-failed');
      }
    }
    return spawned;
  }
  const generatedSpawns = g.expedition?.run?.map?.enemyGroups
    ?.flatMap((enemyGroup) => {
      const positions = [];
      for (let index = 0; index < enemyGroup.count; index += 1) {
        positions.push({
          position: new THREE.Vector3(
            enemyGroup.position.x + (index % 2) * 1.1,
            0,
            enemyGroup.position.z + Math.floor(index / 2) * 1.1,
          ),
          groupId: enemyGroup.id,
          nodeId: enemyGroup.nodeId,
          archetype: enemyGroup.archetype,
        });
      }
      return positions;
    })
    ?.filter((candidate) => candidate.position.distanceTo(g.player.pos) > 10) ?? [];
  if (generatedSpawns.length) {
    for (const spawn of generatedSpawns.slice(0, Math.min(n, 12))) {
      const bot = createBot(spawn.position, spawn.archetype);
      bot.id = `runtime-${spawn.groupId}-${bots.length}`;
      bot.expeditionGroupId = spawn.groupId;
      bot.archetype = spawn.archetype;
      bots.push(bot);
      if (bot.role === 'watcher') {
        g.expedition?.watcher?.registerCandidate({
          id: bot.id,
          nodeId: spawn.nodeId,
          position: { x: bot.mesh.position.x, z: bot.mesh.position.z },
          bot,
        });
      } else {
        g.expedition?.threatDirector?.registerEnemy(bot);
      }
    }
    return;
  }
  const count = Math.max(1, n | 0);
  const used = [];
  for (let i = 0; i < count; i++) {
    let sp = spawnPoints[(Math.random() * spawnPoints.length) | 0];
    for (let k = 0; k < 24; k++) {
      const cand = spawnPoints[(Math.random() * spawnPoints.length) | 0];
      if (!used.some(u => u.distanceTo(cand) < 2.5)) { sp = cand; break; }
    }
    used.push(sp.clone());
    const bot = createBot(sp, 'soldier');
    bot.id = `runtime-arena-${bots.length}`;
    bots.push(bot);
  }
}

export function spawnEncounter(g, encounter) {
  const enemyGroup = encounter?.group ?? g.expedition?.run?.map?.enemyGroups?.find((group) => group.id === encounter?.groupId);
  if (!enemyGroup) return { ok: false, reason: 'unknown-group' };
  if (g.expedition?.encounterDirector?.recordById?.(enemyGroup.id)?.state === 'spawned') {
    return { ok: false, reason: 'already-spawned', groupId: enemyGroup.id };
  }
  const groupBots = spawnEnemyGroup(g, enemyGroup);
  if (!groupBots.length) return { ok: false, reason: 'spawn-failed', groupId: enemyGroup.id };
  g.expedition?.encounterDirector?.markSpawned?.(
    enemyGroup.id,
    groupBots.map((bot) => bot.id),
  );
  g.events?.emit('encounter:spawned', {
    encounter,
    groupId: enemyGroup.id,
    botIds: groupBots.map((bot) => bot.id),
    count: groupBots.length,
  });
  return { ok: true, groupId: enemyGroup.id, botIds: groupBots.map((bot) => bot.id) };
}

export function getGroup() { return botsGroup; }
export function getBots() { return bots; }

export function activateWatcher(g, candidateId) {
  const bot = bots.find((candidate) => candidate.id === candidateId && candidate.role === 'watcher');
  if (!bot) return false;
  bot.watcherActive = true;
  bot.mesh.visible = true;
  bot.state = 'patrol';
  g.expedition?.threatDirector?.registerEnemy(bot);
  return true;
}

function getNavigationPlanner(g) {
  const graph = g.expedition?.run?.map?.graph ?? null;
  if (graph !== navigationGraph) {
    navigationGraph = graph;
    navigationPlanner = graph ? new ConnectorAwarePlanner(graph) : null;
    navigationMesh = g.expedition?.run?.map?.navigationMesh ?? null;
  }
  return navigationPlanner;
}

// ============================================================
//  ВРЕМЕННЫЕ ОБЪЕКТЫ (один набор на модуль, без new в update)
// ============================================================
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _axis = new THREE.Vector3();   // ось сгиба локтя (векторный temp)
const _down = new THREE.Vector3(0, -1, 0), _up = new THREE.Vector3(0, 1, 0);
const _ray = new THREE.Raycaster();
_ray.far = 60;

// ============================================================
//  ПОВЕДЕНИЕ
// ============================================================
function turnToward(b, target, speed, dt) {
  let d = target - b.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const max = speed * dt;
  b.yaw += Math.max(-max, Math.min(max, d));
  b.mesh.rotation.y = b.yaw;
}

// перемещение с коллизией; ok=false — упёрся в стену
function moveBot(b, vx, vz, dt) {
  const p = b.mesh.position;
  const expect = Math.hypot(vx * dt, vz * dt);
  const [rx, rz] = resolveCircle(p.x + vx * dt, p.z + vz * dt, 0.35);
  const moved = Math.hypot(rx - p.x, rz - p.z);
  p.x = rx; p.z = rz;
  b.stuck = expect > 0.01 && moved < expect * 0.25;
  return !b.stuck;
}

// прямая видимость: рейкаст от головы к глазам игрока через статику мира
function hasLOS(b, ppos) {
  const worldMod = getWorld();
  const shootables = worldMod.getShootables ? worldMod.getShootables() : null;
  b.headObj.getWorldPosition(_v1);
  _v2.subVectors(ppos, _v1);
  const dist = _v2.length();
  if (dist > 45) return false;
  if (!shootables) return true;
  _v2.normalize();
  _ray.set(_v1, _v2);
  const hits = _ray.intersectObjects([shootables], true);
  return !(hits.length && hits[0].distance < dist - 0.3);
}

function updatePatrol(b, dt) {
  if (b.pauseT > 0) { b.pauseT -= dt; b.moving = false; return; }
  if (gRef?.expedition && updateNavigationPatrol(b, dt)) return;
  const path = b.patrolPath;
  if (!path.length) { b.moving = false; return; }
  const wp = path[b.patrolWp % path.length];
  _v1.subVectors(wp, b.mesh.position); _v1.y = 0;
  const d = _v1.length();
  if (d < 0.55) {
    b.patrolWp = (b.patrolWp + 1) % path.length;
    b.pauseT = 0.4 + Math.random() * 1.6;
    b.moving = false;
    return;
  }
  _v1.normalize();
  const spd = b.speed;
  turnToward(b, Math.atan2(_v1.x, _v1.z), 5, dt);
  const ok = moveBot(b, _v1.x * spd, _v1.z * spd, dt);
  b.moving = true;
  if (!ok) { // упёрся — берём следующую точку
    b.patrolWp = (b.patrolWp + 1) % path.length;
    b.pauseT = 0.25;
    b.moving = false;
  }
}

function updateNavigationPatrol(b, dt) {
  const manager = gRef?.expedition;
  const planner = getNavigationPlanner(gRef);
  if (!manager?.run || !planner) return false;
  const playerNodeId = manager.nodeForPosition({ x: gRef.player.pos.x, z: gRef.player.pos.z });
  const currentNodeId = manager.nodeForPosition({ x: b.mesh.position.x, z: b.mesh.position.z }) ?? b.expeditionNodeId;
  if (!playerNodeId || !currentNodeId) {
    b.navigationAgent = null;
    return false;
  }
  if (!b.navigationAgent) b.navigationAgent = new NavigationAgent(planner, navigationMesh);

  if (playerNodeId === currentNodeId) {
    const waypoint = b.navigationAgent.localWaypoint(
      currentNodeId,
      { x: b.mesh.position.x, z: b.mesh.position.z },
      { x: gRef.player.pos.x, z: gRef.player.pos.z },
      0.85,
    );
    if (!waypoint) {
      b.moving = false;
      return true;
    }
    _v1.set(waypoint.x - b.mesh.position.x, 0, waypoint.z - b.mesh.position.z);
    const distance = _v1.length();
    if (distance <= 0.05) {
      b.moving = false;
      return true;
    }
    _v1.multiplyScalar(1 / distance);
    turnToward(b, Math.atan2(_v1.x, _v1.z), 5, dt);
    const ok = moveBot(b, _v1.x * b.speed, _v1.z * b.speed, dt);
    b.moving = ok;
    if (!ok) b.navigationAgent = null;
    return true;
  }

  b.navigationAgent.setTarget(currentNodeId, playerNodeId);
  const waypoint = b.navigationAgent.waypoint(
    currentNodeId,
    { x: b.mesh.position.x, z: b.mesh.position.z },
    0.85,
  );
  if (!waypoint) {
    b.navigationAgent = null;
    return false;
  }
  _v1.set(waypoint.x - b.mesh.position.x, 0, waypoint.z - b.mesh.position.z);
  const distance = _v1.length();
  if (distance <= 0.05) {
    b.moving = false;
    return true;
  }
  _v1.multiplyScalar(1 / distance);
  turnToward(b, Math.atan2(_v1.x, _v1.z), 5, dt);
  const ok = moveBot(b, _v1.x * b.speed, _v1.z * b.speed, dt);
  b.moving = ok;
  if (!ok) b.navigationAgent = null;
  return true;
}

function updateStalkerAttack(b, dt, ppos, dist) {
  _v1.subVectors(ppos, b.mesh.position);
  _v1.y = 0;
  if (dist > 0.01) _v1.normalize();
  turnToward(b, Math.atan2(_v1.x, _v1.z), 10, dt);
  b.attackT = Math.max(0, b.attackT - dt);
  if (dist > b.definition.attackRange) {
    b.moving = moveBot(b, _v1.x * b.speed, _v1.z * b.speed, dt);
    return;
  }
  b.moving = false;
  if (b.attackT <= 0 && hasLOS(b, ppos)) {
    b.attackT = 1.15;
    gRef?.damagePlayer?.(b.definition.damage, { type: 'stalker', enemy: b });
    sfx('hurt', 0.18);
  }
}

function updateWatcherAttack(b, dt, ppos, dist) {
  _v1.subVectors(ppos, b.mesh.position);
  _v1.y = 0;
  if (dist > 0.01) _v1.normalize();
  turnToward(b, Math.atan2(_v1.x, _v1.z), 12, dt);
  b.attackT = Math.max(0, b.attackT - dt);
  if (dist > b.definition.attackRange) {
    b.moving = moveBot(b, _v1.x * b.speed, _v1.z * b.speed, dt);
    return;
  }
  b.moving = false;
  if (b.attackT <= 0 && hasLOS(b, ppos)) {
    b.attackT = 1.6;
    gRef?.damagePlayer?.(b.definition.damage, { type: 'watcher', enemy: b });
    sfx('hurt', 0.26);
  }
}

function fireAnomalyShot(b, ppos, dist) {
  b.muzzleObj.getWorldPosition(_v1);
  _v2.copy(ppos).sub(_v1);
  if (!_v2.lengthSq()) return;
  _v2.normalize();
  const worldMod = getWorld();
  let wallDistance = Infinity;
  if (worldMod.getShootables) {
    _ray.set(_v1, _v2);
    const wallHits = _ray.intersectObjects([worldMod.getShootables()], true);
    if (wallHits.length) wallDistance = wallHits[0].distance;
  }
  const playerHitDistance = rayCapsuleDistance(
    _v1,
    _v2,
    { x: ppos.x, z: ppos.z, bottomY: ppos.y - 1.4, topY: ppos.y + 0.08, radius: 0.38 },
    Math.min(dist + 2, b.definition.attackRange),
  );
  const blocked = isBlockedByWall(wallDistance, playerHitDistance);
  spawnTracer(_v1, _v2, Math.min(b.definition.attackRange, wallDistance));
  spawnMuzzle(_v1);
  sfx('shotHit', 0.12);
  if (Number.isFinite(playerHitDistance) && !blocked)
    gRef?.damagePlayer?.(b.definition.damage, { type: 'anomaly', enemy: b });
}

function updateAnomalyAttack(b, dt, ppos, dist) {
  _v1.subVectors(ppos, b.mesh.position);
  _v1.y = 0;
  if (dist > 0.01) _v1.normalize();
  turnToward(b, Math.atan2(_v1.x, _v1.z), 4, dt);
  b.attackT = Math.max(0, b.attackT - dt);
  if (b.chargeT > 0) {
    b.chargeT -= dt;
    b.moving = false;
    if (b.chargeT <= 0) fireAnomalyShot(b, ppos, dist);
    return;
  }
  if (dist < 16) {
    b.moving = moveBot(b, -_v1.x * b.speed, -_v1.z * b.speed, dt);
  } else if (dist > 26) {
    b.moving = moveBot(b, _v1.x * b.speed, _v1.z * b.speed, dt);
  } else {
    b.moving = false;
  }
  if (b.attackT <= 0 && dist <= b.definition.attackRange && hasLOS(b, ppos)) {
    b.attackT = 3.2;
    b.chargeT = b.definition.chargeSeconds;
  }
}

function updateAttack(b, dt, ppos, dist) {
  if (b.role === 'watcher') return updateWatcherAttack(b, dt, ppos, dist);
  if (b.role === 'melee') return updateStalkerAttack(b, dt, ppos, dist);
  if (b.role === 'telegraph-ranged') return updateAnomalyAttack(b, dt, ppos, dist);
  _v1.subVectors(ppos, b.mesh.position); _v1.y = 0;
  _v1.normalize();
  turnToward(b, Math.atan2(_v1.x, _v1.z), 7, dt);

  // стрейф: смена направления каждые 1.5–3 с
  b.strafeT -= dt;
  if (b.strafeT <= 0) { b.strafeDir *= -1; b.strafeT = 1.5 + Math.random() * 1.5; }

  // движение: стрейф + медленное сближение/отступление (во время очереди стоим)
  const moving = b.burstLeft <= 0;
  if (moving) {
    const perpX = -_v1.z, perpZ = _v1.x;
    let ax = 0, az = 0;
    if (dist > 26) { ax += _v1.x * 0.9; az += _v1.z * 0.9; }
    else if (dist < 9) { ax -= _v1.x * 0.8; az -= _v1.z * 0.8; }
    else { ax += _v1.x * 0.12; az += _v1.z * 0.12; }
    ax += perpX * b.strafeDir * 0.8;
    az += perpZ * b.strafeDir * 0.8;
    const len = Math.hypot(ax, az) || 1;
    const spd = b.speed * 0.8;
    if (!moveBot(b, (ax / len) * spd, (az / len) * spd, dt)) b.strafeDir *= -1;
    b.moving = true;
  } else {
    b.moving = false;
  }

  // стрельба очередями: burstLeft выстрелов с интервалом 0.09 с
  if (b.burstLeft > 0) {
    b.burstT -= dt;
    if (b.burstT <= 0) {
      fireShot(b, ppos, dist);
      b.burstLeft--;
      b.burstT = 0.09;
    }
    if (b.burstLeft <= 0) b.fireT = 0.5 + Math.random() * 0.9;
  } else {
    b.fireT -= dt;
    if (b.fireT <= 0) {
      b.burstLeft = 3 + ((Math.random() * 2) | 0); // 3–4 выстрела
      b.burstT = 0;
    }
  }
}

// выстрел бота: вспышка + трассер + рейкаст попадания в игрока
function fireShot(b, ppos, dist) {
  b.muzzleObj.getWorldPosition(_v1); // дуло — конец ствола винтовки в руках
  b.recoil = 1; // отдача: рывок винтовки назад/вверх, затухает в updateAnim
  // точка прицеливания: глаза игрока + разброс (~0.7 м на дистанции)
  const spreadR = 0.18 + dist * 0.013;
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * spreadR;
  _v2.set(
    ppos.x + Math.cos(a) * r,
    ppos.y + (Math.random() - 0.5) * spreadR * 0.8,
    ppos.z + Math.sin(a) * r
  );
  _v3.subVectors(_v2, _v1).normalize();

  const worldMod = getWorld();
  let wallDistance = Infinity;
  if (worldMod.getShootables) {
    _ray.set(_v1, _v3);
    const wallHits = _ray.intersectObjects([worldMod.getShootables()], true);
    if (wallHits.length) wallDistance = wallHits[0].distance;
  }
  const targetDistance = Math.min(dist + 2, 40);
  const playerHitDistance = rayCapsuleDistance(
    _v1,
    _v3,
    { x: ppos.x, z: ppos.z, bottomY: ppos.y - 1.4, topY: ppos.y + 0.08, radius: 0.38 },
    targetDistance
  );
  spawnTracer(_v1, _v3, Math.min(targetDistance, wallDistance));
  spawnMuzzle(_v1);
  sfx('shoot', 0.1); // дальний выстрел — тише

  // Попадание требует пересечения с капсулой игрока и отсутствия ближайшей стены.
  const movementPenalty = Math.min(0.22, (gRef?.player.moveSpeed || 0) * 0.025);
  const distancePenalty = Math.min(0.24, dist * 0.006);
  const burstPenalty = Math.min(0.18, Math.max(0, 4 - b.burstLeft) * 0.035);
  const chance = Math.max(0.08, 0.42 - movementPenalty - distancePenalty - burstPenalty);
  const hitPlayer = Number.isFinite(playerHitDistance)
    && !isBlockedByWall(wallDistance, playerHitDistance)
    && Math.random() < chance;
  if (hitPlayer) {
    const dmg = Math.max(5, Math.min(12, Math.round(12.5 - dist * 0.11))); // меньше в дальнем
    gRef?.damagePlayer?.(dmg, { type: 'enemy', enemy: b });
    sfx('shotHit', 0.3);
  }
}

// ============================================================
//  СМЕРТЬ / ВОСКРЕШЕНИЕ
// ============================================================
export function applyDamage(g, bot, dmg, dir, point, meta = {}) {
  if (!bot || !bot.alive) return { killed: false };
  bot.hitFlash = 1;
  const result = applyEnemyDamage(g.state, bot, dmg, (event) => {
    g.events?.emit('enemy:damaged', { bot, ...event, ...meta });
  });
  if (meta.debug) g.events?.emit('enemy:hit', { bot, archetype: bot.archetype, ...result, ...meta });

  // кровь в точке попадания
  const p = point || bot.mesh.position;
  _v1.set(p.x, Math.max(0.3, p.y), p.z);
  spawnBlood(_v1, dir);

  // лёгкий отброс по направлению удара
  if (dir && dir.lengthSq && dir.lengthSq() > 1e-6) {
    _v2.copy(dir); _v2.y = 0; _v2.normalize();
    _v2.multiplyScalar(0.22);
    const [rx, rz] = resolveCircle(bot.mesh.position.x + _v2.x, bot.mesh.position.z + _v2.z, 0.35);
    bot.mesh.position.x = rx; bot.mesh.position.z = rz;
  }

  if (result.killed) {
    g.expedition?.threatDirector?.removeEnemy(bot.id);
    bot.state = 'dead';
    bot.deadT = 0; bot.fadeT = 0;
    bot.respawnT = gRef?.expedition ? Infinity : 7.0;
    bot.moving = false;
    bot.burstLeft = 0;
    dropPickup(g, bot.mesh.position);   // враг роняет подсумки с патронами
    return { ...result, ...meta, killed: true };
  }
  return { ...result, ...meta, killed: false };
}

function setOpacity(b, op) {
  for (const m of b.mats) m.opacity = op;
}

function respawnBot(b) {
  b.mesh.position.copy(b.spawn);
  b.mesh.rotation.set(0, b.yaw, 0);
  b.mesh.visible = true;
  setOpacity(b, 1);
  b.health = b.maxHealth ?? b.definition?.health ?? 100; b.alive = true; b.state = 'patrol';
  b.hitFlash = 0; b.flashOn = false;
  b.deadT = 0; b.fadeT = 0; b.respawnT = 0;
  b.pauseT = 0.4 + Math.random() * 0.8;
  b.patrolPath = genPatrolPath(b);
  b.patrolWp = 0;
  b.yaw = Math.random() * Math.PI * 2;
  b.mesh.rotation.y = b.yaw;
  b.walkPhase = Math.random() * Math.PI * 2;
}

export function respawnAll(g) {
  for (const b of bots) respawnBot(b);
}

function updateDead(b, dt) {
  b.deadT += dt;
  b.respawnT -= dt;
  // заваливание назад за 0.4 с
  if (b.deadT < 0.4) {
    const k = b.deadT / 0.4;
    const s = k * k * (3 - 2 * k);
    b.mesh.rotation.x = -1.5 * s; // ~ -85°
    b.mesh.rotation.z = b.deathRoll * s;
  }
  // через 4 с тело растворяется за 0.8 с
  if (b.deadT >= 4.0) {
    b.fadeT += dt;
    setOpacity(b, Math.max(0, 1 - b.fadeT / 0.8));
    if (b.fadeT >= 0.8) b.mesh.visible = false;
  }
  if (b.respawnT <= 0) respawnBot(b);
}

// ============================================================
//  АНИМАЦИЯ (плавные lerp)
// ============================================================
// Двухкостная IK руки: плечо S -> локоть -> кисть T (координаты hips).
// qS — поворот плеча, qE — поворот предплечья (в координатах плеча).
// roll — доворот кисти вокруг оси руки (ладони внутрь, к оружию).
function solveArm(S, T, qS, qE, roll) {
  const L1 = 0.3, L2 = 0.3;
  _v3.subVectors(T, S);
  const d = Math.min(_v3.length(), L1 + L2 - 1e-3);
  _v3.normalize();
  // ось сгиба: горизонталь, перпендикулярная направлению на цель -> локоть уходит вниз-наружу
  _axis.crossVectors(_up, _v3);
  if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0); else _axis.normalize();
  const a1 = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  _q2.setFromAxisAngle(_axis, a1);
  _v1.copy(_v3).applyQuaternion(_q2).normalize();   // направление плечо -> локоть
  _v2.copy(S).addScaledVector(_v1, L1);             // позиция локтя
  qS.setFromUnitVectors(_down, _v1);
  _v3.subVectors(T, _v2).normalize();               // направление локоть -> кисть
  _q3.copy(qS).invert();
  _v3.applyQuaternion(_q3);                          // перевели в координаты плеча
  qE.setFromUnitVectors(_down, _v3);
  if (roll) {
    _q1.setFromAxisAngle(_down, roll);              // ось руки = локальная -Y
    qE.multiply(_q1);
  }
}

function updateAnim(b, dt) {
  const P = b.parts;
  const moving = b.moving && b.state !== 'dead';
  if (moving) b.walkPhase += dt * 8.5;
  const swing = moving ? Math.sin(b.walkPhase) : 0;

  // ноги — покачивание
  const legT = swing * 0.55;
  P.legL.rotation.x += (legT - P.legL.rotation.x) * Math.min(1, 14 * dt);
  P.legR.rotation.x += (-legT - P.legR.rotation.x) * Math.min(1, 14 * dt);

  // лёгкий наклон торса при ходьбе + покачивание
  const leanT = moving ? 0.07 : 0;
  P.hips.rotation.x += (leanT - P.hips.rotation.x) * Math.min(1, 8 * dt);
  P.hips.rotation.z = Math.sin(b.walkPhase * 2) * 0.025 * (moving ? 1 : 0);
  P.hips.position.y = 0.78 + Math.sin(gRef.state.time * 2.1 + b.walkPhase) * 0.008; // дыхание

  // --- прицеливание: плавный aim 0..1 (растёт в атаке, падает в патруле) ---
  b.aim += ((b.state === 'attack' ? 1 : 0) - b.aim) * Math.min(1, 6 * dt);

  // --- винтовка: низкий ready (патруль) / приклад к плечу (атака) + питч на игрока + отдача ---
  const W = P.weapon;
  const baseY = 0.40 + 0.15 * b.aim;   // 1.18 м у груди -> 1.33 м у плеча
  const baseZ = 0.13 + 0.04 * b.aim;   // чуть вперёд при прицеливании
  _v1.subVectors(gRef.player.pos, b.mesh.position);
  const horiz = Math.hypot(_v1.x, _v1.z);
  // вертикальный наклон ствола на игрока (малый угол: цели почти на уровне глаз)
  const pitchT = Math.max(-0.3, Math.min(0.3,
    Math.atan2(gRef.player.pos.y - (0.78 + baseY), Math.max(0.5, horiz))));
  const baseRotX = -0.15 * (1 - b.aim) + pitchT * b.aim; // ready: ствол чуть вниз; aim: на игрока
  const rec = b.recoil;
  b.recoil = Math.max(0, rec - dt * 8); // затухание отдачи ~0.12 с
  const k = Math.min(1, 12 * dt);
  W.position.y += (baseY - W.position.y) * k;
  W.position.z += ((baseZ - rec * 0.03) - W.position.z) * k;    // отдача: рывок назад (-Z hips)
  W.rotation.x += ((baseRotX - rec * 0.05) - W.rotation.x) * k; // отдача: ствол вскидывается вверх

  // --- руки: кисти всегда на винтовке (левая — цевьё, правая — рукоять) ---
  W.updateWorldMatrix(true, false);
  _v1.set(0, 0.02, 0.10).applyMatrix4(W.matrixWorld); P.hips.worldToLocal(_v1); // цевьё
  solveArm(P.armL.position, _v1, _q1, _q2, -0.45);
  P.armL.quaternion.slerp(_q1, k);
  P.foreL.quaternion.slerp(_q2, k);
  _v2.set(0, -0.09, 0.12).applyMatrix4(W.matrixWorld); P.hips.worldToLocal(_v2); // рукоять
  solveArm(P.armR.position, _v2, _q1, _q2, 0.45);
  P.armR.quaternion.slerp(_q1, k);
  P.foreR.quaternion.slerp(_q2, k);

  // голова: в атаке следит за игроком, в патруле осматривается
  if (b.state === 'attack') {
    _v1.subVectors(gRef.player.pos, b.mesh.position); _v1.y = 0;
    let d = Math.atan2(_v1.x, _v1.z) - b.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const ht = Math.max(-0.5, Math.min(0.5, d * 0.8));
    P.head.rotation.y += (ht - P.head.rotation.y) * Math.min(1, 8 * dt);
  } else {
    const ht = Math.sin(gRef.state.time * 0.8 + b.walkPhase) * 0.45;
    P.head.rotation.y += (ht - P.head.rotation.y) * Math.min(1, 3 * dt);
  }
}

// красная вспышка материала при попадании (0.15 с)
function updateFlash(b, dt) {
  if (b.hitFlash <= 0) return;
  b.hitFlash -= dt * 6.7;
  if (!b.flashOn) {
    b.flashOn = true;
    for (const m of b.mats) { m.emissive.setHex(0x992222); m.emissiveIntensity = 1; }
  }
  if (b.hitFlash <= 0) {
    b.flashOn = false;
    for (const m of b.mats) { m.emissive.setHex(0x000000); m.emissiveIntensity = 0; }
  }
}

function separateBots() {
  const minDistance = 0.7;
  const minDistanceSquared = minDistance * minDistance;
  for (let i = 0; i < bots.length; i += 1) {
    const a = bots[i];
    if (!a.alive || a.state === 'dead') continue;
    for (let j = i + 1; j < bots.length; j += 1) {
      const b = bots[j];
      if (!b.alive || b.state === 'dead') continue;
      let dx = b.mesh.position.x - a.mesh.position.x;
      let dz = b.mesh.position.z - a.mesh.position.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= minDistanceSquared) continue;
      if (distanceSquared < 1e-6) { dx = 1; dz = 0; }
      else {
        const distance = Math.sqrt(distanceSquared);
        dx /= distance;
        dz /= distance;
      }
      const distance = Math.sqrt(Math.max(distanceSquared, 1e-6));
      const push = (minDistance - distance) * 0.5;
      const aPos = resolveCircle(a.mesh.position.x - dx * push, a.mesh.position.z - dz * push, 0.35);
      const bPos = resolveCircle(b.mesh.position.x + dx * push, b.mesh.position.z + dz * push, 0.35);
      a.mesh.position.x = aPos[0]; a.mesh.position.z = aPos[1];
      b.mesh.position.x = bPos[0]; b.mesh.position.z = bPos[1];
    }
  }
}

// ============================================================
//  ГЛАВНЫЙ ЦИКЛ
// ============================================================
export function update(dt, g) {
  updatePools(dt);
  updatePickups(dt);
  const playerAlive = !g.demo && g.state.alive && !g.state.paused;
  const ppos = g.player.pos;

  for (const b of bots) {
    b.mesh.updateMatrixWorld();

    if (b.role === 'watcher' && !b.watcherActive) continue;

    if (b.state === 'dead') { updateDead(b, dt); continue; }

    const mpos = b.mesh.position;
    const dist = mpos.distanceTo(ppos);

    // видимость игрока (проверка с разбросом по времени, не каждый кадр)
    b.visT -= dt;
    let canSee = false;
    if (playerAlive && dist < 45) {
      if (b.visT <= 0) {
        b.visT = 0.15 + Math.random() * 0.1;
        b.canSee = hasLOS(b, ppos);
      }
      canSee = b.canSee;
    } else {
      b.canSee = false;
    }

    if (playerAlive && canSee && dist < 45) {
      if (b.state !== 'attack') { b.state = 'attack'; b.fireT = 1.1 + Math.random() * 0.8; }
      updateAttack(b, dt, ppos, dist);
    } else {
      if (b.state === 'attack') b.state = 'patrol';
      updatePatrol(b, dt);
    }

    updateAnim(b, dt);
    updateFlash(b, dt);
  }
  separateBots();
}
