import { describe as vitestDescribe, expect, it } from 'vitest';
import { describe, SERVER_VERSION } from '../src/index.js';

vitestDescribe('@subterfuge/server', () => {
  it('exports a version string', () => {
    expect(SERVER_VERSION).toBe('0.0.0');
  });

  it('describes itself with its sim dependency', () => {
    // Sim version bumps on every replay-visible change — don't pin it.
    expect(describe()).toMatch(/subterfuge-server@0\.0\.0 \(sim@\d+\.\d+\.\d+\)/);
  });
});
