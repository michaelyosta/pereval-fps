// ============================================================
//  UI: HUD (DOM) + процедурный звук (WebAudio)
//  Модуль: export function init(g), update(dt, g), sfx(name, vol)
// ============================================================
const $ = (s) => document.querySelector(s);

let g;
let audioCtx = null, master = null, windGain = null;
const sfxImpl = {}; // имя -> fn(vol)

// ---------- WebAudio: синтез всех звуков ----------
function initAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC();
  const comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 6; comp.knee.value = 12;
  comp.connect(audioCtx.destination);
  master = audioCtx.createGain();
  master.gain.value = 0.42;
  master.connect(comp);

  const noiseBuf = (() => {
    const len = audioCtx.sampleRate * 1.0;
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  })();

  const env = (node, t0, a, peak, d, sus = 0) => {
    const t = audioCtx.currentTime + t0;
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    node.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0002), t + a + d);
  };

  const noise = (t0, dur, { type = 'lowpass', freq = 800, q = 0.8, peak = 0.5, sus = 0.0001, dest = master } = {}) => {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = audioCtx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const gn = audioCtx.createGain();
    env(gn, t0, 0.004, peak, dur, sus);
    src.connect(f); f.connect(gn); gn.connect(dest);
    src.start(audioCtx.currentTime + t0);
    src.stop(audioCtx.currentTime + t0 + dur + 0.1);
  };

  const osc = (t0, type, f0, f1, dur, peak, dest = master) => {
    const o = audioCtx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, audioCtx.currentTime + t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), audioCtx.currentTime + t0 + dur);
    const gn = audioCtx.createGain();
    env(gn, t0, 0.004, peak, dur);
    o.connect(gn); gn.connect(dest);
    o.start(audioCtx.currentTime + t0);
    o.stop(audioCtx.currentTime + t0 + dur + 0.1);
  };

  sfxImpl.shoot = (v = 1) => {
    const p = 1 + (Math.random() * 0.06 - 0.03);
    noise(0, 0.22, { type: 'lowpass', freq: 1300 * p, q: 0.6, peak: 0.55 * v });
    noise(0.002, 0.08, { type: 'highpass', freq: 2200, q: 0.8, peak: 0.22 * v });
    osc(0, 'sine', 150 * p, 42, 0.13, 0.55 * v);
    osc(0, 'square', 800 * p, 280, 0.03, 0.06 * v);
  };
  sfxImpl.empty = (v = 1) => {
    osc(0, 'square', 1400, 1100, 0.035, 0.16 * v);
  };
  sfxImpl.reload = (v = 1) => {
    noise(0, 0.05, { type: 'highpass', freq: 2200, peak: 0.3 * v });
    noise(0.42, 0.06, { type: 'highpass', freq: 1800, peak: 0.32 * v });
    noise(0.85, 0.07, { type: 'highpass', freq: 1500, peak: 0.28 * v });
    osc(0.85, 'square', 500, 700, 0.05, 0.1 * v);
    noise(1.35, 0.09, { type: 'bandpass', freq: 900, q: 2, peak: 0.3 * v });
  };
  sfxImpl.hit = (v = 1) => {
    osc(0, 'sine', 1700, 1400, 0.05, 0.22 * v);
  };
  sfxImpl.kill = (v = 1) => {
    osc(0, 'sine', 320, 85, 0.28, 0.55 * v);
    osc(0.02, 'sine', 1900, 1200, 0.07, 0.18 * v);
    noise(0, 0.2, { type: 'lowpass', freq: 500, peak: 0.35 * v });
  };
  sfxImpl.hurt = (v = 1) => {
    noise(0, 0.16, { type: 'lowpass', freq: 600, peak: 0.4 * v });
    osc(0, 'sine', 130, 55, 0.2, 0.4 * v);
  };
  sfxImpl.step = (v = 1) => {
    noise(0, 0.08, { type: 'bandpass', freq: 500 + Math.random() * 300, q: 1.4, peak: 0.14 * v });
  };
  sfxImpl.jump = (v = 1) => {
    noise(0, 0.12, { type: 'lowpass', freq: 400, peak: 0.1 * v });
  };
  sfxImpl.land = (v = 1) => {
    noise(0, 0.1, { type: 'lowpass', freq: 380, peak: 0.22 * v });
  };
  sfxImpl.death = (v = 1) => {
    noise(0, 0.9, { type: 'lowpass', freq: 300, peak: 0.5 * v });
    osc(0, 'sine', 110, 30, 0.9, 0.5 * v);
  };
  sfxImpl.respawn = (v = 1) => {
    osc(0, 'sine', 200, 520, 0.35, 0.2 * v);
  };
  sfxImpl.pickup = (v = 1) => {
    osc(0, 'sine', 660, 990, 0.09, 0.22 * v);
    osc(0.05, 'sine', 990, 1320, 0.12, 0.16 * v);
    noise(0, 0.06, { type: 'highpass', freq: 2500, peak: 0.1 * v });
  };
  sfxImpl.shotHit = (v = 1) => { // попадание в игрока
    noise(0, 0.05, { type: 'highpass', freq: 1800, peak: 0.2 * v });
  };

  // ветер (амбиент)
  const wSrc = audioCtx.createBufferSource();
  wSrc.buffer = noiseBuf; wSrc.loop = true;
  const wF = audioCtx.createBiquadFilter();
  wF.type = 'lowpass'; wF.frequency.value = 260; wF.Q.value = 0.4;
  windGain = audioCtx.createGain();
  windGain.gain.value = 0.05;
  wSrc.connect(wF); wF.connect(windGain); windGain.connect(master);
  wSrc.start();
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.11;
  const lfoG = audioCtx.createGain(); lfoG.gain.value = 0.022;
  lfo.connect(lfoG); lfoG.connect(windGain.gain);
  lfo.start();
}

