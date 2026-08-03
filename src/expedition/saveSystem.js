import { CampaignState } from '../core/expedition/runTypes.js';

export const SAVE_VERSION = 2;

export class SaveSystem {
  constructor({ storage = null, key = 'pereval-campaign' } = {}) {
    this.storage = storage;
    this.key = key;
  }

  serialize(campaign) {
    const state = campaign instanceof CampaignState ? campaign : new CampaignState(campaign);
    return {
      version: SAVE_VERSION,
      completedRuns: state.completedRuns,
      permanentUnlocks: [...state.permanentUnlocks],
      stash: { ...state.stash },
      bestTime: state.bestTime,
      runHistory: state.runHistory.map((entry) => ({
        ...entry,
        stats: { ...(entry.stats ?? {}) },
        loot: Array.isArray(entry.loot) ? entry.loot.map((item) => ({ ...item })) : [],
      })),
    };
  }

  save(campaign) {
    const snapshot = this.serialize(campaign);
    if (this.storage?.setItem) this.storage.setItem(this.key, JSON.stringify(snapshot));
    return snapshot;
  }

  export(campaign) {
    return JSON.stringify(this.serialize(campaign));
  }

  import(raw) {
    const campaign = this.load(raw);
    this.save(campaign);
    return campaign;
  }

  reset() {
    try {
      this.storage?.removeItem?.(this.key);
    } catch {
      // Storage is optional and may be unavailable in private browsing.
    }
    return new CampaignState();
  }

  load(raw = null) {
    let parsed = raw;
    try {
      if (parsed == null && this.storage?.getItem) parsed = this.storage.getItem(this.key);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    } catch {
      return new CampaignState();
    }
    if (!parsed || typeof parsed !== 'object') return new CampaignState();
    try {
      return new CampaignState(this.migrate(parsed));
    } catch {
      return new CampaignState();
    }
  }

  migrate(snapshot) {
    if ((snapshot.version ?? 0) > SAVE_VERSION) throw new Error('Unsupported campaign save version');
    if ((snapshot.version ?? 0) === SAVE_VERSION) return snapshot;
    return {
      version: SAVE_VERSION,
      completedRuns: Number.isInteger(snapshot.completedRuns)
        ? snapshot.completedRuns
        : Number.isInteger(snapshot.runs)
          ? snapshot.runs
          : 0,
      permanentUnlocks: Array.isArray(snapshot.permanentUnlocks)
        ? snapshot.permanentUnlocks
        : Array.isArray(snapshot.unlocks)
          ? snapshot.unlocks
          : [],
      stash: snapshot.stash && typeof snapshot.stash === 'object' ? snapshot.stash : {},
      bestTime: Number.isFinite(snapshot.bestTime) ? snapshot.bestTime : null,
      runHistory: Array.isArray(snapshot.runHistory) ? snapshot.runHistory : [],
    };
  }
}
