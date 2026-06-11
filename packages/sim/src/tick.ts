import type { Outpost, PlayerId, Sub, World } from './types.js';
import { FACTORY_CYCLE_MS } from './types.js';
import {
  electricalOutput,
  factoryCycleIntervalFor,
  factoryProductionFor,
  totalDrillers,
} from './production.js';
import { arriveSub, subPosition } from './subs.js';
import { dist } from './geometry.js';
import { checkVictory, earliestVictoryCrossing } from './victory.js';
import { mirrorEncounterTime, resolveSubVsSub } from './combat.js';
import { earliestSentryShot, fireSentry } from './passives.js';
import { processCaptiveActions } from './captives.js';
import {
  PIRATE_INTERCEPT_TOLERANCE,
  recomputeChase,
  returnPirateHome,
} from './pirate.js';
import { emitEvent } from './events.js';
import {
  dispatchQueuedOrder,
  earliestDueQueuedOrder,
} from './queued-orders.js';
import {
  dispatchPending,
  earliestDuePending,
} from './pending-commands.js';

/** Emit a player-facing "your X order failed at fire time" event so
 *  silently-dropped deferred commands stop being invisible. */
function emitFailureEvent(
  world: World,
  kind: string,
  ownerId: PlayerId,
  reason: string,
): void {
  emitEvent(
    world,
    'order_failed',
    [ownerId],
    `${kind} order failed — ${reason}`,
  );
}

/**
 * Advance the simulation by `dtMs` milliseconds.
 *
 * Deterministic and pure-ish: the only mutation is to fields on the
 * passed `world`. Given the same input world and `dtMs`, the output
 * world is identical. No randomness, no Date.now, no I/O.
 *
 * SPLIT INVARIANCE (load-bearing): `tick(w, a + b)` must produce the
 * exact same world as `tick(w, a); tick(w, b)` for any split. The
 * event-sourced persistence layer replays the order log through this
 * function with arbitrary time leaps and must reproduce, bit for bit,
 * the world the live server evolved through fixed 500ms ticks. That
 * is why *nothing* in here may act at the tick-call boundary (the old
 * end-of-tick captive/funding/victory sweeps broke this): every state
 * change happens at a sim time derived from world state — an event's
 * scheduled time or an analytically computed threshold crossing —
 * never from `dtMs` itself. The property test in
 * `test/tick-split-invariance.test.ts` enforces this.
 *
 * The loop processes all due events in strict chronological order:
 * factory cycles, sub arrivals, mirror-route encounters, sentry shots,
 * queued Time-Machine orders, pending commands, and Neptunium victory
 * crossings.
 */
