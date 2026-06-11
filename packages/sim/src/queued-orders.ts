import type {
  OutpostId,
  PlayerId,
  QueuedDrillOrder,
  QueuedHireOrder,
  QueuedLaunchOrder,
  QueuedOrder,
  QueuedOrderId,
  QueuedPirateTargetOrder,
  QueuedPromoteOrder,
  QueuedRedirectOrder,
  SpecialistId,
  SpecialistKind,
  SubId,
  World,
} from './types.js';
import { issueDrillOrder } from './mining.js';
import { issueLaunchOrder, redirectSub } from './orders.js';
import { executeHire, executePromote } from './hiring.js';
import { targetSub } from './pirate.js';

/**
 * Time-Machine queue helpers. Enqueue, cancel, list. Dispatch is done
 * inside the tick loop (`tick.ts`) so that queued orders interleave
 * deterministically with factory cycles and sub arrivals.
 */

export interface QueueLaunchInput {
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly sourceId: OutpostId;
  readonly destinationId: OutpostId;
  readonly drillers: number;
  readonly giftTo?: PlayerId;
  /**
   * Optional specialists to load at dispatch time. Each must validate
   * against `issueLaunchOrder`'s rules when the queue fires
   * (active, owned, physically at source); otherwise the order drops.
   * Lets the player queue a launch that depends on an in-flight
   * specialist arriving at the source first.
   */
  readonly specialistIds?: readonly SpecialistId[];
  /** Enemy sub to Pirate-chase the instant this launch fires. */
  readonly pirateTargetSubId?: SubId;
}

export interface QueueDrillInput {
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly outpostId: OutpostId;
}

export function queueLaunch(world: World, order: QueueLaunchInput): QueuedOrderId {
  if (!Number.isFinite(order.executeAt) || order.executeAt <= world.time) {
    throw new Error(`executeAt must be in the future (> ${world.time})`);
  }
  if (!Number.isInteger(order.drillers) || order.drillers < 0) {
    throw new Error(`drillers must be a non-negative integer`);
  }
  const queuedSpecialists = order.specialistIds?.length ?? 0;
  if (order.drillers === 0 && queuedSpecialists === 0) {
    throw new Error(`sub must carry drillers or at least one specialist`);
  }
  if (order.sourceId === order.destinationId) {
    throw new Error(`source and destination must differ`);
  }
  const id = world.nextQueuedOrderId as QueuedOrderId;
  world.nextQueuedOrderId += 1;
  const q: QueuedLaunchOrder = {
    kind: 'launch',
    id,
    executeAt: order.executeAt,
    ownerId: order.ownerId,
    sourceId: order.sourceId,
    destinationId: order.destinationId,
    drillers: order.drillers,
    ...(order.giftTo !== undefined ? { giftTo: order.giftTo } : {}),
    ...(order.specialistIds !== undefined && order.specialistIds.length > 0
      ? { specialistIds: order.specialistIds }
      : {}),
    ...(order.pirateTargetSubId !== undefined
      ? { pirateTargetSubId: order.pirateTargetSubId }
      : {}),
  };
  world.queuedOrders.push(q);
  return id;
}

export interface QueueHireInput {
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly specialistKind: SpecialistKind;
}

export interface QueuePromoteInput {
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly specialistId: SpecialistId;
}

export function queueHire(world: World, order: QueueHireInput): QueuedOrderId {
  if (!Number.isFinite(order.executeAt) || order.executeAt <= world.time) {
    throw new Error(`executeAt must be in the future (> ${world.time})`);
  }
  const id = world.nextQueuedOrderId as QueuedOrderId;
  world.nextQueuedOrderId += 1;
  const q: QueuedHireOrder = {
    kind: 'hire',
    id,
    executeAt: order.executeAt,
    ownerId: order.ownerId,
    specialistKind: order.specialistKind,
  };
  world.queuedOrders.push(q);
  return id;
}

export function queuePromote(world: World, order: QueuePromoteInput): QueuedOrderId {
  if (!Number.isFinite(order.executeAt) || order.executeAt <= world.time) {
    throw new Error(`executeAt must be in the future (> ${world.time})`);
  }
  const id = world.nextQueuedOrderId as QueuedOrderId;
  world.nextQueuedOrderId += 1;
  const q: QueuedPromoteOrder = {
    kind: 'promote',
    id,
    executeAt: order.executeAt,
    ownerId: order.ownerId,
    specialistId: order.specialistId,
  };
  world.queuedOrders.push(q);
  return id;
}

export function queueDrill(world: World, order: QueueDrillInput): QueuedOrderId {
  if (!Number.isFinite(order.executeAt) || order.executeAt <= world.time) {
    throw new Error(`executeAt must be in the future (> ${world.time})`);
  }
  const id = world.nextQueuedOrderId as QueuedOrderId;
  world.nextQueuedOrderId += 1;
  const q: QueuedDrillOrder = {
    kind: 'drill',
    id,
    executeAt: order.executeAt,
    ownerId: order.ownerId,
    outpostId: order.outpostId,
  };
  world.queuedOrders.push(q);
  return id;
}

