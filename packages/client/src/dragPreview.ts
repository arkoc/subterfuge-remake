import {
  redirectSub,
  simulateArrival,
  simulateSubArrival,
  targetSub,
  tick,
  type ArrivalPreview,
  type OutpostId,
  type PlayerId,
  type SubId,
  type World,
} from '@subterfuge/sim';
import type { DragHoverInfo } from './PixiMap.js';

export interface DragPreview {
  /** Compact lines the tooltip will stack. Always at least one. */
  readonly lines: readonly string[];
  /** "good" → attacker wins, "bad" → loses, "neutral" → tie or info. */
  readonly outcome: 'good' | 'bad' | 'neutral';
}

/**
 * Project the combat outcome the user would get if they committed
 * the in-flight drag right now. Returns null when there's no useful
 * preview (cursor over empty space, source can't actually act on the
 * target, etc.) so the tooltip stays hidden.
 *
 * Implementation: build a structuredClone of the world, apply the
 * gesture's intent inside the clone (launch, redirect, retarget),
 * tick through to the resolution time, and read the resulting state.
 * Throws are caught and treated as "no preview" — a gesture the sim
 * would reject is exactly the case where we should not promise an
 * outcome.
 */
export function computeDragPreview(
  world: World,
  activePlayerId: PlayerId,
  hover: DragHoverInfo,
): DragPreview | null {
  try {
    if (hover.drag === 'launch') {
      return previewLaunch(world, activePlayerId, hover);
    }
    if (hover.drag === 'redirect') {
      return previewRedirect(world, activePlayerId, hover);
    }
    if (hover.drag === 'pirate-retarget') {
      return previewPirateRetarget(world, activePlayerId, hover);
    }
    return null;
  } catch {
    return null;
  }
}

function previewLaunch(
  world: World,
  activePlayerId: PlayerId,
  hover: DragHoverInfo,
): DragPreview | null {
  if (hover.target === null) return null;
  const src = world.outposts.find(
    (o) => (o.id as unknown as number) === hover.sourceId,
  );
  if (src === undefined) return null;
  if (src.ownerId !== activePlayerId || src.drillers <= 0) return null;

  if (hover.target.kind === 'outpost') {
    const dest = world.outposts.find((o) => o.id === hover.target!.id);
    if (dest === undefined) return null;
    // Preview-default fleet size: send most of the garrison, leave a
    // small holding force. The launch sheet lets the player tune
    // before committing — this is just a directional projection.
    const drillers = Math.max(1, src.drillers - 1);
    const preview = simulateArrival({
      world,
      sourceId: src.id,
      destinationId: dest.id,
      drillers,
      attackerId: activePlayerId,
    });
    return formatArrivalPreview(preview, drillers, dest.ownerId === activePlayerId, true);
  }
  // Drop on a sub during launch drag = Pirate-launch flow (handled
  // separately by App). Show a hint, no combat math.
  return {
    lines: ['pirate launch · open sheet to pick'],
    outcome: 'neutral',
  };
}

function previewRedirect(
  world: World,
  activePlayerId: PlayerId,
  hover: DragHoverInfo,
): DragPreview | null {
  if (hover.target === null || hover.target.kind !== 'outpost') return null;
  const projected = structuredClone(world) as World;
  const liveSub = projected.subs.find(
    (s) => (s.id as unknown as number) === hover.sourceId,
  );
  if (liveSub === undefined) return null;
  redirectSub(projected, {
    ownerId: liveSub.ownerId,
    subId: hover.sourceId as unknown as SubId,
    newDestinationId: hover.target.id as unknown as OutpostId,
  });
  const projSub = projected.subs.find(
    (s) => (s.id as unknown as number) === hover.sourceId,
  );
  if (projSub === undefined) return null;
  const preview = simulateSubArrival(projected, projSub);
  const dest = projected.outposts.find(
    (o) => (o.id as unknown as number) === (hover.target!.id as unknown as number),
  );
  const reinforce = dest?.ownerId === projSub.ownerId;
  // viewerIsAttacker only when the active player owns the source sub.
  // For enemy-sub preview drags, the active player is the DEFENDER —
  // capture is bad, defend is good.
  const viewerIsAttacker = liveSub.ownerId === activePlayerId;
  return formatArrivalPreview(preview, projSub.drillers, reinforce, viewerIsAttacker);
}

