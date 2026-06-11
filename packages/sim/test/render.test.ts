import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { renderWorldAscii, summarizeWorld } from '../src/render.js';

describe('renderWorldAscii', () => {
  it('produces a framed grid of the requested dimensions', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const out = renderWorldAscii(w, 60, 20);
    const lines = out.split('\n');
    // 1 top border + 20 body + 1 bottom border = 22 lines
    expect(lines).toHaveLength(22);
    // Each body line is width + 2 for the | borders
    for (let i = 1; i <= 20; i++) {
      expect(lines[i]).toHaveLength(62);
      expect(lines[i]?.startsWith('|')).toBe(true);
      expect(lines[i]?.endsWith('|')).toBe(true);
    }
  });

  it('contains a letter for each owned player and a dormant marker', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const out = renderWorldAscii(w, 100, 40);
    // Players A,B,C,D should appear (case-insensitive — Queen home is lowercase)
    expect(out.toUpperCase()).toMatch(/A/);
    expect(out.toUpperCase()).toMatch(/B/);
    expect(out.toUpperCase()).toMatch(/C/);
    expect(out.toUpperCase()).toMatch(/D/);
    // Dormant outposts present
    expect(out).toContain('.');
  });

  it('is deterministic — same world renders identically', () => {
    const w1 = generateWorld({ seed: 42, playerCount: 4 });
    const w2 = generateWorld({ seed: 42, playerCount: 4 });
    expect(renderWorldAscii(w1)).toEqual(renderWorldAscii(w2));
  });
});

describe('summarizeWorld', () => {
  it('lists every player by name', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const out = summarizeWorld(w);
    expect(out).toContain('Player 1');
    expect(out).toContain('Player 2');
    expect(out).toContain('Player 3');
    expect(out).toContain('Player 4');
    expect(out).toContain('dormant: 20');
  });

  it('reports the seed', () => {
    const w = generateWorld({ seed: 1234, playerCount: 2 });
    expect(summarizeWorld(w)).toContain('seed=1234');
  });
});