export function sfx(name, vol = 1) {
  if (!audioCtx) return;
  if (sfxImpl[name]) sfxImpl[name](vol);
}

// ---------- HUD элементы ----------
let hud = {};
let hitmarkerTimer = 0, damageFlash = 0;
let lastStep = 0, stepAlt = false;
let mapRefresh = 0;
const kfItems = [];

export function init(_g) {
  g = _g;
  hud = {
    kills: $('#kills'), ammoCur: $('#ammo-cur'), ammoRes: $('#ammo-res'),
    weaponName: $('#weapon-name'), reloadHint: $('#reload-hint'),
    crosshair: $('#crosshair'), hitmarker: $('#hitmarker'),
    damageVig: $('#damage-vig'), body: document.body,
    healthFill: $('#health-fill'), debug: $('#debug-panel'), runSeed: $('#run-seed'), copySeed: $('#copy-seed'),
    interaction: $('#interaction-prompt'), inventory: $('#expedition-inventory-items'), skills: $('#expedition-skills-items'),
    anomaly: $('#expedition-anomaly-value'), mapList: $('#expedition-map-list')
  };
  hud.weaponName.textContent = g.state.weaponName;
  if (hud.runSeed) hud.runSeed.textContent = g.runSeed ?? '—';
  document.body.classList.toggle('expedition-mode', !!g.expedition);
  hud.copySeed?.addEventListener('click', async () => {
    try {
      await window.navigator?.clipboard?.writeText(g.runSeed ?? '');
      hud.copySeed.textContent = 'Скопировано';
      setTimeout(() => { hud.copySeed.textContent = 'Скопировать seed'; }, 900);
    } catch {
      // Clipboard access is optional in local and headless browsers.
    }
  });
  const quality = $('#quality');
  if (quality) quality.value = g.quality;

  // события игры
  g.events.on('enemy:hit', ({ killed }) => {
    if (g.demo) return;
    sfx(killed ? 'kill' : 'hit', killed ? 0.9 : 0.6);
    hitmarkerTimer = killed ? 0.32 : 0.22;
    hud.hitmarker.classList.toggle('kill', !!killed);
    hud.hitmarker.classList.add('show');
    if (killed) addKillfeed('ВЫ', g.state.weaponName, 'ВРАГ');
  });
  g.events.on('player:damaged', () => {
    damageFlash = 1;
    sfx('hurt', 0.7);
  });
  g.events.on('player:healed', ({ amount }) => {
    sfx('pickup', 0.75);
    if (hud.interaction) {
      hud.interaction.textContent = `ЛЕЧЕНИЕ +${amount}`;
      hud.interaction.classList.add('on');
      setTimeout(() => hud.interaction?.classList.remove('on'), 900);
    }
  });
  g.events.on('loot:collected', ({ items = [] }) => {
    if (hud.interaction) {
      hud.interaction.textContent = `ЛУТ: ${items.map((item) => `${item.id}×${item.amount}`).join(', ')}`;
      hud.interaction.classList.add('on');
      setTimeout(() => hud.interaction?.classList.remove('on'), 1300);
    }
  });
  g.events.on('event:resolved', ({ type, items = [] }) => {
    sfx('pickup', 0.85);
    if (hud.interaction) {
      hud.interaction.textContent = `EVENT: ${type} · ${items.map((item) => `${item.id}×${item.amount}`).join(', ')}`;
      hud.interaction.classList.add('on');
      setTimeout(() => hud.interaction?.classList.remove('on'), 1500);
    }
  });

  // старт аудио по первому клику
  document.addEventListener('click', () => initAudio(), { once: true });
  if (g.demo) initAudio();
}

