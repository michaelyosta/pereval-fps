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
import { EventBus } from './core/EventBus.js';
import { damagePlayer as applyPlayerDamage, respawnPlayer as resetPlayerState } from './core/gameplay.js';
import { resolveCapsuleMotion } from './core/collision.js';
import * as combatModule from './combat.js';
import * as botsModule from './bots.js';
import * as uiModule from './ui.js';
import { getQualityPreset, QUALITY_PRESETS } from './config/graphics.js';
import { RunManager } from './core/expedition/RunManager.js';
import { ThreeWorldAssembler } from './expedition/threeWorldAssembler.js';
import { SaveSystem } from './expedition/saveSystem.js';
import { InteractionSystem, Interactable } from './expedition/interactions.js';

const $ = (s) => document.querySelector(s);
const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has('demo');
const MODE = PARAMS.get('mode') || (DEMO ? 'arena' : 'expedition');
const LEGACY_ARENA = MODE === 'arena';
const EXPEDITION = !LEGACY_ARENA;
const RUN_SEED = PARAMS.get('seed') || 'default';
if (PARAMS.has('debug')) document.body.classList.add('debug');

// ---------- ошибки на экран (для отладки) ----------
window.addEventListener('error', (e) => {
  const el = $('#err');
  el.style.display = 'block';
  el.textContent = 'ERR: ' + (e.message || e);
});

// ---------- renderer ----------
const storedQuality = (() => {
  try { return localStorage.getItem('pereval-quality'); } catch { return null; }
})();
const qualityName = getQualityPreset(PARAMS.get('quality') || storedQuality || 'High');
const quality = QUALITY_PRESETS[qualityName];
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// защита от потери контекста (чёрный экран при фоне/глюке драйвера)
renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  if (typeof g !== 'undefined' && g.renderer) { g.renderer.render(g.scene, g.camera); }
}, false);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // мягкая полутень через shadow.radius
renderer.info.autoReset = false;
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
renderer.shadowMap.enabled = quality.shadows;
bloom.strength = quality.bloom;
grainPass.uniforms.amount.value = quality.grain;

// ---------- контракт GAME ----------
const mods = { world: null, combat: combatModule, bots: botsModule, ui: uiModule };
const campaignStorage = (() => {
  try { return window.localStorage; } catch { return null; }
})();
function expeditionInteractionLOS(playerPosition, interactable) {
  if (!g?.expeditionScene?.group || !interactable?.object) return true;
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const target = new THREE.Vector3(interactable.position.x, interactable.position.y ?? 0.45, interactable.position.z);
  const direction = target.sub(origin);
  const distance = direction.length();
  if (!distance) return true;
  direction.normalize();
  const ray = new THREE.Raycaster(origin, direction, 0, distance + 0.1);
  const hits = ray.intersectObjects([g.expeditionScene.group], true);
  if (!hits.length) return true;
  let node = hits[0].object;
  while (node) {
    if (node === interactable.object || node.userData?.interactableId === interactable.id) return true;
    node = node.parent;
  }
  return false;
}
const g = {
  renderer, scene, camera, composer, viewRoot,
  demo: DEMO,
  mode: MODE,
  expedition: EXPEDITION ? new RunManager({ saveSystem: new SaveSystem({ storage: campaignStorage }) }) : null,
  expeditionAssembler: EXPEDITION ? new ThreeWorldAssembler(scene) : null,
  expeditionScene: null,
  expeditionInteractions: EXPEDITION
    ? new InteractionSystem({ lineOfSight: expeditionInteractionLOS })
    : null,
  interactionInterrupted: false,
  noiseAccumulator: 0,
  runSeed: RUN_SEED,
  sessionStarted: false,
  noLock: false,          // fallback: игра без захвата мыши (если pointer lock недоступен)
  clock: new THREE.Clock(),
  input: {
    forward: 0, strafe: 0, sprint: false, fire: false, ads: false,
    reload: false, jump: false, interact: false, heal: false, firePressed: false, lookDX: 0, lookDY: 0
  },
  settings: { sensitivity: 0.0022, invertY: false },
  state: {
    health: 100, maxHealth: 100, alive: true,
    kills: 0, matchTarget: 5, matchWon: false, shots: 0, hits: 0, headshots: 0, damageTaken: 0,
    ammo: 30, reserve: 120, magSize: 30, weaponName: 'ОБЛОМОК-7',
    reloading: false, time: 0, paused: true
  },
  events: new EventBus(),
  recoil: { pitch: 0, y: 0 },
  ads: { amount: 0 },          // 0..1 плавное прицеливание
  player: {
    pos: new THREE.Vector3(0, 1.62, 14),   // позиция глаза
    vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    onGround: true, bobPhase: 0, bobSpeed: 0, moveSpeed: 0,
    spawn: new THREE.Vector3(0, 1.62, 14)
  },
  staticGroup: null,           // заполняет world.js (стены, ящики, земля)
  demoTime: 0,
  services: mods,
  quality: qualityName,
  debug: { fps: 0, frameTime: 0, wallClock: 0, spread: 0, recoil: 0 },
  damagePlayer: null
};