export function tick(world: World, dtMs: number): void {
  if (!Number.isFinite(dtMs) || dtMs < 0) {
    throw new Error(`tick(dtMs) must be a non-negative number, got ${dtMs}`);
  }

  // Once the game is won, the world is frozen.
  if (world.winnerId !== null) {
    world.time += dtMs;
    return;
  }

  const newTime = world.time + dtMs;

  // Out-of-band server mutations between tick calls (instant hire,
  // finalize-pending, drill) can create captive-resolution eligibility.
  // Sweep once at the *un-advanced* world.time: world.time only moves
  // inside tick, so this runs at the mutation's own stamp time in both
  // the live server and a replay — cadence-independent. When nothing
  // happened since the last sweep it is a no-op.
  processCaptiveActions(world, world.time);

  // Per-player caps and stockpiles. Both maps are lazy: entries are
  // populated only when `runFactoryCycle` actually consults them, and
  // invalidated (deleted) when an event could have changed them. This
  // is materially cheaper than the old "rebuild for all players after
  // every event" pattern — typically only one player needs updating
  // per event, many events change neither.
  const caps = new Map<PlayerId, number>();
  const stockpiles = new Map<PlayerId, number>();

  // Mirror-encounter cache. The O(M²) helper used to be called once
  // per event; it can only become invalid when a sub is added/
  // removed/redirected, none of which happen on factory cycles,
  // sentry shots, or non-sub-touching pending/queued dispatches.
  // We recompute lazily on demand and clear `mirrorCacheValid` when
  // a sub-mutating event resolves.
  let cachedEncounter: PendingEncounter | null = earliestMirrorEncounter(
    world.subs,
    newTime,
  );
  let mirrorCacheValid = true;

  // Pull the next event in chronological order. Same-time tiebreak is
  // the priority index below: queued orders (player intent) → pending
  // commands → sentry shots → mirror encounters → sub arrivals →
  // factory cycles → victory crossings. A mirror encounter at
  // meet == sub.arrivalAt must fire before the arrival so the
  // still-in-flight sub is consumed by combat rather than landing; a
  // sentry shot at the same instant fires before both so the sub is
  // attrited first. Victory goes last so same-instant events resolve
  // before the freeze (matching the old dispatch-then-check order).
  const QUEUED = 0;
  const PENDING = 1;
  const SENTRY = 2;
  const ENCOUNTER = 3;
  const ARRIVAL = 4;
  const FACTORY = 5;
  const VICTORY = 6;

  while (true) {
    const factory = earliestDueFactory(world.outposts, newTime);
    const sub = earliestSubArrival(world.subs, newTime);
    const queued = earliestDueQueuedOrder(world, newTime);
    const pending = earliestDuePending(world, newTime);
    if (!mirrorCacheValid) {
      cachedEncounter = earliestMirrorEncounter(world.subs, newTime);
      mirrorCacheValid = true;
    }
    const encounter = cachedEncounter;
    const sentry = earliestSentryShot(world, newTime);
    // Victory crossing depends only on current rates + checkpoints, so
    // it is recomputed each iteration like every other candidate.
    const victoryAt = earliestVictoryCrossing(world, newTime);

    // Single min-selection over all candidates. Adding a new event
    // source means adding one line here — the old hand-written chain
    // of pairwise `<=` comparisons dropped a comparison (pending vs
    // sentry) and let the sim clock run backwards.
    let bestTime = Number.POSITIVE_INFINITY;
    let bestKind = -1;
    const consider = (time: number | null | undefined, kind: number): void => {
      if (time === null || time === undefined) return;
      if (time < bestTime) {
        bestTime = time;
        bestKind = kind;
      }
    };
    consider(queued?.executeAt, QUEUED);
    consider(pending?.executeAt, PENDING);
    consider(sentry?.time, SENTRY);
    consider(encounter?.time, ENCOUNTER);
    consider(sub?.arrivalAt, ARRIVAL);
    consider(factory?.nextProductionAt, FACTORY);
    consider(victoryAt, VICTORY);
    if (bestKind === -1) break;

    world.time = bestTime;

    switch (bestKind) {
      case QUEUED: {
        dispatchQueuedOrder(world, queued!);
        const idx = world.queuedOrders.indexOf(queued!);
        world.queuedOrders.splice(idx, 1);
        // A queued order may launch a sub (new sub → invalidate mirror
        // encounters), promote/hire (new specialist → invalidate the
        // owner's cap), or drill (consumes source drillers → invalidate
        // the owner's stockpile). Be conservative and invalidate the
        // owner's caps + stockpile.
        caps.delete(queued!.ownerId);
        stockpiles.delete(queued!.ownerId);
        mirrorCacheValid = false;
        break;
      }
      case PENDING: {
        const owner = pending!.ownerId;
        const r = dispatchPending(world, pending!);
        if (!r.ok) {
          // Surface as a sim event so the player sees why their order
          // didn't take effect. Without this, deferred orders that fail
          // at fire time (target arrived, sub gone, queen moved, etc.)
          // are silently dropped — confusing UX.
          emitFailureEvent(world, pending!.command.kind, owner, r.reason ?? 'unknown');
        }
        // A pending command may be redirect (sub mutation → invalidate
        // mirror) or hire/promote/drill (caps + stockpile may shift).
        caps.delete(owner);
        stockpiles.delete(owner);
        mirrorCacheValid = false;
        break;
      }
      case SENTRY: {
        // Sentry attrition fires before en-route encounters and sub
        // arrivals at the same time, so a sub being chewed down can
        // still be the target of a mirror encounter the same tick.
        // Sub drillers shift, but `totalDrillers` counts only outpost
        // garrison — no caps/stockpiles invalidation needed.
        fireSentry(world, sentry!.sentry, world.time);
        break;
      }
      case ENCOUNTER: {
        const aOwner = encounter!.a.ownerId;
        const bOwner = encounter!.b.ownerId;
        resolveSubVsSub(world, encounter!.a, encounter!.b);
        // Sub-vs-sub combat removes/damages subs; outpost garrison
        // unaffected, so stockpiles don't change. But specialist
        // captives change ownership → caps may shift.
        caps.delete(aOwner);
        caps.delete(bOwner);
        mirrorCacheValid = false;
        break;
      }
      case ARRIVAL: {
        dispatchArrival(world, sub!, caps, stockpiles);
        mirrorCacheValid = false;
        break;
      }
      case FACTORY: {
        runFactoryCycle(factory!, caps, stockpiles, world);
        // Cycle interval is per-player: Tycoons shorten it.
        const interval = factory!.ownerId === null
          ? FACTORY_CYCLE_MS
          : factoryCycleIntervalFor(world, factory!.ownerId);
        factory!.nextProductionAt += interval;
        break;
      }
      case VICTORY: {
        // `neptuniumCrossingTime` is exact, so the crowning is
        // guaranteed here; the throw is a livelock guard in case that
        // invariant is ever broken.
        checkVictory(world, world.time);
        if (world.winnerId === null) {
          throw new Error(
            `victory crossing fired at t=${world.time} but no player crossed`,
          );
        }
        break;
      }
    }

    // Post-event maintenance, at the event's own time. Captive
    // eligibility only changes at events, so this — not a
    // tick-boundary sweep — is the cadence-independent place to
    // resolve it.
    if (processCaptiveActions(world, world.time)) {
      // Releases spawn subs; conversions flip specialist ownership.
      caps.clear();
      stockpiles.clear();
      mirrorCacheValid = false;
    }
    checkVictory(world, world.time);
    if (world.winnerId !== null) break;
  }

  world.time = newTime;
  // Deliberately NOTHING here. Any state change at the tick-call
  // boundary (the old captive/funding/victory sweeps) breaks split
  // invariance — see the module docstring.
}

