import { describe as vitestDescribe, expect, it } from 'vitest';
import { CLIENT_VERSION, describe } from '../src/index.js';

vitestDescribe('@subterfuge/client', () => {
  it('exports a version string', () => {
    expect(CLIENT_VERSION).toBe('0.0.0');
  });

  it('describes itself with its sim dependency', () => {
    // Sim version bumps on every replay-visible change — don't pin it.
    expect(describe()).toMatch(/subterfuge-client@0\.0\.0 \(sim@\d+\.\d+\.\d+\)/);
  });
});