try {
  const storedSensitivity = Number(localStorage.getItem('pereval-sensitivity'));
  if (Number.isFinite(storedSensitivity)) g.settings.sensitivity = Math.max(0.001, Math.min(0.004, storedSensitivity));
  g.settings.invertY = localStorage.getItem('pereval-invert-y') === '1';
} catch { /* storage is optional */ }

if (import.meta.env?.DEV || PARAMS.has('debug')) {
  window.__PEREVAL_DEBUG__ = {
    getState: () => ({
      ...g.state,
      player: { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z },
      pointerLocked: document.pointerLockElement === renderer.domElement
    }),
    getRendererInfo: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      points: renderer.info.render.points,
      lines: renderer.info.render.lines,
      memory: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      },
    }),
    getNavigationMeshState: () => g.expedition?.run?.map?.navigationMesh?.snapshot?.() ?? null,
    getNavigationPath: (nodeId, start, target) =>
      g.expedition?.run?.map?.navigationMesh?.pathWithinNode?.(nodeId, start, target) ?? [],
    getPerformanceState: () => ({ ...(g.expedition?.run?.performance ?? {}) }),
    getRunState: () => g.expedition?.snapshot?.() ?? null,
    getDynamicObstacles: () => g.expedition?.getDynamicObstacles?.() ?? [],
    getEncounterState: () => g.expedition?.encounterDirector?.snapshot?.() ?? null,
    getBotState: () => mods.bots?.getBots?.().map((bot) => ({
      id: bot.id,
      archetype: bot.archetype,
      alive: bot.alive,
      groupId: bot.expeditionGroupId ?? null,
      nodeId: bot.expeditionNodeId ?? null,
      navigation: bot.navigationAgent?.snapshot?.() ?? null,
    })) ?? [],
    recordNoise: (options = {}) => g.expedition?.recordNoise?.({
      ...options,
      position: options.position ?? { x: g.player.pos.x, z: g.player.pos.z },
    }) ?? new Map(),
    tickRun: (seconds = 1, insideExtraction = false) => {
      if (!g.expedition?.run) return null;
      g.expedition.tick(seconds, {
        insideExtraction,
        playerPosition: { x: g.player.pos.x, z: g.player.pos.z },
        playerNodeId: g.expedition.nodeForPosition({ x: g.player.pos.x, z: g.player.pos.z }),
      });
      return g.expedition.snapshot();
    },
    completeObjective: () => g.expedition?.completeObjective?.() ?? null,
    resolveEvent: (id) => g.expedition?.resolveEvent?.(id) ?? null,
    startExtraction: () => {
      if (!g.expedition) return null;
      g.expedition.activateExtraction();
      return g.expedition.snapshot();
    },
    tickExtraction: (seconds = 1, inside = true) => g.expedition?.tickExtraction?.(seconds, inside) ?? false,
    addTemporarySkill: (id = 'steady-hands') => g.expedition?.addTemporarySkill?.({ id, source: 'debug' }) ?? false,
    chooseSkill: (id = null) => g.expedition?.chooseSkill?.(id) ?? false,
    failRun: (reason = 'debug') => g.expedition?.playerDied?.(reason) ?? false,
    copySeed: () => window.navigator?.clipboard?.writeText(g.runSeed),
    shoot: () => mods.combat?.shoot(g, null),
    damagePlayer: (amount = 10) => g.damagePlayer(amount, { type: 'debug' }),
    restartRun: () => { restartMatch(); return g.expedition?.snapshot?.(); },
    addDynamicObstacle: (options = {}) => g.expeditionScene?.addDynamicObstacle?.(options) ?? null,
    updateDynamicObstacle: (id, patch = {}) => g.expeditionScene?.updateDynamicObstacle?.(id, patch) ?? null,
    removeDynamicObstacle: (id) => g.expeditionScene?.removeDynamicObstacle?.(id) ?? false,
    clearDynamicObstacles: (nodeId = null) => g.expeditionScene?.clearDynamicObstacles?.(nodeId) ?? 0,
    killNearestEnemy: () => {
      const bot = mods.bots?.getBots?.().find(
        (candidate) => candidate.alive && candidate.archetype !== 'watcher',
      );
      if (!bot) return { killed: false };
      return mods.bots.applyDamage(g, bot, 999, new THREE.Vector3(0, 0, -1), bot.mesh.position, { debug: true });
    }
  };
}

