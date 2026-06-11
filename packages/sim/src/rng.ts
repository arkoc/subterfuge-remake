/**
 * Seeded deterministic pseudo-random generator (mulberry32).
 *
 * This is the *only* permitted source of randomness inside the sim. The
 * ESLint config forbids `Math.random()` in `packages/sim/**` to keep the
 * simulation reproducible: same seed → same sequence on every machine,
 * which is the property the Time Machine relies on.
 *
 * mulberry32 is a 32-bit hash-style PRNG: tiny, fast, and statistically
 * adequate for game purposes (it is not cryptographically secure — do
 * not use it for anything security-sensitive).
 */
export interface Rng {
  /** Next float in `[0, 1)`. */
  next(): number;
  /** Next integer in `[0, maxExclusive)`. */
  nextInt(maxExclusive: number): number;
  /** Next integer in `[min, maxExclusive)`. */
  range(min: number, maxExclusive: number): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const nextFloat = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next: nextFloat,
    nextInt: (maxExclusive: number): number => Math.floor(nextFloat() * maxExclusive),
    range: (min: number, maxExclusive: number): number =>
      min + Math.floor(nextFloat() * (maxExclusive - min)),
  };
}