/**
 * Resolve one due sub event: a pirate-chase intercept, or a normal
 * arrival with same-instant multi-attacker pooling. Extracted from the
 * scheduler switch for readability; mutates caches like the other
 * branches do.
 */
function dispatchArrival(
  world: World,
  sub: Sub,
  caps: Map<PlayerId, number>,
  stockpiles: Map<PlayerId, number>,
): void {
  if (sub.chase !== undefined && sub.chase.phase === 'chasing') {
    // Pirate intercept — fire sub-vs-sub combat against the target.
    // (No separate pirate_intercept event — combat_sub_vs_sub
    // emitted inside resolveSubVsSub already covers the outcome
    // with a player-readable summary and the map pulse fires on
    // that kind too. The extra event was duplicate noise.)
    const target = world.subs.find(
      (s) => (s.id as unknown as number) === (sub.chase!.targetSubId as unknown as number),
    );
    const targetOwner = target?.ownerId;
    if (target !== undefined) {
      // The intercept is a PREDICTION. Normally pirate and target
      // are co-located at arrivalAt by construction, so this is a
      // real meeting. But if the target's trajectory shifted without
      // the chase being refreshed (or the prediction is otherwise
      // stale), firing here would teleport-kill the target across
      // open water. Only fight if they actually meet; otherwise
      // re-aim — recomputeChase refreshes the intercept when the
      // target is still reachable, or routes the pirate home when it
      // isn't (docs/05_specialists.md §7.9). When we re-aim, no
      // combat fires this tick and the pirate is NOT sent home; the
      // refreshed chase resolves on a later arrival.
      const gap = dist(
        subPosition(world, sub, world.time),
        subPosition(world, target, world.time),
      );
      if (gap <= PIRATE_INTERCEPT_TOLERANCE) {
        resolveSubVsSub(world, sub, target);
        // If the pirate survived, route it home at 4× speed.
        if (world.subs.includes(sub)) {
          returnPirateHome(world, sub, world.time);
        }
      } else {
        recomputeChase(world, sub, world.time);
      }
    } else {
      // Target vanished mid-chase (killed/captured elsewhere). Give
      // up and head home — matches recomputeChase's own behaviour.
      if (world.subs.includes(sub)) {
        returnPirateHome(world, sub, world.time);
      }
    }
    // Captive specialists may flip ownership → cap shifts on both
    // sides. Outpost garrisons untouched, no stockpile change.
    caps.delete(sub.ownerId);
    if (targetOwner !== undefined) caps.delete(targetOwner);
    return;
  }

  // Multi-attacker pooling (docs/04_combat.md §Edge Cases):
  // simultaneous arrivals from the same owner against the same
  // destination merge into one virtual attacker before combat.
  // We mutate the chosen `sub` in place (adding pooled drillers
  // and re-locating pooled specialists onto it), then remove
  // the consumed siblings.
  const peers: Sub[] = [];
  for (const other of world.subs) {
    if (other === sub) continue;
    if (other.arrivalAt !== sub.arrivalAt) continue;
    if (other.destinationId !== sub.destinationId) continue;
    if (other.ownerId !== sub.ownerId) continue;
    if (other.chase !== undefined) continue; // pirate chases never pool
    if (other.giftTo !== sub.giftTo) continue; // gift vs hostile separate
    peers.push(other);
  }
  for (const other of peers) {
    sub.drillers += other.drillers;
    for (const s of world.specialists) {
      if (
        s.location.kind === 'sub' &&
        (s.location.id as unknown as number) === (other.id as unknown as number)
      ) {
        s.location = { kind: 'sub', id: sub.id };
      }
    }
    const oi = world.subs.indexOf(other);
    if (oi >= 0) world.subs.splice(oi, 1);
  }
  // Capture the destination's pre-arrival owner so we can
  // invalidate the right caps/stockpiles entries — capture
  // flips ownerId before arriveSub returns.
  const destBefore = world.outposts[
    sub.destinationId as unknown as number
  ];
  const oldDestOwner = destBefore?.ownerId ?? null;
  arriveSub(world, sub);
  const idx = world.subs.indexOf(sub);
  if (idx >= 0) world.subs.splice(idx, 1);
  // Arrival always touches the attacker's stockpile (cargo
  // arrived) and potentially the destination's old owner
  // (captured or partially defeated). Caps shift when a
  // generator capture or specialist relocation happens.
  caps.delete(sub.ownerId);
  stockpiles.delete(sub.ownerId);
  if (oldDestOwner !== null && oldDestOwner !== sub.ownerId) {
    caps.delete(oldDestOwner);
    stockpiles.delete(oldDestOwner);
  }
  // Gift recipient — distinct from sub.ownerId.
  if (sub.giftTo !== undefined && sub.giftTo !== sub.ownerId) {
    caps.delete(sub.giftTo);
    stockpiles.delete(sub.giftTo);
  }
}