// ---------- ввод ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'Escape' && g.sessionStarted && !g.demo && g.state.alive) {
    if (document.pointerLockElement === renderer.domElement) {
      document.exitPointerLock();
    } else if (g.noLock) {
      g.state.paused = !g.state.paused;
      setPauseOverlay(g.state.paused);
    }
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyR') g.input.reload = true;
  if (e.code === 'KeyE') g.input.interact = true;
  if (e.code === 'KeyH') g.input.heal = true;
  if (e.code === 'KeyM' && g.expedition) toggleExpeditionMap();
  if (e.code === 'Space' && !g.demo) g.input.jump = true;
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyR') g.input.reload = false;
  if (e.code === 'Space') g.input.jump = false;
  if (e.code === 'KeyE') g.input.interact = false;
  if (e.code === 'KeyH') g.input.heal = false;
});
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement && !g.noLock) return;
  g.player.yaw -= e.movementX * g.settings.sensitivity;
  g.player.pitch += (g.settings.invertY ? 1 : -1) * e.movementY * g.settings.sensitivity;
  g.player.pitch = Math.max(-1.45, Math.min(1.45, g.player.pitch));
  g.input.lookDX = e.movementX; g.input.lookDY = e.movementY;
});
window.addEventListener('mousedown', (e) => {
  if (g.demo || !g.state.alive) return;
  if (document.pointerLockElement !== renderer.domElement && !g.noLock) return;
  if (e.button === 0) { g.input.fire = true; g.input.firePressed = true; }
  if (e.button === 2) g.input.ads = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) g.input.fire = false;
  if (e.button === 2) g.input.ads = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

const titleEl = $('#title');
const pauseEl = $('#pause');
const settingsPanel = $('#settings-panel');
const expeditionLobby = $('#expedition-lobby');
const expeditionHideoutView = $('#expedition-hideout-view');
const expeditionLoadoutView = $('#expedition-loadout-view');
const hideoutCampaignPanels = $('#hideout-campaign-panels');
const skillChoice = $('#skill-choice');
const skillChoiceOptions = $('#skill-choice-options');
const expeditionMap = $('#expedition-map');

function toggleExpeditionMap() {
  expeditionMap?.classList.toggle('on');
}

function setPauseOverlay(visible) {
  if (pauseEl) pauseEl.style.display = visible ? 'flex' : 'none';
  if (settingsPanel && !visible) settingsPanel.style.display = 'none';
}

function setQuality(name) {
  const nextName = getQualityPreset(name);
  const next = QUALITY_PRESETS[nextName];
  g.quality = nextName;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, next.pixelRatio));
  renderer.shadowMap.enabled = next.shadows;
  bloom.strength = next.bloom;
  grainPass.uniforms.amount.value = next.grain;
  const select = $('#quality');
  if (select) select.value = nextName;
  try { localStorage.setItem('pereval-quality', nextName); } catch { /* storage is optional */ }
}
g.setQuality = setQuality;

function requestGamePointerLock() {
  if (!g.sessionStarted || g.demo || !g.state.alive) return;
  g.noLock = true;
  g.state.paused = false;
  setPauseOverlay(false);
  try {
    const lockResult = renderer.domElement.requestPointerLock();
    if (lockResult?.catch) lockResult.catch(() => { g.noLock = true; });
  } catch {
    g.noLock = true;
  }
}

