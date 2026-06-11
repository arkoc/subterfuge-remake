import { useMemo, useRef } from 'react';
import type {
  ArrivalOutcome,
  OutpostId,
  PlayerId,
  Sub,
  SubId,
  World,
} from '@subterfuge/sim';
import { simulateMultipleSubArrivals, subStatus } from '@subterfuge/sim';

export interface Threat {
  outpostId: OutpostId;
  outpostName: string;
  etaMs: number;
  subId: SubId;
  /** Projected outcome from the *viewer's* perspective: 'defender-wins'
   *  means the viewer holds; 'attacker-wins' means the viewer loses;
   *  'tie' means both sides die. Used to color the threat-lane chip. */
  outcome: ArrivalOutcome;
}

/**
 * Compute the inbound-hostile-sub threats against `viewerId` from a
 * filtered world. Each owned outpost that has at least one hostile sub
 * inbound gets the SOONEST one as a Threat row.
 *
 * Includes a projected outcome per threat (via simulateMultipleSubArrivals
 * — one shared clone + tick per render, not N) so the threat-lane UI
 * can show "will lose" / "defender wins" / "tie" at a glance.
 *
 * Returned array is sorted by ETA ascending (soonest first).
 *
 * Tolerates `null` so the caller can pass `liveWorld` directly without
 * a stand-in object on the first render.
 */
export function useThreats(
  world: World | null,
  viewerId: PlayerId,
): Threat[] {
  // Outcome projections are the expensive part (shared clone + tick to
  // the furthest arrival) and the world pushes every 500 ms. The
  // combat-relevant inputs drift far slower than the clock, so cache
  // the outcome map behind a fingerprint of those inputs and only
  // re-simulate when it changes; ETAs stay live (recomputed per push).
  const outcomeCacheRef = useRef<{
    fp: string;
    outcomes: ReturnType<typeof simulateMultipleSubArrivals>;
  } | null>(null);
  return useMemo(() => {
    if (!world || !Array.isArray(world.subs) || !Array.isArray(world.outposts)) {
      return [];
    }
    // Step 1: find the soonest inbound enemy sub per outpost.
    const soonest = new Map<OutpostId, Sub>();
    for (const sub of world.subs) {
      if (sub.ownerId === viewerId) continue;
      if (sub.giftTo === viewerId) continue;
      if (subStatus(sub, world.time) === 'queued') continue;
      const dest = world.outposts.find((o) => o.id === sub.destinationId);
      if (!dest || dest.ownerId !== viewerId) continue;
      const existing = soonest.get(dest.id);
      if (!existing || sub.arrivalAt < existing.arrivalAt) {
        soonest.set(dest.id, sub);
      }
    }
    if (soonest.size === 0) return [];

    // Step 2: batch project outcomes — one shared world clone for all
    // threat subs, instead of N independent structuredClones. Skipped
    // entirely while the fingerprint (sub identity/arrival + defender
    // garrison/shield) is unchanged.
    const threatSubs = [...soonest.values()];
    const fp =
      `${viewerId}|` +
      threatSubs
        .map((s) => {
          const d = world.outposts.find((o) => o.id === s.destinationId);
          return `${s.id}:${s.arrivalAt}:${s.drillers}:${s.destinationId}:${d?.drillers ?? ''}:${d?.shieldCharge ?? ''}`;
        })
        .join(',');
    let outcomes: ReturnType<typeof simulateMultipleSubArrivals>;
    const cached = outcomeCacheRef.current;
    if (cached !== null && cached.fp === fp) {
      outcomes = cached.outcomes;
    } else {
      outcomes = simulateMultipleSubArrivals(world, threatSubs);
      outcomeCacheRef.current = { fp, outcomes };
    }

    // Step 3: build sorted Threat[].
    const out: Threat[] = [];
    for (const [outpostId, sub] of soonest) {
      const dest = world.outposts.find((o) => o.id === outpostId);
      if (!dest) continue;
      const preview = outcomes.get(sub.id as unknown as number);
      out.push({
        outpostId,
        outpostName: dest.name,
        etaMs: sub.arrivalAt - world.time,
        subId: sub.id,
        // If projection failed (transitional state), default to
        // 'attacker-wins' so the row reads worst-case.
        outcome: preview?.outcome ?? 'attacker-wins',
      });
    }
    out.sort((a, b) => a.etaMs - b.etaMs);
    return out;
  }, [world, viewerId]);
}

/** Legacy adapter: PixiMap's old API took a Map<OutpostId, {etaMs, subId}>.
 *  Kept as a no-op pass-through in case any caller still passes it; the
 *  on-outpost threat badge is being removed in this redesign pass and
 *  the lane takes over. */
export function threatsAsMap(
  threats: Threat[],
): Map<OutpostId, { etaMs: number; subId: SubId }> {
  const m = new Map<OutpostId, { etaMs: number; subId: SubId }>();
  for (const t of threats) m.set(t.outpostId, { etaMs: t.etaMs, subId: t.subId });
  return m;
}