function addKillfeed(killer, weapon, victim) {
  const el = document.createElement('div');
  el.className = 'kf-entry';
  const killerEl = document.createElement('b');
  killerEl.textContent = killer;
  const weaponEl = document.createElement('span');
  weaponEl.className = 'w';
  weaponEl.textContent = weapon;
  el.append(killerEl, document.createTextNode(' '), weaponEl, document.createTextNode(' ▸ '), document.createTextNode(victim));
  const feed = $('#killfeed');
  feed.prepend(el);
  kfItems.push(el);
  while (kfItems.length > 5) { kfItems.shift().remove(); }
  setTimeout(() => { el.style.transition = 'opacity .6s'; el.style.opacity = '0'; }, 3600);
  setTimeout(() => el.remove(), 4300);
}

export function update(dt, _g) {
  g = _g;
  if (!hud.kills) return;

  if (hud.debug) {
    const info = g.renderer?.info?.render || {};
    $('#debug-fps').textContent = (g.debug?.fps || 0).toFixed(1);
    $('#debug-frame').textContent = (g.debug?.frameTime || 0).toFixed(1);
    $('#debug-calls').textContent = String(info.calls || 0);
    $('#debug-triangles').textContent = String(info.triangles || 0);
    $('#debug-spread').textContent = ((g.debug?.spread || 0) * 1000).toFixed(1);
    $('#debug-recoil').textContent = (g.debug?.recoil || 0).toFixed(3);
    $('#debug-lock').textContent = document.pointerLockElement ? 'locked' : (g.noLock ? 'fallback' : 'free');
    $('#debug-pos').textContent = `${g.player.pos.x.toFixed(1)}, ${g.player.pos.y.toFixed(1)}, ${g.player.pos.z.toFixed(1)}`;
    $('#debug-weapon').textContent = g.state.reloading ? 'reloading' : g.state.alive ? 'ready' : 'dead';
    if (g.expedition) {
      const run = g.expedition.run;
      $('#debug-seed').textContent = g.runSeed ?? '—';
      $('#debug-run-state').textContent = g.expedition.state;
      $('#debug-threat').textContent = String(Math.round(run?.threat ?? 0));
      $('#debug-anomaly').textContent = `${Math.round(run?.anomaly ?? 0)} / ${run?.watcher?.state ?? run?.watcherState ?? 'disabled'}`;
      $('#debug-module').textContent = run?.map?.objective?.steps?.[run.objective.currentStep]?.nodeId ?? '—';
    }
  }

  // kills
  hud.kills.textContent = g.state.kills;
  const target = $('#target-progress');
  if (target) {
    const objective = g.expedition?.run?.objective;
    target.textContent = objective
      ? `${Math.min(objective.currentStep, objective.steps.length)} / ${objective.steps.length}`
      : `${g.state.kills} / ${g.state.matchTarget}`;
  }

  // здоровье
  if (hud.healthFill) {
    const hp = Math.max(0, g.state.health) / g.state.maxHealth;
    hud.healthFill.style.width = (hp * 100).toFixed(1) + '%';
    hud.healthFill.style.background = hp > 0.55
      ? 'linear-gradient(90deg,#43a047,#7cb342)'
      : hp > 0.3 ? 'linear-gradient(90deg,#f9a825,#ffb300)'
      : 'linear-gradient(90deg,#e53935,#ef5350)';
  }

  // ammo
  hud.weaponName.textContent = g.state.weaponName;
  hud.ammoCur.textContent = g.state.reloading ? '—' : g.state.ammo;
  hud.ammoRes.textContent = g.state.reserve;
  hud.reloadHint.classList.toggle('on', g.state.reloading);
  if (g.state.ammo === 0 && !g.state.reloading && g.state.reserve > 0) hud.reloadHint.classList.add('on');
  if (hud.inventory) {
    const items = g.expedition?.run?.inventory?.items ?? [];
    const summary = new Map();
    for (const item of items) summary.set(item.id, (summary.get(item.id) ?? 0) + item.amount);
    hud.inventory.textContent = summary.size
      ? [...summary.entries()].map(([id, amount]) => `${id}×${amount}`).join(' · ')
      : 'пусто';
  }
  if (hud.skills) {
    const skills = g.expedition?.run?.temporarySkills ?? [];
    hud.skills.textContent = skills.length
      ? skills.map((skill) => `${skill.id} ${Math.ceil(skill.remaining ?? 0)}s`).join(' · ')
      : 'нет';
  }
  if (hud.anomaly) {
    const run = g.expedition?.run;
    hud.anomaly.textContent = `${Math.round(run?.anomaly ?? 0)} · ${run?.anomalyBand ?? 'quiet'}`;
  }
  if (hud.mapList && g.expedition?.run && (mapRefresh -= dt) <= 0) {
    mapRefresh = 0.35;
    const run = g.expedition.run;
    const visited = new Set(run.visitedModules ?? []);
    hud.mapList.replaceChildren();
    for (const { instance, role } of run.map.modules ?? []) {
      const row = document.createElement('div');
      row.className = `expedition-map-row${visited.has(instance.id) ? ' known' : ''}`;
      const label = document.createElement('span');
      label.textContent = visited.has(instance.id) ? instance.moduleId : 'unknown sector';
      const state = document.createElement('span');
      state.textContent = visited.has(instance.id) ? role : '???';
      row.append(label, state);
      hud.mapList.append(row);
    }
  }

  // crosshair
  const spread = 6
    + g.player.moveSpeed * 2.2
    + (g.input.sprint ? 8 : 0)
    + (g.player.onGround ? 0 : 6)
    + (g.state.reloading ? 4 : 0);
  document.documentElement.style.setProperty('--spread', spread.toFixed(1) + 'px');
  hud.crosshair.classList.toggle('ads', g.ads.amount > 0.5 || !g.state.alive);
  if (hud.interaction && g.expeditionInteractions && g.expedition?.run && !g.state.paused) {
    const prompt = g.expeditionInteractions.prompt(
      { x: g.player.pos.x, z: g.player.pos.z },
      { run: g.expedition.run, moving: g.player.moveSpeed > 0.25 },
    );
    hud.interaction.textContent = prompt?.available ? `${prompt.label} [${prompt.action}]` : '';
    hud.interaction.classList.toggle('on', Boolean(prompt?.available));
  } else if (hud.interaction) {
    hud.interaction.classList.remove('on');
  }

  // hitmarker
  if (hitmarkerTimer > 0) {
    hitmarkerTimer -= dt;
    if (hitmarkerTimer <= 0) hud.hitmarker.classList.remove('show');
  }

  // урон
  if (damageFlash > 0) {
    damageFlash = Math.max(0, damageFlash - dt * 3.2);
    hud.damageVig.style.opacity = (0.85 * damageFlash).toFixed(2);
  }
  hud.body.classList.toggle('lowhp', g.state.health < 35 && g.state.health > 0);

  // шаги
  if (g.player.onGround && g.player.moveSpeed > 1.2 && !g.demo) {
    const ph = g.player.bobPhase;
    if (ph > lastStep + Math.PI) {
      lastStep = ph;
      stepAlt = !stepAlt;
      sfx('step', stepAlt ? 0.55 : 0.45);
    }
  } else {
    lastStep = g.player.bobPhase;
  }

  // low ammo auto hint
  if (g.state.ammo === 0 && !g.state.reloading && g.state.reserve > 0 && !g.input.reload) {
    // можно ускорить: R уже в main
  }
}