function refreshExpeditionHideout() {
  const campaign = g.expedition?.campaign;
  if (!campaign) return;
  const seedInput = $('#expedition-seed-input');
  if (seedInput) seedInput.value = g.runSeed;
  $('#hideout-runs').textContent = String(campaign.completedRuns);
  $('#hideout-unlocks').textContent = campaign.permanentUnlocks.length
    ? campaign.permanentUnlocks.join(', ')
    : 'нет';
  $('#hideout-best-time').textContent = campaign.bestTime === null ? '—' : `${campaign.bestTime.toFixed(1)}s`;
  const stash = Object.entries(campaign.stash ?? {})
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => `${id}×${amount}`)
    .join(', ');
  $('#hideout-stash').textContent = stash || 'нет';
  const stashList = $('#hideout-stash-list');
  stashList?.replaceChildren();
  const stashEntries = Object.entries(campaign.stash ?? {}).filter(([, amount]) => amount > 0);
  if (stashList) {
    if (!stashEntries.length) {
      const empty = document.createElement('small');
      empty.textContent = 'пусто';
      stashList.append(empty);
    } else {
      for (const [id, amount] of stashEntries) {
        const row = document.createElement('div');
        row.className = 'expedition-campaign-row';
        const name = document.createElement('span');
        name.textContent = id;
        const count = document.createElement('b');
        count.textContent = `×${amount}`;
        row.append(name, count);
        stashList.append(row);
      }
    }
  }
  const historyList = $('#hideout-history-list');
  historyList?.replaceChildren();
  const history = campaign.runHistory ?? [];
  if (historyList) {
    if (!history.length) {
      const empty = document.createElement('small');
      empty.textContent = 'нет завершённых выходов';
      historyList.append(empty);
    } else {
      for (const entry of history.slice(0, 8)) {
        const row = document.createElement('div');
        row.className = 'expedition-campaign-row';
        const name = document.createElement('span');
        name.textContent = `${entry.status === 'success' ? 'SUCCESS' : 'FAILED'} · ${entry.seed ?? '—'}`;
        const detail = document.createElement('small');
        detail.textContent = `${Number(entry.elapsedSeconds ?? 0).toFixed(1)}s · K${entry.stats?.kills ?? 0}`;
        row.append(name, detail);
        historyList.append(row);
      }
    }
  }
}

function showExpeditionHideout() {
  if (!g.expedition) return false;
  if (g.expedition.state === 'Results') g.expedition.returnToHideout();
  if (g.expedition.state === 'MainMenu') g.expedition.openHideout();
  if (g.expedition.state !== 'Hideout') return false;
  g.sessionStarted = false;
  g.state.paused = true;
  g.state.alive = true;
  $('#death').style.display = 'none';
  $('#expedition-results').style.display = 'none';
  titleEl.style.display = 'none';
  expeditionLobby.style.display = 'flex';
  expeditionHideoutView.style.display = 'block';
  expeditionLoadoutView.style.display = 'none';
  if (hideoutCampaignPanels) hideoutCampaignPanels.style.display = 'grid';
  refreshExpeditionHideout();
  return true;
}

function showExpeditionLoadout() {
  if (!g.expedition || g.expedition.state !== 'Hideout') return false;
  g.expedition.openLoadout();
  expeditionHideoutView.style.display = 'none';
  expeditionLoadoutView.style.display = 'block';
  if (hideoutCampaignPanels) hideoutCampaignPanels.style.display = 'none';
  return true;
}

function applyExpeditionLoadout(run) {
  const weapon = run?.weapon?.definition;
  if (!weapon) return;
  g.state.weaponName = weapon.name;
  g.state.magSize = weapon.magazine;
  g.state.ammo = weapon.magazine;
  g.state.reserve = weapon.magazine * 4;
  g.state.reloading = false;
}

function showSkillChoice(options = []) {
  if (!skillChoice || !skillChoiceOptions) return;
  skillChoiceOptions.replaceChildren();
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'skill-choice-card';
    const name = document.createElement('b');
    name.textContent = option.name;
    const description = document.createElement('span');
    description.textContent = `${option.category} · ${option.description}`;
    button.append(name, description);
    button.addEventListener('click', () => g.expedition?.chooseSkill(option.id));
    skillChoiceOptions.append(button);
  }
  skillChoice.style.display = 'flex';
  g.state.paused = true;
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
}

function hideSkillChoice(resume = true) {
  if (skillChoice) skillChoice.style.display = 'none';
  if (resume && g.sessionStarted && g.state.alive) requestGamePointerLock();
}

function restartMatch() {
  if (g.expedition) {
    if (!['Hideout', 'Loadout', 'Results'].includes(g.expedition.state)) g.expedition.restart('manual-restart');
    if (g.expedition.state === 'Results') g.expedition.returnToHideout();
    if (g.expedition.state === 'MainMenu') g.expedition.openHideout();
    if (g.expedition.state === 'Hideout') {
      g.expedition.openLoadout();
      const run = g.expedition.beginRun({
        seed: g.runSeed,
        testMode: PARAMS.get('testMode') === '1',
        watcher: PARAMS.get('watcher') !== '0',
        primaryWeapon: $('#loadout-weapon')?.value || 'oblomok-7',
      });
      g.expedition.deploy();
      mountExpeditionWorld(run);
      applyExpeditionLoadout(run);
    }
    resetPlayerState(g.state);
    g.state.paused = false;
    g.state.alive = true;
    $('#death').style.display = 'none';
    $('#victory').style.display = 'none';
    requestGamePointerLock();
    return;
  }
  g.state.kills = 0;
  g.state.matchWon = false;
  g.state.shots = 0;
  g.state.hits = 0;
  g.state.headshots = 0;
  g.state.damageTaken = 0;
  g.state.time = 0;
  deathTimer = -1;
  resetPlayerState(g.state);
  g.player.pos.copy(g.player.spawn);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0; g.player.pitch = 0;
  g.recoil.pitch = 0; g.recoil.y = 0;
  $('#death').style.display = 'none';
  $('#victory').style.display = 'none';
  if (mods.bots?.respawnAll) mods.bots.respawnAll(g);
  requestGamePointerLock();
}

