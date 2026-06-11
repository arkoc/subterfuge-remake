/**
 * @subterfuge/sim — pure TypeScript game simulation.
 *
 * Imported by both the server (authoritative) and the client (Time Machine
 * projection). Must remain free of Node APIs, browser APIs, and any source
 * of non-determinism (Date.now, Math.random). See eslint.config.js.
 */

/**
 * Sim major version. Bump on any change that affects deterministic
 * replay (combat math, hire RNG, world-gen, specialist effects).
 * Servers must refuse to replay event logs whose recorded version
 * mismatches this string (see Phase 7E).
 */
export const SIM_VERSION = '0.13.0';

export * from './types.js';
export * from './rng.js';
export * from './geometry.js';
export * from './world-gen.js';
export * from './render.js';
export * from './production.js';
export * from './tick.js';
export * from './subs.js';
export * from './orders.js';
export * from './queries.js';
export * from './shield.js';
export * from './mining.js';
export * from './combat.js';
export * from './victory.js';
export * from './visibility.js';
export * from './queued-orders.js';
export * from './diplomacy.js';
export * from './preview.js';
export * from './specialists.js';
export * from './hiring.js';
export * from './royalty.js';
export * from './passives.js';
export * from './captives.js';
export * from './pirate.js';
export * from './events.js';
export * from './pending-commands.js';
export * from './replay.js';