export interface QueueRedirectInput {
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly subId: SubId;
  readonly newDestinationId: OutpostId;
}

export interface QueuePirateTargetInput {
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly subId: SubId;
  readonly targetSubId: SubId;
}

export function queueRedirect(world: World, order: QueueRedirectInput): QueuedOrderId {
  if (!Number.isFinite(order.executeAt) || order.executeAt <= world.time) {
    throw new Error(`executeAt must be in the future (> ${world.time})`);
  }
  const id = world.nextQueuedOrderId as QueuedOrderId;
  world.nextQueuedOrderId += 1;
  const q: QueuedRedirectOrder = {
    kind: 'redirect',
    id,
    executeAt: order.executeAt,
    ownerId: order.ownerId,
    subId: order.subId,
    newDestinationId: order.newDestinationId,
  };
  world.queuedOrders.push(q);
  return id;
}

export function queuePirateTarget(
  world: World,
  order: QueuePirateTargetInput,
): QueuedOrderId {
  if (!Number.isFinite(order.executeAt) || order.executeAt <= world.time) {
    throw new Error(`executeAt must be in the future (> ${world.time})`);
  }
  const id = world.nextQueuedOrderId as QueuedOrderId;
  world.nextQueuedOrderId += 1;
  const q: QueuedPirateTargetOrder = {
    kind: 'pirate-target',
    id,
    executeAt: order.executeAt,
    ownerId: order.ownerId,
    subId: order.subId,
    targetSubId: order.targetSubId,
  };
  world.queuedOrders.push(q);
  return id;
}

/**
 * Cancel a queued order. `ownerId` must match the order's owner —
 * a player can only cancel their own Time-Machine orders. Returns
 * false (no mutation) when the order doesn't exist or isn't theirs.
 */
export function cancelQueuedOrder(
  world: World,
  id: QueuedOrderId,
  ownerId: PlayerId,
): boolean {
  const idx = world.queuedOrders.findIndex((q) => q.id === id);
  if (idx < 0) return false;
  if (world.queuedOrders[idx]!.ownerId !== ownerId) return false;
  world.queuedOrders.splice(idx, 1);
  return true;
}

export function earliestDueQueuedOrder(
  world: World,
  deadline: number,
): QueuedOrder | null {
  let earliest: QueuedOrder | null = null;
  for (const q of world.queuedOrders) {
    if (q.executeAt > deadline) continue;
    if (earliest === null || q.executeAt < earliest.executeAt) {
      earliest = q;
    } else if (q.executeAt === earliest.executeAt && q.id < earliest.id) {
      earliest = q;
    }
  }
  return earliest;
}

/**
 * Apply a queued order as if the player issued it at this moment.
 * On validation failure (source captured, drillers insufficient, etc.)
 * the order is silently dropped — the docs say "the player is notified"
 * which would be wired through a side-channel event log later.
 *
 * Returns the resulting sub id (for launch orders) or `null` on
 * drop/non-launch.
 */
export function dispatchQueuedOrder(
  world: World,
  order: QueuedOrder,
): { ok: boolean; reason?: string } {
  try {
    switch (order.kind) {
      case 'launch': {
        const subId = issueLaunchOrder(world, {
          ownerId: order.ownerId,
          sourceId: order.sourceId,
          destinationId: order.destinationId,
          drillers: order.drillers,
          ...(order.giftTo !== undefined ? { giftTo: order.giftTo } : {}),
          ...(order.specialistIds !== undefined
            ? { specialistIds: order.specialistIds }
            : {}),
        });
        // Pirate-launch: bind the chase to the just-created sub. The
        // chase engages now (we clear the launch fuse so the pirate sets
        // off immediately — an intercept can't wait out a 10-min delay).
        // If the target is gone / unreachable at this moment the chase
        // simply doesn't engage and the sub continues as a normal launch.
        if (order.pirateTargetSubId !== undefined) {
          const sub = world.subs.find(
            (s) => (s.id as unknown as number) === (subId as unknown as number),
          );
          if (sub !== undefined) {
            (sub as { launchAt: number }).launchAt = world.time;
            try {
              targetSub(world, {
                ownerId: order.ownerId,
                subId: subId as unknown as number,
                targetSubId: order.pirateTargetSubId as unknown as number,
              });
            } catch {
              // chase couldn't engage — leave the sub as a plain launch.
            }
          }
        }
        break;
      }
      case 'drill':
        issueDrillOrder(world, {
          ownerId: order.ownerId,
          outpostId: order.outpostId,
        });
        break;
      case 'hire':
        executeHire(world, {
          ownerId: order.ownerId,
          kind: order.specialistKind,
        });
        break;
      case 'promote':
        executePromote(world, {
          ownerId: order.ownerId,
          specialistId: order.specialistId as unknown as number,
        });
        break;
      case 'redirect':
        redirectSub(world, {
          ownerId: order.ownerId,
          subId: order.subId,
          newDestinationId: order.newDestinationId,
        });
        break;
      case 'pirate-target':
        targetSub(world, {
          ownerId: order.ownerId,
          subId: order.subId as unknown as number,
          targetSubId: order.targetSubId as unknown as number,
        });
        break;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
