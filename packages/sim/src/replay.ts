import type {
  DeferableCommand,
  OutpostId,
  PendingCommandId,
  PlayerId,
  QueuedOrderId,
  SpecialistId,
  SpecialistKind,
  SubId,
  World,
} from './types.js';
import { generateWorld } from './world-gen.js';
import { tick } from './tick.js';
import {
  cancelSub,
  editPreLaunchSub,
  issueLaunchOrder,
  redirectSub,
} from './orders.js';
import { issueDrillOrder } from './mining.js';
import {
  cancelQueuedOrder,
  queueDrill,
  queueHire,
  queueLaunch,
  queuePirateTarget,
  queuePromote,
  queueRedirect,
} from './queued-orders.js';
import { executeHire, executePromote } from './hiring.js';
import { targetSub } from './pirate.js';
import { appendMessage } from './diplomacy.js';
import { defer, cancelPending, finalizePending } from './pending-commands.js';
import { executeReleaseCaptive } from './captives.js';

/**
 * Replay layer (Phase 7a).
 *
 * The sim is fully deterministic, so the minimal authoritative record
 * of a game is **just the seed plus the ordered log of external
 * inputs** (player actions). Everything the world contains at any
 * moment — combat outcomes, factory cycles, sub positions, Neptunium,
 * specialist captures — is derivable by replaying the log against the
 * generated world.
 *
 * This module defines the `GameEvent` shape and two pure functions:
 *
 *   - `applyEvent(world, e)` — re-dispatch a recorded event into a
 *     live world; the caller has already advanced `world.time` to
 *     `e.simAt` via `tick`.
 *   - `replayFrom({ seed, playerCount, events, targetTime,
 *                   baseSnapshot? })` — produce the world at any
 *     `targetTime`, optionally starting from a checkpoint.
 *
 * Snapshots are pure caching; this module knows nothing about them.
 */

// ---------------------------------------------------------------------
// Event shape
// ---------------------------------------------------------------------

export type GameEvent =
  | {
      simAt: number;
      kind: 'launch';
      ownerId: PlayerId;
      sourceId: OutpostId;
      destinationId: OutpostId;
      drillers: number;
      giftTo?: PlayerId;
      specialistIds?: SpecialistId[];
    }
  | {
      simAt: number;
      kind: 'drill';
      ownerId: PlayerId;
      outpostId: OutpostId;
    }
  | {
      simAt: number;
      kind: 'queue-launch';
      ownerId: PlayerId;
      sourceId: OutpostId;
      destinationId: OutpostId;
      drillers: number;
      executeAt: number;
      giftTo?: PlayerId;
      specialistIds?: SpecialistId[];
      pirateTargetSubId?: SubId;
    }
  | {
      simAt: number;
      kind: 'queue-drill';
      ownerId: PlayerId;
      outpostId: OutpostId;
      executeAt: number;
    }
  | {
      simAt: number;
      kind: 'queue-hire';
      ownerId: PlayerId;
      specialistKind: SpecialistKind;
      executeAt: number;
    }
  | {
      simAt: number;
      kind: 'queue-promote';
      ownerId: PlayerId;
      specialistId: SpecialistId;
      executeAt: number;
    }
  | {
      simAt: number;
      kind: 'queue-redirect';
      ownerId: PlayerId;
      subId: SubId;
      newDestinationId: OutpostId;
      executeAt: number;
    }
  | {
      simAt: number;
      kind: 'queue-pirate-target';
      ownerId: PlayerId;
      subId: SubId;
      targetSubId: SubId;
      executeAt: number;
    }
  | {
      simAt: number;
      kind: 'cancel-queued';
      ownerId: PlayerId;
      orderId: QueuedOrderId;
    }
  | {
      simAt: number;
      kind: 'hire';
      ownerId: PlayerId;
      specialistKind: SpecialistKind;
    }
  | {
      simAt: number;
      kind: 'promote';
      ownerId: PlayerId;
      specialistId: SpecialistId;
    }
  | {
      simAt: number;
      kind: 'redirect';
      ownerId: PlayerId;
      subId: SubId;
      newDestinationId: OutpostId;
    }
  | {
      simAt: number;
      kind: 'cancel-sub';
      ownerId: PlayerId;
      subId: SubId;
    }
  | {
      simAt: number;
      kind: 'edit-prelaunch-sub';
      ownerId: PlayerId;
      subId: SubId;
      drillers: number;
      specialistIds?: SpecialistId[];
    }
  | {
      simAt: number;
      kind: 'pirate-target';
      ownerId: PlayerId;
      subId: SubId;
      targetSubId: SubId;
    }
  | {
      simAt: number;
      kind: 'chat';
      from: PlayerId;
      to: PlayerId | null;
      text: string;
    }
  | {
      simAt: number;
      kind: 'defer';
      /** Inner deferable command. Recorded as it was issued; the sim
       *  schedules its execution at simAt + PENDING_DELAY_MS. */
      command: DeferableCommand;
    }
  | {
      simAt: number;
      kind: 'cancel-pending';
      ownerId: PlayerId;
      pendingId: PendingCommandId;
    }
  | {
      simAt: number;
      kind: 'finalize-pending';
      ownerId: PlayerId;
      pendingId: PendingCommandId;
    }
  | {
      simAt: number;
      kind: 'release-captive';
      ownerId: PlayerId;
      specialistId: SpecialistId;
    };

