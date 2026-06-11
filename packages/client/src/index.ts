/**
 * @subterfuge/client — web client.
 *
 * Renders the world, projects the future via the shared sim, and talks
 * to the server over WebSocket. Phase 0 is just a placeholder; the
 * Vite + React + PixiJS scaffold lands in Phase 5.
 */

import { SIM_VERSION } from '@subterfuge/sim';

export const CLIENT_VERSION = '0.0.0';

export function describe(): string {
  return `subterfuge-client@${CLIENT_VERSION} (sim@${SIM_VERSION})`;
}