function previewPirateRetarget(
  world: World,
  activePlayerId: PlayerId,
  hover: DragHoverInfo,
): DragPreview | null {
  if (hover.target === null || hover.target.kind !== 'sub') return null;
  const sourceSubLive = world.subs.find(
    (s) => (s.id as unknown as number) === hover.sourceId,
  );
  if (sourceSubLive === undefined) return null;

  const projected = structuredClone(world) as World;
  targetSub(projected, {
    ownerId: sourceSubLive.ownerId,
    subId: hover.sourceId,
    targetSubId: hover.target.id as unknown as number,
  });
  const projSub = projected.subs.find(
    (s) => (s.id as unknown as number) === hover.sourceId,
  );
  if (projSub === undefined) return null;
  // Tick past the intercept time so resolveSubVsSub fires.
  const dt = projSub.arrivalAt + 1 - projected.time;
  if (dt > 0) tick(projected, dt);

  const subAfter = projected.subs.find(
    (s) => (s.id as unknown as number) === hover.sourceId,
  );
  const targetAfter = projected.subs.find(
    (s) =>
      (s.id as unknown as number) ===
      (hover.target!.id as unknown as number),
  );
  // After resolution: source (pirate) surviving = pirate wins;
  // target surviving = pirate loses. From the viewer's perspective,
  // flip if the viewer owns the TARGET (defending against an enemy
  // pirate retarget preview).
  const viewerIsPirate = sourceSubLive.ownerId === activePlayerId;
  let outcome: 'good' | 'bad' | 'neutral' = 'neutral';
  let result = 'tie';
  let remaining = 0;
  if (subAfter !== undefined && targetAfter === undefined) {
    // Pirate wins.
    outcome = viewerIsPirate ? 'good' : 'bad';
    result = viewerIsPirate ? 'win' : 'lose';
    remaining = subAfter.drillers;
  } else if (subAfter === undefined && targetAfter !== undefined) {
    // Target wins.
    outcome = viewerIsPirate ? 'bad' : 'good';
    result = viewerIsPirate ? 'lose' : 'win';
    remaining = targetAfter.drillers;
  } else if (subAfter === undefined && targetAfter === undefined) {
    outcome = 'neutral';
    result = 'tie';
  } else {
    // Both still exist post-tick → likely a double-agent / no-loss
    // resolution. Treat as neutral.
    return {
      lines: [
        `pirate hunt → sub #${hover.target.id as unknown as number}`,
        'unclear outcome (specialist swap)',
      ],
      outcome: 'neutral',
    };
  }
  return {
    lines: [
      `ATK ${sourceSubLive.drillers} → DEF ${
        world.subs.find(
          (s) => (s.id as unknown as number) === (hover.target!.id as unknown as number),
        )?.drillers ?? '?'
      }`,
      `${result === 'win' ? '✓ HUNT' : result === 'lose' ? '✗ LOSE' : 'TIE'} · ${remaining} left`,
    ],
    outcome,
  };
}

function formatArrivalPreview(
  preview: ArrivalPreview,
  drillers: number,
  reinforce: boolean,
  viewerIsAttacker: boolean,
): DragPreview {
  // Reinforce: no combat, just deposit drillers.
  if (reinforce) {
    return {
      lines: [`reinforce · +${drillers} drillers`],
      outcome: 'neutral',
    };
  }
  const def = preview.defenderDrillersAtArrival;
  const shield = preview.shieldAtArrival;
  let result = '';
  let outcome: 'good' | 'bad' | 'neutral';
  if (preview.outpostCaptured) {
    // Attacker wins. From defender's perspective this is bad.
    outcome = viewerIsAttacker ? 'good' : 'bad';
    result = viewerIsAttacker
      ? `✓ CAPTURE · ${preview.attackerSurviving} left`
      : `✗ LOST · ${preview.attackerSurviving} take it`;
  } else if (preview.attackerSurviving === 0 && preview.defenderSurviving > 0) {
    // Defender wins.
    outcome = viewerIsAttacker ? 'bad' : 'good';
    result = viewerIsAttacker
      ? `✗ DEFEND · ${preview.defenderSurviving} left`
      : `✓ HOLD · ${preview.defenderSurviving} left`;
  } else {
    outcome = 'neutral';
    result = `${preview.attackerSurviving} vs ${preview.defenderSurviving}`;
  }
  const shieldLine =
    shield > 0
      ? `▼ shield ${shield}${preview.shieldAbsorbed > 0 ? ` · abs ${preview.shieldAbsorbed}` : ''}`
      : null;
  const lines = [`ATK ${preview.attackerDrillers} → DEF ${def}`];
  if (shieldLine !== null) lines.push(shieldLine);
  lines.push(result);
  return { lines, outcome };
}