function showVictory() {
  if (g.state.matchWon) return;
  g.state.matchWon = true;
  g.state.paused = true;
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  const accuracy = g.state.shots ? Math.round((g.state.hits / g.state.shots) * 100) : 0;
  $('#victory-kills').textContent = String(g.state.kills);
  $('#victory-accuracy').textContent = `${accuracy}%`;
  $('#victory-time').textContent = `${g.state.time.toFixed(1)}s`;
  $('#victory').style.display = 'flex';
}

g.events.on('enemy:hit', ({ killed, archetype }) => {
  if (killed && g.expedition) g.expedition.recordKill(1, archetype);
  if (killed && !g.expedition && g.state.kills >= g.state.matchTarget) showVictory();
});

g.events.on('weapon:shot', ({ noise = 1 }) => {
  if (!g.expedition?.run) return;
  g.expedition.recordNoise({
    kind: 'shot',
    position: { x: g.player.pos.x, z: g.player.pos.z },
    intensity: noise,
    duration: 2,
    visualContact: true,
  });
});

$('#resume')?.addEventListener('click', requestGamePointerLock);
$('#pause-back')?.addEventListener('click', requestGamePointerLock);
$('#restart')?.addEventListener('click', restartMatch);
$('#settings')?.addEventListener('click', () => {
  if (settingsPanel) settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
});
$('#quality')?.addEventListener('change', (event) => setQuality(event.target.value));
const sensitivity = $('#sensitivity');
const invertY = $('#invert-y');
if (sensitivity) sensitivity.value = String(g.settings.sensitivity);
if (invertY) invertY.checked = g.settings.invertY;
sensitivity?.addEventListener('input', (event) => {
  g.settings.sensitivity = Number(event.target.value);
  try { localStorage.setItem('pereval-sensitivity', String(g.settings.sensitivity)); } catch { /* storage is optional */ }
});
invertY?.addEventListener('change', (event) => {
  g.settings.invertY = event.target.checked;
  try { localStorage.setItem('pereval-invert-y', event.target.checked ? '1' : '0'); } catch { /* storage is optional */ }
});
$('#victory-restart')?.addEventListener('click', restartMatch);
$('#expedition-copy-seed')?.addEventListener('click', async () => {
  try {
    await window.navigator?.clipboard?.writeText(g.runSeed);
  } catch {
    // Clipboard access is optional in local and headless browsers.
  }
});
$('#expedition-next')?.addEventListener('click', () => {
  showExpeditionHideout();
});
$('#hideout-loadout')?.addEventListener('click', showExpeditionLoadout);
$('#expedition-map-toggle')?.addEventListener('click', toggleExpeditionMap);
$('#loadout-back')?.addEventListener('click', showExpeditionHideout);
$('#loadout-deploy')?.addEventListener('click', () => {
  if (!startExpeditionRun()) return;
  g.sessionStarted = true;
  requestGamePointerLock();
});
function startExpeditionRun() {
  if (!g.expedition) return false;
  if (g.expedition.state === 'Results') g.expedition.returnToHideout();
  if (g.expedition.state === 'MainMenu') g.expedition.openHideout();
  if (g.expedition.state === 'Hideout') g.expedition.openLoadout();
  if (g.expedition.state !== 'Loadout') return false;
  const selectedSeed = $('#expedition-seed-input')?.value.trim() || g.runSeed;
  g.runSeed = selectedSeed;
  const run = g.expedition.beginRun({
    seed: selectedSeed,
    difficulty: PARAMS.get('difficulty') || 'standard',
    testMode: PARAMS.get('testMode') === '1',
    watcher: PARAMS.get('watcher') !== '0',
    primaryWeapon: $('#loadout-weapon')?.value || 'oblomok-7'
  });
  g.expedition.deploy();
  mountExpeditionWorld(run);
  applyExpeditionLoadout(run);
  resetPlayerState(g.state);
  g.state.matchWon = false;
  g.state.alive = true;
  g.state.paused = false;
  g.state.time = 0;
  expeditionLobby.style.display = 'none';
  titleEl.style.display = 'none';
  return true;
}

