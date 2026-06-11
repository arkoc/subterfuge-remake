/**
 * @subterfuge/server — authoritative game server.
 *
 * Owns the tick loop, the database, and the WebSocket fan-out. Imports
 * @subterfuge/sim for all game logic. Phase 0 is just a placeholder.
 */

import { SIM_VERSION } from '@subterfuge/sim';

export const SERVER_VERSION = '0.0.0';

export function describe(): string {
  return `subterfuge-server@${SERVER_VERSION} (sim@${SIM_VERSION})`;
}