export type GameEventKind = GameEvent['kind'];

// ---------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------

/**
 * Apply a recorded event to a live world. Caller is responsible for
 * having ticked world.time up to `event.simAt` first.
 *
 * Returns a string describing why the event was a no-op, or null on
 * success. We don't throw on application failure because real games
 * can legitimately have invalid events at replay time (e.g. a queued
 * launch whose source was captured) — the spec says "the player is
 * notified" and the order is dropped.
 */
export function applyEvent(world: World, event: GameEvent): string | null {
  try {
    switch (event.kind) {
      case 'launch': {
        const opts: Parameters<typeof issueLaunchOrder>[1] = {
          ownerId: event.ownerId,
          sourceId: event.sourceId,
          destinationId: event.destinationId,
          drillers: event.drillers,
        };
        if (event.giftTo !== undefined) {
          (opts as { giftTo: PlayerId }).giftTo = event.giftTo;
        }
        if (event.specialistIds !== undefined) {
          (opts as { specialistIds: readonly SpecialistId[] }).specialistIds =
            event.specialistIds;
        }
        issueLaunchOrder(world, opts);
        return null;
      }
      case 'drill': {
        issueDrillOrder(world, {
          ownerId: event.ownerId,
          outpostId: event.outpostId,
        });
        return null;
      }
      case 'queue-launch': {
        queueLaunch(world, {
          ownerId: event.ownerId,
          sourceId: event.sourceId,
          destinationId: event.destinationId,
          drillers: event.drillers,
          executeAt: event.executeAt,
          ...(event.giftTo !== undefined ? { giftTo: event.giftTo } : {}),
          ...(event.specialistIds !== undefined
            ? { specialistIds: event.specialistIds }
            : {}),
          ...(event.pirateTargetSubId !== undefined
            ? { pirateTargetSubId: event.pirateTargetSubId }
            : {}),
        });
        return null;
      }
      case 'queue-drill': {
        queueDrill(world, {
          ownerId: event.ownerId,
          outpostId: event.outpostId,
          executeAt: event.executeAt,
        });
        return null;
      }
      case 'queue-hire': {
        queueHire(world, {
          ownerId: event.ownerId,
          specialistKind: event.specialistKind,
          executeAt: event.executeAt,
        });
        return null;
      }
      case 'queue-promote': {
        queuePromote(world, {
          ownerId: event.ownerId,
          specialistId: event.specialistId,
          executeAt: event.executeAt,
        });
        return null;
      }
      case 'queue-redirect': {
        queueRedirect(world, {
          ownerId: event.ownerId,
          subId: event.subId,
          newDestinationId: event.newDestinationId,
          executeAt: event.executeAt,
        });
        return null;
      }
      case 'queue-pirate-target': {
        queuePirateTarget(world, {
          ownerId: event.ownerId,
          subId: event.subId,
          targetSubId: event.targetSubId,
          executeAt: event.executeAt,
        });
        return null;
      }
      case 'cancel-queued': {
        cancelQueuedOrder(world, event.orderId, event.ownerId);
        return null;
      }
      case 'hire': {
        executeHire(world, {
          ownerId: event.ownerId,
          kind: event.specialistKind,
        });
        return null;
      }
      case 'promote': {
        executePromote(world, {
          ownerId: event.ownerId,
          specialistId: event.specialistId as unknown as number,
        });
        return null;
      }
      case 'redirect': {
        redirectSub(world, {
          ownerId: event.ownerId,
          subId: event.subId,
          newDestinationId: event.newDestinationId,
        });
        return null;
      }
      case 'cancel-sub': {
        cancelSub(world, {
          ownerId: event.ownerId,
          subId: event.subId,
        });
        return null;
      }
      case 'edit-prelaunch-sub': {
        editPreLaunchSub(world, {
          ownerId: event.ownerId,
          subId: event.subId,
          drillers: event.drillers,
          ...(event.specialistIds !== undefined
            ? { specialistIds: event.specialistIds }
            : {}),
        });
        return null;
      }
      case 'pirate-target': {
        targetSub(world, {
          ownerId: event.ownerId,
          subId: event.subId as unknown as number,
          targetSubId: event.targetSubId as unknown as number,
        });
        return null;
      }
      case 'chat': {
        appendMessage(world, {
          from: event.from,
          to: event.to,
          text: event.text,
        });
        return null;
      }
      case 'defer': {
        defer(world, { issuedAt: event.simAt, command: event.command });
        return null;
      }
      case 'cancel-pending': {
        const ok = cancelPending(world, event.pendingId, event.ownerId);
        return ok ? null : 'pending command not found or not owned by caller';
      }
      case 'finalize-pending': {
        const r = finalizePending(world, event.pendingId, event.ownerId);
        return r.ok ? null : (r.reason ?? 'finalize failed');
      }
      // Removed event kinds from older sim versions (e.g. the deleted
      // funding mechanic's 'fund-start'/'fund-stop') can still appear
      // in legacy logs replayed best-effort during an epoch-promotion
      // boot. Drop them with a reason instead of crashing — the world
      // they produce becomes the new authoritative baseline anyway.
      default:
        return `unknown or removed event kind: ${(event as { kind: string }).kind}`;
      case 'release-captive': {
        executeReleaseCaptive(world, {
          ownerId: event.ownerId,
          specialistId: event.specialistId as unknown as number,
        });
        return null;
      }
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ---------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------

export interface ReplayInput {
  /** World seed (required when starting from t=0). Ignored if `baseSnapshot` is provided. */
  readonly seed?: number;
  /** Player count (required when starting from t=0). Ignored if `baseSnapshot` is provided. */
  readonly playerCount?: number;
  /** Events in `simAt` ascending order (and, for ties, `id` ascending). */
  readonly events: readonly GameEvent[];
  /**
   * Replay up to this sim time (inclusive of any events at this exact
   * timestamp). Cannot be earlier than `baseSnapshot.time` if
   * provided, or `events[0]?.simAt` if not.
   */
  readonly targetTime: number;
  /**
   * Optional cached snapshot to start from. When present, the caller
   * must pass only events NOT already applied to the snapshot —
   * select them by id watermark (`lastEventId`), not by sim time:
   * events can share the snapshot's exact sim time without being in
   * it. The snapshot is deep-cloned to avoid mutating the caller's
   * reference.
   */
  readonly baseSnapshot?: World;
}

declare const structuredClone: <T>(value: T) => T;

/**
 * Recreate the world at `targetTime` by replaying events from the
 * given starting point. Pure function — does not touch the caller's
 * inputs.
 *
 * Failed events are silently dropped (per `applyEvent`); their
 * absence affects subsequent state, but that's how the live sim
 * already behaves for invalid queued orders. If you need a list of
 * drops, use `replayWithReport`.
 */
export function replayFrom(input: ReplayInput): World {
  const { events, targetTime, baseSnapshot } = input;
  let world: World;
  if (baseSnapshot !== undefined) {
    world = structuredClone(baseSnapshot);
  } else {
    if (input.seed === undefined || input.playerCount === undefined) {
      throw new Error(
        'replayFrom requires { seed, playerCount } when no baseSnapshot is provided',
      );
    }
    world = generateWorld({ seed: input.seed, playerCount: input.playerCount });
  }
  if (targetTime < world.time) {
    throw new Error(
      `targetTime (${targetTime}) is earlier than baseline (${world.time})`,
    );
  }
  for (const e of events) {
    // Events stamped *exactly* at the snapshot time are NOT in the
    // snapshot (the live server writes the snapshot first, then keeps
    // accepting orders at the same sim time until the next tick) —
    // they must be applied. Callers select events by id watermark
    // (`lastEventId`), so anything strictly older is a data error we
    // skip defensively.
    if (e.simAt < world.time && baseSnapshot !== undefined) continue;
    if (e.simAt > targetTime) break;
    if (e.simAt > world.time) tick(world, e.simAt - world.time);
    applyEvent(world, e);
  }
  if (targetTime > world.time) tick(world, targetTime - world.time);
  return world;
}

/** Same as `replayFrom` but also returns per-event drop reasons. */
export function replayWithReport(input: ReplayInput): {
  world: World;
  drops: { event: GameEvent; reason: string }[];
} {
  const { events, targetTime, baseSnapshot } = input;
  let world: World;
  if (baseSnapshot !== undefined) {
    world = structuredClone(baseSnapshot);
  } else {
    if (input.seed === undefined || input.playerCount === undefined) {
      throw new Error(
        'replayWithReport requires { seed, playerCount } when no baseSnapshot is provided',
      );
    }
    world = generateWorld({ seed: input.seed, playerCount: input.playerCount });
  }
  const drops: { event: GameEvent; reason: string }[] = [];
  for (const e of events) {
    if (e.simAt < world.time && baseSnapshot !== undefined) continue; // see replayFrom
    if (e.simAt > targetTime) break;
    if (e.simAt > world.time) tick(world, e.simAt - world.time);
    const reason = applyEvent(world, e);
    if (reason !== null) drops.push({ event: e, reason });
  }
  if (targetTime > world.time) tick(world, targetTime - world.time);
  return { world, drops };
}