function mountExpeditionWorld(run) {
  if (!g.expeditionAssembler || !run?.map) return;
  if (g.staticGroup) g.staticGroup.visible = false;
  g.expeditionScene = g.expeditionAssembler.assemble(run.map);
  g.expedition.recordPerformance(g.expeditionScene.timings);
  for (const obstacle of g.expedition.getDynamicObstacles?.() ?? [])
    g.expeditionScene.addDynamicObstacle?.(obstacle);
  registerExpeditionInteractions(run, g.expeditionScene);
  const startNode = run.map.graph.getNode(run.map.graph.startNodeId);
  if (startNode) {
    g.player.spawn.set(startNode.position.x, 1.62, startNode.position.z + startNode.definition.size.z * 0.25);
    g.player.pos.copy(g.player.spawn);
  }
  if (mods.bots?.spawnBots) mods.bots.spawnBots(g, 12);
}

function registerExpeditionInteractions(run, assembled) {
  const interactions = g.expeditionInteractions;
  if (!interactions) return;
  interactions.clear();
  for (const descriptor of assembled?.interactables ?? []) {
    const isLoot = descriptor.type === 'loot';
    const isObjective = descriptor.type === 'objective';
    const isExtraction = descriptor.type === 'extraction';
    const isEvent = descriptor.type === 'event';
    interactions.register(new Interactable({
      ...descriptor,
      duration: isLoot && run.map.lootContainers.find((item) => item.id === descriptor.id)?.secured ? 1.2 : 0,
      available: () => {
        if (isLoot) return !run.map.lootContainers.find((item) => item.id === descriptor.id)?.opened;
        if (isObjective) return ['Exploration', 'ObjectiveActive'].includes(g.expedition.state);
        if (isExtraction) return g.expedition.state === 'ExtractionAvailable';
        if (isEvent) return !run.eventDirector?.get(descriptor.id)?.resolved;
        return false;
      },
      onInteract: () => {
        if (isLoot) {
          const result = g.expedition.collectLoot(descriptor.id);
          if (result.ok) {
            if (descriptor.object) descriptor.object.visible = false;
            g.events.emit('loot:collected', result);
          }
          return result.ok ? result : false;
        }
        if (isObjective) {
          const step = run.objective.steps[run.objective.currentStep];
          if (!step || step.nodeId !== descriptor.nodeId) return false;
          if (g.expedition.state === 'Exploration') g.expedition.startObjective();
          return g.expedition.completeObjectiveStep(step.id);
        }
        if (isExtraction && g.expedition.state === 'ExtractionAvailable') {
          g.expedition.activateExtraction();
          return true;
        }
        if (isEvent) {
          const result = g.expedition.resolveEvent(descriptor.id);
          if (result.ok && descriptor.object) descriptor.object.visible = false;
          if (result.ok) g.events.emit('event:resolved', result);
          return result.ok ? result : false;
        }
        return false;
      },
    }));
  }
}

function showExpeditionResults(result) {
  if (!g.expedition || !result) return;
  $('#expedition-results-title').textContent = result.status === 'success' ? 'RUN COMPLETE' : 'RUN FAILED';
  $('#expedition-result-status').textContent = result.status;
  $('#expedition-result-seed').textContent = result.seed ?? g.runSeed;
  $('#expedition-result-kills').textContent = String(result.stats?.kills ?? 0);
  $('#expedition-result-time').textContent = `${Number(result.elapsedSeconds ?? 0).toFixed(1)}s`;
  $('#expedition-result-modules').textContent = String(result.visitedModules?.length ?? 0);
  $('#expedition-result-events').textContent = String(result.stats?.eventsResolved ?? 0);
  $('#expedition-next').textContent = result.status === 'success' ? 'Return to hideout' : 'Recover in hideout';
  $('#expedition-results').style.display = 'flex';
  expeditionLobby.style.display = 'none';
  g.state.paused = true;
  setPauseOverlay(false);
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
}

function nearestExpeditionModule(maxDistance = 8) {
  const run = g.expedition?.run;
  if (!run?.map?.spatialIndex) return null;
  return run.map.spatialIndex.nearest(
    { x: g.player.pos.x, z: g.player.pos.z },
    maxDistance,
    (candidate) => Boolean(candidate.moduleId),
  );
}

function playerAtExpeditionNode(nodeId) {
  const node = g.expedition?.run?.map?.graph?.getNode?.(nodeId);
  if (!node) return false;
  const distance = Math.hypot(g.player.pos.x - node.position.x, g.player.pos.z - node.position.z);
  return distance <= Math.max(node.definition.size.x, node.definition.size.z) * 0.45;
}

