import { SeededRandom } from '../core/expedition/SeededRandom.js';
import { ConnectorAwarePlanner } from './navigation.js';

export const EncounterGroupState = Object.freeze({
  Dormant: 'dormant',
  Initial: 'initial',
  Pending: 'pending',
  Spawned: 'spawned',
});

function distanceBetween(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.z ?? 0) - (b.z ?? 0));
}

function isDangerousNoise(noise) {
  if (!noise) return false;
  return noise.intensity >= 2.2 || ['shot', 'forced-loot', 'extraction'].includes(noise.kind);
}

export class EncounterDirector {
  constructor({
    groups = [],
    graph = null,
    threatDirector = null,
    seed = 'encounters',
    initialBudget = 12,
    activationDelay = 25,
    testMode = false,
    minSpawnDistance = 16,
    cooldown = 16,
  } = {}) {
    this.random = new SeededRandom(seed);
    this.graph = graph;
    this.planner = graph ? new ConnectorAwarePlanner(graph) : null;
    this.threatDirector = threatDirector;
    this.initialBudget = Math.max(1, initialBudget | 0);
    this.activationDelay = testMode ? Math.min(2, activationDelay) : Math.max(0, activationDelay);
    this.minSpawnDistance = Math.max(8, minSpawnDistance);
    this.baseCooldown = testMode ? Math.min(1.5, cooldown) : Math.max(2, cooldown);
    this.elapsed = 0;
    this.cooldown = 0;
    this.records = groups.map((group) => ({
      group,
      state: EncounterGroupState.Dormant,
      attempts: 0,
      spawnedBotIds: [],
    }));
    this.lastTrigger = 'initial';
    this.lastGroupId = null;
    this.events = [];
  }

  record(type, payload = {}) {
    const event = { type, ...payload };
    this.events.push(event);
    if (this.events.length > 24) this.events.shift();
    return event;
  }

  recordById(groupId) {
    return this.records.find((record) => record.group.id === groupId) ?? null;
  }

  claimInitialGroups(limit = this.initialBudget, { playerPosition = null } = {}) {
    const budget = Math.max(1, limit | 0);
    const dormant = this.records.filter((record) => record.state === EncounterGroupState.Dormant);
    const watcher = dormant.find((record) => record.group.archetype === 'watcher');
    const ordered = watcher ? [watcher, ...dormant.filter((record) => record !== watcher)] : dormant;
    const selected = [];
    let count = 0;
    for (const record of ordered) {
      const group = record.group;
      const groupCount = Math.max(1, group.count | 0);
      const tooClose = playerPosition && distanceBetween(group.position, playerPosition) < 10;
      if (tooClose && group.archetype !== 'watcher') continue;
      if (selected.length && count + groupCount > budget) continue;
      record.state = EncounterGroupState.Initial;
      selected.push(group);
      count += groupCount;
      if (count >= budget) break;
    }
    return selected;
  }

  markSpawned(groupId, botIds = []) {
    const record = this.recordById(groupId);
    if (!record) return false;
    record.state = EncounterGroupState.Spawned;
    record.spawnedBotIds = [...botIds];
    this.lastGroupId = groupId;
    return true;
  }

  markFailed(groupId, reason = 'spawn-failed') {
    const record = this.recordById(groupId);
    if (!record) return false;
    record.state = EncounterGroupState.Dormant;
    this.cooldown = Math.max(this.cooldown, 2);
    this.record('encounter-failed', { groupId, reason });
    return true;
  }

  activeGroups() {
    return this.records
      .filter((record) =>
        [EncounterGroupState.Initial, EncounterGroupState.Pending, EncounterGroupState.Spawned].includes(
          record.state,
        ),
      )
      .map((record) => record.group);
  }

  dormantGroups() {
    return this.records
      .filter(
        (record) => record.state === EncounterGroupState.Dormant && record.group.archetype !== 'watcher',
      )
      .map((record) => record.group);
  }

  candidateGroups({ playerPosition = null, playerNodeId = null } = {}) {
    return this.dormantGroups()
      .filter((group) => distanceBetween(group.position, playerPosition) >= this.minSpawnDistance)
      .filter((group) => !playerNodeId || group.nodeId !== playerNodeId)
      .filter(
        (group) =>
          !this.planner || Boolean(this.planner.plan(playerNodeId ?? this.graph.startNodeId, group.nodeId)),
      )
      .map((group) => ({
        id: group.id,
        groupId: group.id,
        group,
        nodeId: group.nodeId,
        position: { ...group.position },
        visible: false,
      }));
  }

  triggerFor({ threat = 0, anomaly = 0, noise = null, state = null } = {}) {
    if (state === 'Extracting') return isDangerousNoise(noise) ? 'extraction-noise' : null;
    if (isDangerousNoise(noise)) return 'noise';
    if (anomaly >= 58) return 'anomaly-threshold';
    if (threat >= 35) return 'threat-threshold';
    return null;
  }

  update(seconds, context = {}) {
    const dt = Math.max(0, Number(seconds) || 0);
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.elapsed < this.activationDelay || this.cooldown > 0) return null;
    if (!this.dormantGroups().length) return null;

    const trigger = this.triggerFor(context);
    if (!trigger) return null;
    const candidates = this.candidateGroups(context);
    if (!candidates.length) return null;
    const request = this.threatDirector?.requestEncounter({ candidates }) ?? this.random.pick(candidates);
    if (!request) return null;
    const record = this.recordById(request.groupId ?? request.id);
    if (!record || record.state !== EncounterGroupState.Dormant) return null;
    record.state = EncounterGroupState.Pending;
    record.attempts += 1;
    this.cooldown = this.baseCooldown;
    this.lastTrigger = trigger;
    this.lastGroupId = record.group.id;
    return this.record('encounter-requested', {
      encounter: request.encounter ?? record.attempts,
      trigger,
      groupId: record.group.id,
      group: record.group,
      nodeId: record.group.nodeId,
      position: { ...record.group.position },
      archetype: record.group.archetype,
      count: record.group.count,
    });
  }

  snapshot() {
    return {
      elapsed: this.elapsed,
      cooldown: this.cooldown,
      activationDelay: this.activationDelay,
      lastTrigger: this.lastTrigger,
      lastGroupId: this.lastGroupId,
      groups: this.records.map((record) => ({
        id: record.group.id,
        nodeId: record.group.nodeId,
        archetype: record.group.archetype,
        count: record.group.count,
        state: record.state,
        attempts: record.attempts,
        spawnedBotIds: [...record.spawnedBotIds],
      })),
      recentEvents: [...this.events],
    };
  }
}
