import type {
  DeferableCommand,
  PendingCommand,
  PendingCommandId,
  PlayerId,
  World,
} from './types.js';
import { PENDING_DELAY_MS } from './types.js';
import { issueDrillOrder } from './mining.js';
import { executeHire, executePromote } from './hiring.js';
import { redirectSub } from './orders.js';
import { targetSub } from './pirate.js';
import { executeReleaseCaptive } from './captives.js';

/**
 * Pending-command helpers. The player issues a "cancellable" command
 * (drill, hire, promote, redirect, pirate-target, chat) via the UI;
 * the server defers it for 10 minutes (PENDING_DELAY_MS). During the
 * window the owner may cancel. The tick loop fires due commands via
 * `dispatchPending`.
 *
 * Sub launches are NOT deferable here — they're handled at the sub
 * level via `sub.launchAt`. Funding start/stop is NOT deferable per
 * the rulebook (immediate, auto-stops when the gap closes).
 */

export interface DeferInput {
  /** Sim time the player issued the command. */
  readonly issuedAt: number;
  readonly command: DeferableCommand;
}

/** Create a new PendingCommand from a deferable input. */
export function defer(world: World, input: DeferInput): PendingCommandId {
  const id = world.nextPendingCommandId as PendingCommandId;
  world.nextPendingCommandId += 1;
  const pc: PendingCommand = {
    id,
    issuedAt: input.issuedAt,
    executeAt: input.issuedAt + PENDING_DELAY_MS,
    ownerId: input.command.ownerId,
    command: input.command,
  };
  world.pendingCommands.push(pc);
  return id;
}

/**
 * Cancel a pending command. Only the issuing owner may cancel.
 * Returns true if removed, false if not found.
 */
export function cancelPending(
  world: World,
  id: PendingCommandId,
  ownerId: PlayerId,
): boolean {
  const idx = world.pendingCommands.findIndex(
    (p) => (p.id as unknown as number) === (id as unknown as number),
  );
  if (idx < 0) return false;
  const pc = world.pendingCommands[idx]!;
  if (pc.ownerId !== ownerId) return false;
  world.pendingCommands.splice(idx, 1);
  return true;
}

/**
 * Finalise a pending command immediately, bypassing the 10-minute
 * fuse. Only the issuing owner may finalise. The inner deferable is
 * dispatched through `applyDeferable`, so any execution-time
 * validation (e.g. hire requires the Queen at a friendly outpost)
 * runs now instead of at `executeAt`.
 *
 * Returns `{ ok: true }` on success and removes the pending entry.
 * On validation failure the pending entry is preserved so the
 * player can fix the issue and try again (or wait out the fuse).
 */
export function finalizePending(
  world: World,
  id: PendingCommandId,
  ownerId: PlayerId,
): { ok: boolean; reason?: string } {
  const idx = world.pendingCommands.findIndex(
    (p) => (p.id as unknown as number) === (id as unknown as number),
  );
  if (idx < 0) return { ok: false, reason: 'pending command not found' };
  const pc = world.pendingCommands[idx]!;
  if (pc.ownerId !== ownerId) {
    return { ok: false, reason: 'not the owner of this pending command' };
  }
  try {
    applyDeferable(world, pc.command);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  world.pendingCommands.splice(idx, 1);
  return { ok: true };
}

/**
 * Pick the next PendingCommand whose `executeAt` is on or before
 * `deadline`. Ties broken by id ascending for determinism.
 */
export function earliestDuePending(
  world: World,
  deadline: number,
): PendingCommand | null {
  let best: PendingCommand | null = null;
  for (const p of world.pendingCommands) {
    if (p.executeAt > deadline) continue;
    if (best === null || p.executeAt < best.executeAt) {
      best = p;
    } else if (p.executeAt === best.executeAt && p.id < best.id) {
      best = p;
    }
  }
  return best;
}

/**
 * Apply a pending command's inner payload, then remove it from the
 * pending list. If the command throws (e.g. drill source captured
 * during the window) we silently drop — the doc story is "the player
 * is notified", which a future event hook can surface.
 */
export function dispatchPending(
  world: World,
  pc: PendingCommand,
): { ok: boolean; reason?: string } {
  // Remove regardless of outcome.
  const idx = world.pendingCommands.indexOf(pc);
  if (idx >= 0) world.pendingCommands.splice(idx, 1);
  try {
    applyDeferable(world, pc.command);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Dispatch any deferable command directly (used by replay's
 * `defer` event for the first apply, and by dispatchPending when a
 * pending fires). Throws on validation failure.
 */
export function applyDeferable(world: World, c: DeferableCommand): void {
  switch (c.kind) {
    case 'drill':
      issueDrillOrder(world, { ownerId: c.ownerId, outpostId: c.outpostId });
      return;
    case 'hire':
      executeHire(world, { ownerId: c.ownerId, kind: c.specialistKind });
      return;
    case 'promote':
      executePromote(world, {
        ownerId: c.ownerId,
        specialistId: c.specialistId as unknown as number,
      });
      return;
    case 'redirect':
      redirectSub(world, {
        ownerId: c.ownerId,
        subId: c.subId,
        newDestinationId: c.newDestinationId,
      });
      return;
    case 'pirate-target':
      targetSub(world, {
        ownerId: c.ownerId,
        subId: c.subId as unknown as number,
        targetSubId: c.targetSubId as unknown as number,
      });
      return;
    case 'release-captive':
      executeReleaseCaptive(world, {
        ownerId: c.ownerId,
        specialistId: c.specialistId as unknown as number,
      });
      return;
  }
}
