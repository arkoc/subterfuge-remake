import { describe, expect, it } from 'vitest';
import { SIM_VERSION } from '../src/index.js';

describe('@subterfuge/sim', () => {
  it('exports a version string', () => {
    // Don't pin the exact version — it bumps on every replay-visible
    // sim change. Just assert the shape the server's version-gating
    // relies on.
    expect(SIM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
