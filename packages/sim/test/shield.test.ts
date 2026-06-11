import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { commitShield, currentShieldCharge } from '../src/shield.js';
import { HOUR_MS, SHIELD_MAX, SHIELD_RECHARGE_TIME_MS } from '../src/types.js';

function withShield(kind: 'weak' | 'strong', charge = 0) {
  const w = generateWorld({ seed: 1, playerCount: 4 });
  const o = w.outposts[0]!;
  o.shieldKind = kind;
  o.shieldCharge = charge;
  o.shieldChargedSince = 0;
  return { w, o };
}

describe('currentShieldCharge', () => {
  it('returns 0 at time 0 for a fresh outpost', () => {
    const { o } = withShield('weak', 0);
    expect(currentShieldCharge(o, 0)).toBe(0);
  });

  it('reaches max after 48h for a weak shield', () => {
    const { o } = withShield('weak', 0);
    expect(currentShieldCharge(o, SHIELD_RECHARGE_TIME_MS)).toBe(SHIELD_MAX.weak);
  });

  it('reaches max after 48h for a strong shield', () => {
    const { o } = withShield('strong', 0);
    expect(currentShieldCharge(o, SHIELD_RECHARGE_TIME_MS)).toBe(SHIELD_MAX.strong);
  });

  it('clamps at max — does not exceed it', () => {
    const { o } = withShield('weak', 0);
    expect(currentShieldCharge(o, 10 * SHIELD_RECHARGE_TIME_MS)).toBe(SHIELD_MAX.weak);
  });

  it('halfway through recharge, charge is roughly half', () => {
    const { o } = withShield('weak', 0);
    const mid = SHIELD_RECHARGE_TIME_MS / 2;
    const c = currentShieldCharge(o, mid);
    // Weak shield: 10 max; halfway = 5.
    expect(c).toBe(5);
  });

  it('respects checkpoint after combat: shield 3, charges from there', () => {
    const { o } = withShield('strong', 3);
    o.shieldChargedSince = 0;
    // Step is 48h/20 = 2.4h. After 12h: gained floor(12/2.4)=5. Total 3+5=8.
    expect(currentShieldCharge(o, 12 * HOUR_MS)).toBe(8);
  });
});

describe('commitShield', () => {
  it('writes the live value into the checkpoint and resets the timer', () => {
    const { o } = withShield('weak', 0);
    commitShield(o, SHIELD_RECHARGE_TIME_MS / 2); // expect ~5
    expect(o.shieldCharge).toBe(5);
    expect(o.shieldChargedSince).toBe(SHIELD_RECHARGE_TIME_MS / 2);
  });
});
