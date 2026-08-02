import { describe, expect, it, vi } from 'vitest';
import { applyEnemyDamage, damagePlayer, reloadMagazine, advanceGameTime } from '../src/core/gameplay.js';

const state = (overrides = {}) => ({
  health: 100,
  maxHealth: 100,
  alive: true,
  kills: 0,
  ammo: 7,
  reserve: 40,
  magSize: 30,
  reloading: false,
  paused: false,
  ...overrides,
});

describe('player health and combat state', () => {
  it('reduces 100 HP to 90 and emits one event', () => {
    const emit = vi.fn();
    const current = state();
    damagePlayer(current, 10, emit, { type: 'enemy' });
    expect(current.health).toBe(90);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ amount: 10, health: 90, killed: false });
  });

  it('enters dead state at zero HP and ignores later damage', () => {
    const emit = vi.fn();
    const current = state();
    expect(damagePlayer(current, 100, emit).killed).toBe(true);
    expect(current).toMatchObject({ health: 0, alive: false });
    expect(damagePlayer(current, 10, emit).applied).toBe(0);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('counts one kill on the live to dead transition only', () => {
    const current = state();
    const enemy = { alive: true, health: 22 };
    const emit = vi.fn();
    expect(applyEnemyDamage(current, enemy, 22, emit).killed).toBe(true);
    expect(current.kills).toBe(1);
    expect(applyEnemyDamage(current, enemy, 22, emit).killed).toBe(false);
    expect(current.kills).toBe(1);
  });

  it('moves the correct number of rounds from reserve during reload', () => {
    const current = state({ ammo: 7, reserve: 40 });
    expect(reloadMagazine(current)).toBe(23);
    expect(current).toMatchObject({ ammo: 30, reserve: 17 });
  });

  it('does not advance gameplay time while paused', () => {
    const current = state({ paused: true, time: 4 });
    expect(advanceGameTime(current, 1)).toBe(4);
    current.paused = false;
    expect(advanceGameTime(current, 1)).toBe(5);
  });
});