function interactWithExpedition() {
  const manager = g.expedition;
  const run = manager?.run;
  if (!manager || !run) return false;
  if (g.expeditionInteractions) {
    const result = g.expeditionInteractions.interact(
      { x: g.player.pos.x, z: g.player.pos.z },
      { run, moving: g.player.moveSpeed > 0.25 },
    );
    if (result.reason !== 'nothing-nearby') return result.ok;
  }
  const module = nearestExpeditionModule();
  if (!module) return false;
  if (manager.state === 'Exploration') {
    const step = run.objective.steps[run.objective.currentStep];
    if (step?.nodeId === module.id) {
      manager.startObjective();
      return true;
    }
  }
  if (manager.state === 'ObjectiveActive') {
    const step = run.objective.steps[run.objective.currentStep];
    if (step?.nodeId === module.id) return manager.completeObjectiveStep(step.id);
  }
  if (manager.state === 'ExtractionAvailable' && playerAtExpeditionNode(run.extraction.nodeId)) {
    manager.activateExtraction();
    return true;
  }
  return false;
}

function useExpeditionHealing() {
  if (!g.expedition?.run || !g.state.alive || g.state.health >= g.state.maxHealth) return false;
  const result = g.expedition.useHealing('medkit');
  if (!result.ok) return false;
  g.state.health = Math.min(g.state.maxHealth, g.state.health + result.amount);
  g.events.emit('player:healed', result);
  return true;
}
// старт по клику на баннер (баннер перекрывает canvas — вешаем обработчик на него)
titleEl.addEventListener('click', () => {
  if (g.demo) return;
  if (!g.state.alive) return;
  if (g.expedition) {
    showExpeditionHideout();
    return;
  }
  g.sessionStarted = true;
  titleEl.style.display = 'none';
  requestGamePointerLock();
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!g.sessionStarted || g.demo) return;
  if (locked) {
    g.noLock = false;
    g.state.paused = false;
    setPauseOverlay(false);
  } else if (!g.noLock && !g.state.matchWon && !g.expedition?.run?.result) {
    g.state.paused = true;
    setPauseOverlay(true);
  }
  if (locked) titleEl.style.display = 'none';
});
document.addEventListener('pointerlockerror', () => {
  // браузер отклонил захват — играем без него (fallback)
  g.noLock = true;
  g.state.paused = false;
  g.sessionStarted = true;
  setPauseOverlay(false);
  titleEl.style.display = 'none';
});