function earliestSubArrival(subs: readonly Sub[], deadline: number): Sub | null {
  let earliest: Sub | null = null;
  for (const s of subs) {
    if (s.arrivalAt > deadline) continue;
    if (earliest === null) {
      earliest = s;
    } else if (s.arrivalAt < earliest.arrivalAt) {
      earliest = s;
    } else if (s.arrivalAt === earliest.arrivalAt && s.id < earliest.id) {
      // Stable tiebreak by sub id for determinism.
      earliest = s;
    }
  }
  return earliest;
}

interface PendingEncounter {
  readonly a: Sub;
  readonly b: Sub;
  readonly time: number;
}

/**
 * Earliest mirror-route encounter due before `deadline`, scanning all
 * unordered sub pairs. O(n²) per call — fine while sub counts stay
 * small. Pair tiebreak: by min(a.id, b.id), then max(a.id, b.id) — for
 * determinism in the (rare) case of multiple simultaneous encounters.
 */
function earliestMirrorEncounter(
  subs: readonly Sub[],
  deadline: number,
): PendingEncounter | null {
  let best: PendingEncounter | null = null;
  for (let i = 0; i < subs.length; i++) {
    const a = subs[i]!;
    for (let j = i + 1; j < subs.length; j++) {
      const b = subs[j]!;
      const meet = mirrorEncounterTime(a, b);
      if (meet === null || meet > deadline) continue;
      if (best === null || meet < best.time) {
        best = { a, b, time: meet };
      } else if (meet === best.time) {
        const curMin = Math.min(a.id as unknown as number, b.id as unknown as number);
        const bestMin = Math.min(
          best.a.id as unknown as number,
          best.b.id as unknown as number,
        );
        if (curMin < bestMin) {
          best = { a, b, time: meet };
        } else if (curMin === bestMin) {
          const curMax = Math.max(a.id as unknown as number, b.id as unknown as number);
          const bestMax = Math.max(
            best.a.id as unknown as number,
            best.b.id as unknown as number,
          );
          if (curMax < bestMax) best = { a, b, time: meet };
        }
      }
    }
  }
  return best;
}

function earliestDueFactory(outposts: readonly Outpost[], deadline: number): Outpost | null {
  let earliest: Outpost | null = null;
  for (const o of outposts) {
    if (o.kind !== 'factory') continue;
    if (o.nextProductionAt > deadline) continue;
    if (earliest === null || o.nextProductionAt < earliest.nextProductionAt) {
      earliest = o;
    }
  }
  return earliest;
}

function runFactoryCycle(
  factory: Outpost,
  caps: Map<PlayerId, number>,
  stockpiles: Map<PlayerId, number>,
  world: World,
): void {
  // A factory owned by no one (dormant) silently advances its phase
  // without producing.
  if (factory.ownerId === null) return;

  const owner = factory.ownerId;
  // Lazy fetch: if the prior event invalidated the entry (deleted
  // it) or it was never populated, recompute now. This is the *only*
  // consumer of caps/stockpiles, so populating here avoids the old
  // "rebuild for all players after every event" cost.
  let cap = caps.get(owner);
  if (cap === undefined) {
    cap = electricalOutput(world, owner);
    caps.set(owner, cap);
  }
  let cur = stockpiles.get(owner);
  if (cur === undefined) {
    cur = totalDrillers(world, owner);
    stockpiles.set(owner, cur);
  }

  // Binary production at the cap boundary, per docs. Specialist
  // modifiers (Foreman/Tycoon local & global, MoE penalty, funding)
  // are folded into factoryProductionFor.
  if (cur < cap) {
    const produced = factoryProductionFor(world, factory);
    if (produced > 0) {
      factory.drillers += produced;
      stockpiles.set(owner, cur + produced);
    }
  }
}