// ---------- физика игрока (горизонталь: окружность против AABBs) ----------
function resolveCollision(x, z, r) {
  const cols = g.expeditionScene?.colliders ?? ((mods.world && mods.world.getColliders) ? mods.world.getColliders() : []);
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
  const weaponMovement = g.expedition?.run?.weapon?.definition?.movementMultiplier ?? 1;
  const baseSpeed = (ads > 0.5 ? 2.6 : sprinting ? 6.9 : 4.3) * weaponMovement;
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
function hurtPlayer(dmg, source) {
  if (g.demo) return { applied: 0, killed: false };
  const result = applyPlayerDamage(
    g.state,
    dmg,
    (event) => g.events.emit('player:damaged', event),
    source
  );
  g.state.damageTaken = (g.state.damageTaken || 0) + result.applied;
  if (result.killed) {
    g.input.fire = false; g.input.ads = false;
    $('#death').style.display = 'flex';
    if (g.expedition?.run) {
      g.expedition.playerDied('player-died');
      g.state.paused = true;
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      deathTimer = -1;
    } else {
      deathTimer = 3.0;
    }
  }
  if (result.applied > 0) g.interactionInterrupted = true;
  return result;
}
g.damagePlayer = hurtPlayer;

function respawn() {
  resetPlayerState(g.state);
  g.player.pos.copy(g.player.spawn);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0; g.player.pitch = 0;
  g.recoil.pitch = 0; g.recoil.y = 0;
  g.state.ammo = g.state.magSize;
  g.state.reserve = 120;
  g.state.reloading = false;
  g.events.emit('player:respawned', { health: g.state.health });
  $('#death').style.display = 'none';
  if (mods.bots && mods.bots.respawnAll) mods.bots.respawnAll(g);
}

// ---------- главный цикл ----------
function frame() {
  requestAnimationFrame(frame);
  renderer.info.reset();
  const dt = Math.min(g.clock.getDelta(), 0.05);
  g.debug.wallClock += dt;
  g.debug.frameTime = dt * 1000;
  g.debug.fps = g.debug.fps * 0.9 + (1 / Math.max(dt, 0.001)) * 0.1;
  const simDt = g.demo || !g.state.paused ? dt : 0;
  if (simDt > 0) g.state.time += simDt;
  if (g.expedition && simDt > 0 && g.expedition.run) {
    const extractionNodeId = g.expedition.run.extraction.nodeId;
    g.expedition.tick(simDt, {
      insideExtraction: playerAtExpeditionNode(extractionNodeId),
      playerPosition: { x: g.player.pos.x, z: g.player.pos.z },
      playerNodeId: g.expedition.nodeForPosition({ x: g.player.pos.x, z: g.player.pos.z }),
    });
    g.state.time = g.expedition.run.elapsedSeconds;
    const nearbyModule = nearestExpeditionModule(12);
    if (nearbyModule && !g.expedition.run.visitedModules.includes(nearbyModule.id)) {
      g.expedition.run.visitedModules.push(nearbyModule.id);
      g.expedition.emit({ type: 'module-visited', moduleId: nearbyModule.id });
    }
    g.expeditionInteractions?.tick(
      simDt,
      { x: g.player.pos.x, z: g.player.pos.z },
      { run: g.expedition.run, moving: g.player.moveSpeed > 0.25, damaged: g.interactionInterrupted },
    );
    g.interactionInterrupted = false;
  }
  grainPass.uniforms.time.value = g.state.time;

  // WASD-движение и спринт (каждый кадр — надёжнее обработчиков)
  g.input.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  g.input.strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  g.input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');

  if (g.demo) {
    demo.update(simDt);
    g.player.bobPhase = 0;
  } else if (!g.state.paused) {
    if (g.expedition && g.input.heal) {
      useExpeditionHealing();
      g.input.heal = false;
    }
    if (g.state.alive) updatePlayer(dt);
    else if (deathTimer > 0) { deathTimer -= dt; if (deathTimer <= 0) respawn(); }
    // поворот камеры даже стоя (для прицеливания)
    camera.rotation.x = g.player.pitch + g.recoil.pitch * 1.4;
    camera.rotation.y = g.player.yaw;
    if (g.expedition && g.input.interact) {
      interactWithExpedition();
      g.input.interact = false;
    }
  }

  if (g.expedition?.run && simDt > 0 && g.state.alive && g.player.moveSpeed > 0.25) {
    g.noiseAccumulator += simDt;
    if (g.noiseAccumulator >= 0.65) {
      const sprinting = g.input.sprint && g.input.forward > 0;
      g.expedition.recordNoise({
        kind: sprinting ? 'sprint' : 'movement',
        position: { x: g.player.pos.x, z: g.player.pos.z },
        intensity: sprinting ? 1.15 : 0.42,
        duration: 0.75,
      });
      g.noiseAccumulator = 0;
    }
  } else {
    g.noiseAccumulator = 0;
  }

  if (mods.world && mods.world.update) mods.world.update(simDt, g);
  if (mods.combat && mods.combat.update) mods.combat.update(simDt, g);
  if (mods.bots && mods.bots.update) mods.bots.update(simDt, g);

  composer.render();
  if (mods.ui && mods.ui.update) mods.ui.update(simDt, g);
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
  if (LEGACY_ARENA) mods.world = await import('./world.js');
  if (g.expedition) {
    g.expedition.start();
    g.expedition.onChange((event) => {
      if (event.type === 'run-finished') showExpeditionResults(event.result);
      if (event.type === 'skill-offer') showSkillChoice(event.options);
      if (event.type === 'skill-selected') hideSkillChoice();
      if (event.type === 'watcher-activated') {
        mods.bots?.activateWatcher?.(g, event.candidateId);
        g.events.emit('watcher:activated', event);
      }
      if (event.type === 'encounter-requested') {
        const result = mods.bots?.spawnEncounter?.(g, event);
        if (!result?.ok) g.expedition?.encounterDirector?.markFailed?.(event.groupId, result?.reason);
      }
      if (event.type === 'dynamic-obstacle-added')
        g.expeditionScene?.addDynamicObstacle?.(event.obstacle);
      if (event.type === 'dynamic-obstacle-updated')
        g.expeditionScene?.updateDynamicObstacle?.(event.obstacle.id, event.obstacle.source);
      if (event.type === 'dynamic-obstacle-removed') g.expeditionScene?.removeDynamicObstacle?.(event.id);
    });
  }
  if (mods.world && mods.world.init) mods.world.init(g);
  if (mods.combat && mods.combat.init) mods.combat.init(g);
  if (mods.bots && mods.bots.init) mods.bots.init(g);
  if (mods.ui && mods.ui.init) mods.ui.init(g);

  if (g.demo) {
    g.state.paused = false;
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
