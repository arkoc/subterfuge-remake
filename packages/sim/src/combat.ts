import type {
  Outpost,
  PlayerId,
  Specialist,
  SpecialistKind,
  Sub,
  World,
} from './types.js';
import {
  MINE_CAPTURE_PENALTY_DENOMINATOR,
  MINE_CAPTURE_PENALTY_NUMERATOR,
} from './types.js';
import { currentShieldCharge } from './shield.js';
import { commitNeptunium } from './mining.js';
import { playerById } from './queries.js';
import {
  activeCountOf,
  specialistsAtOutpost,
  specialistsOnSub,
} from './specialists.js';
import { tryInspectorRecharge } from './passives.js';
import { transferCaptivesOnCapture } from './captives.js';
import { electricalOutput, totalDrillers } from './production.js';
import { recomputeSubsTargeting, subPosition } from './subs.js';
import { distSquared } from './geometry.js';
import { SONAR_RANGE } from './types.js';
import { onQueenLost } from './royalty.js';
import { emitEvent } from './events.js';

/** Single-letter / name shorthand used in combat event summaries.
 *  Falls back to "Player N" when the player has no display name. */
function playerNameFor(world: World, id: PlayerId): string {
  const p = playerById(world, id);
  return p.name && p.name.length > 0 ? p.name : `Player ${id as unknown as number}`;
}

export interface CombatOutcome {
  readonly attackerDrillersBefore: number;
  readonly defenderDrillersBefore: number;
  readonly shieldBefore: number;
  readonly shieldAbsorbed: number;
  readonly attackerSurviving: number;
  readonly defenderSurviving: number;
  readonly winner: 'attacker' | 'defender';
  readonly outpostCaptured: boolean;
  readonly mineCapturePenaltyMg: number;
}

export interface SubVsSubOutcome {
  readonly aDrillersBefore: number;
  readonly bDrillersBefore: number;
  readonly winner: 'a' | 'b' | 'tie';
  readonly survivingDrillers: number;
}

// ---------------------------------------------------------------------
// Side aggregation
// ---------------------------------------------------------------------

/**
 * Internal struct: one side of a combat after fetching its drillers
 * and specialists, used by the CP walker. Mutating `drillers`,
 * `specialists`, etc. reflects in-combat state evolution.
 */
interface Side {
  readonly ownerId: PlayerId;
  drillers: number;
  /** Specialists active on this side. Removed by Assassin, etc. */
  specialists: Specialist[];
  /** Specialists destroyed during combat (not captured). */
  destroyed: Specialist[];
  /** Drillers destroyed this combat (used by Engineer post-victory restore). */
  drillersDestroyed: number;
  /** Drillers stolen by Thief or swapped by Double Agent — excluded from Engineer math. */
  drillersConverted: number;
}

function makeSubSide(world: World, sub: Sub): Side {
  return {
    ownerId: sub.ownerId,
    drillers: sub.drillers,
    specialists: specialistsOnSub(world, sub.id).filter(
      (s) => s.state === 'active',
    ),
    destroyed: [],
    drillersDestroyed: 0,
    drillersConverted: 0,
  };
}

function makeOutpostSide(world: World, outpost: Outpost): Side {
  const ownerId = outpost.ownerId;
  if (ownerId === null) {
    throw new Error(`makeOutpostSide called on dormant outpost ${outpost.id}`);
  }
  return {
    ownerId,
    drillers: outpost.drillers,
    specialists: specialistsAtOutpost(world, outpost.id).filter(
      (s) => s.state === 'active' && s.ownerId === ownerId,
    ),
    destroyed: [],
    drillersDestroyed: 0,
    drillersConverted: 0,
  };
}

function hasKind(side: Side, kind: SpecialistKind): boolean {
  return side.specialists.some((s) => s.kind === kind);
}

function countKind(side: Side, kind: SpecialistKind): number {
  return side.specialists.filter((s) => s.kind === kind).length;
}

// ---------------------------------------------------------------------
// Phase 1: specialist effects
// ---------------------------------------------------------------------

/**
 * Run the specialist phase against the two sides. Returns true if
 * combat ended early (Double Agent or universal Martyr destruction).
 */
function runSpecialistPhase(
  world: World,
  att: Side,
  def: Side,
  isOutpostCombat: boolean,
  outpost: Outpost | null,
  encounterPos: { x: number; y: number },
): { ended: boolean; swappedSubs?: boolean; martyrFired?: boolean } {
  // CP 1 — Martyr. Geometric blast: every sub and outpost within
  // 0.20 × SONAR_RANGE of the encounter centre is annihilated, friend
  // and foe alike. The Sides' bookkeeping is zeroed for the calling
  // resolver to short-circuit cleanly.
  if (hasKind(att, 'martyr') || hasKind(def, 'martyr')) {
    att.drillersDestroyed += att.drillers;
    def.drillersDestroyed += def.drillers;
    att.drillers = 0;
    def.drillers = 0;
    att.specialists = [];
    def.specialists = [];
    martyrBlast(world, encounterPos, world.time);
    return { ended: true, martyrFired: true };
  }

  // CP 2 — Revered Elder veto. If exactly one side has an RE, no
  // other specialist participates (RE silences all others including
  // post-spec and post-driller).
  const attRE = hasKind(att, 'revered_elder');
  const defRE = hasKind(def, 'revered_elder');
  const reVeto = attRE !== defRE;
  if (reVeto) {
    // Strip everything except RE from both sides so post-spec /
    // post-driller hooks see nothing.
    att.specialists = att.specialists.filter((s) => s.kind === 'revered_elder');
    def.specialists = def.specialists.filter((s) => s.kind === 'revered_elder');
    return { ended: false };
  }

  // CP 4 — Thief and Infiltrator (simultaneous, but Thief stacking
  // is sequential by spec).
  // Thief: converts ceil(15% × enemy drillers) per Thief, applied
  // sequentially on the diminishing remainder.
  applyThief(att, def);
  applyThief(def, att);
  if (isOutpostCombat && outpost !== null) {
    // Infiltrator: drains the outpost's ENTIRE live shield charge.
    // One Infiltrator is enough — additional Infiltrators are
    // redundant for the drain effect. This is the deliberate spec
    // (see docs/05_specialists.md §13): the Infiltrator is a hard
    // shield-counter, not a chip-away effect.
    const attInfs = countKind(att, 'infiltrator');
    if (attInfs > 0) {
      outpost.shieldCharge = 0;
      outpost.shieldChargedSince = world.time;
    }
  }

  // CP 5 — Double Agent (sub-vs-sub only per spec).
  if (!isOutpostCombat) {
    if (hasKind(att, 'double_agent') || hasKind(def, 'double_agent')) {
      // Both sides' drillers destroyed; subs swap ownership including
      // specialists. Combat ends. Caller is responsible for the actual
      // sub/specialist re-tagging (we set flags here and the
      // sub-vs-sub resolver does the mutation).
      att.drillersDestroyed += att.drillers;
      def.drillersDestroyed += def.drillers;
      att.drillers = 0;
      def.drillers = 0;
      return { ended: true, swappedSubs: true };
    }
  }

  // CP 6 — Assassin. Kills all enemy specialists outright (no
  // capture). Captives at the site are not in `side.specialists`,
  // so they're untouched.
  if (hasKind(att, 'assassin')) {
    def.destroyed.push(...def.specialists.filter((s) => s.kind !== 'assassin' || true));
    def.specialists = [];
  }
  if (hasKind(def, 'assassin')) {
    att.destroyed.push(...att.specialists);
    att.specialists = [];
  }

  // CP 7 — Lieutenant (+5), War Hero (+20).
  // Sentry has NO in-combat damage in the original — it's a pure
  // passive (the 2-hour ceil(5%) sniper at the outpost). The Sentry's
  // upgrade path is War Hero, which is where in-combat damage starts.
  const attDamage =
    5 * countKind(att, 'lieutenant') +
    20 * countKind(att, 'war_hero');
  const defDamage =
    5 * countKind(def, 'lieutenant') +
    20 * countKind(def, 'war_hero');
  destroyDrillers(def, attDamage);
  destroyDrillers(att, defDamage);

  // Post-spec — General (global +10 per General when this player has any
  // specialist participating), King (1 per 3 friendly remaining at
  // King's own outpost only).
  const attHasAny = att.specialists.length > 0;
  const defHasAny = def.specialists.length > 0;
  if (attHasAny) {
    const generals = activeCountOf(world, att.ownerId, 'general');
    destroyDrillers(def, 10 * generals);
  }
  if (defHasAny) {
    const generals = activeCountOf(world, def.ownerId, 'general');
    destroyDrillers(att, 10 * generals);
  }
  // King: only counts Kings at this combat's location. For outpost
  // combat that's `outpost`; for sub-vs-sub, Kings on the encountering
  // sub.
  const attKings = countKind(att, 'king');
  const defKings = countKind(def, 'king');
  if (attKings > 0 && att.drillers > 0) {
    destroyDrillers(def, attKings * Math.floor(att.drillers / 3));
  }
  if (defKings > 0 && def.drillers > 0) {
    destroyDrillers(att, defKings * Math.floor(def.drillers / 3));
  }

  return { ended: false };
}

function applyThief(side: Side, enemy: Side): void {
  // Per docs/05_specialists.md §7.7: stacked Thieves apply
  // sequentially on the diminishing remainder.
  const thieves = side.specialists.filter((s) => s.kind === 'thief');
  for (const _t of thieves) {
    if (enemy.drillers <= 0) break;
    const stolen = Math.min(enemy.drillers, Math.ceil(enemy.drillers * 0.15));
    enemy.drillers -= stolen;
    enemy.drillersConverted += stolen;
    side.drillers += stolen;
  }
}

function destroyDrillers(side: Side, n: number): void {
  if (n <= 0) return;
  const taken = Math.min(side.drillers, n);
  side.drillers -= taken;
  side.drillersDestroyed += taken;
}

// ---------------------------------------------------------------------
// Engineer post-victory restore
// ---------------------------------------------------------------------

function applyEngineerRestore(world: World, winner: Side, winnerAtSite: boolean): void {
  if (winner.drillersDestroyed <= 0) return;
  const globalEngineers = activeCountOf(world, winner.ownerId, 'engineer');
  const localEngineers = winnerAtSite ? countKind(winner, 'engineer') : 0;
  const totalPct = 0.25 * globalEngineers + 0.25 * localEngineers;
  if (totalPct <= 0) return;
  winner.drillers += Math.ceil(winner.drillersDestroyed * totalPct);
}

/**
 * Clamp post-combat outpost drillers to the owner's live electrical
 * cap. Engineer restore can otherwise push a winner over their cap
 * (docs/05_specialists.md §9.5 + docs/03_drillers_production.md).
 * Headroom is computed from the player's *other* outposts: at the
 * moment of clamp the current outpost still holds its pre-write
 * value, so we subtract it from `totalDrillers` to get the rest.
 */
function clampOutpostToCap(
  world: World,
  outpost: Outpost,
  proposed: number,
  ownerId: PlayerId,
): number {
  // Cap-clamp only ever REDUCES; never below the count the outpost
  // already had pre-combat. If the player was over-cap before
  // (e.g. they recently lost a Generator), combat survivors must
  // STILL be honoured — the existing over-cap state is a separate
  // condition the player gets to resolve over time, not a hammer
  // that crushes their defending garrison to 0 the moment any
  // attacker pokes them.
  //
  // The clamp now applies only to the NET INCREASE over the
  // outpost's current drillers — typically that's Engineer restore
  // on a successful defence/capture. Combat losses are passed
  // through unchanged.
  if (proposed <= outpost.drillers) return Math.max(0, proposed);
  const cap = electricalOutput(world, ownerId);
  const otherDrillers = totalDrillers(world, ownerId) - outpost.drillers;
  const headroom = Math.max(0, cap - otherDrillers);
  return Math.max(0, Math.min(proposed, Math.max(outpost.drillers, headroom)));
}

// ---------------------------------------------------------------------
// Capture phase (Phase 4)
// ---------------------------------------------------------------------

/**
 * Move the loser's surviving specialists into captive state, held by
 * the winner at the capture site. Specialists destroyed in Phase 1
 * (`side.destroyed`) are removed from the world entirely.
 */
function capturePhase(
  world: World,
  loser: Side,
  winnerOwner: PlayerId,
  captureSite: Outpost | null,
  fallbackOutpost: Outpost | null,
): void {
  // Remove destroyed-in-combat specialists entirely.
  let queenLost = false;
  for (const dead of loser.destroyed) {
    if (dead.kind === 'queen') queenLost = true;
    const idx = world.specialists.indexOf(dead);
    if (idx >= 0) world.specialists.splice(idx, 1);
  }
  // Mark surviving specialists as captives at the capture site.
  const site = captureSite ?? fallbackOutpost;
  for (const s of loser.specialists) {
    if (s.kind === 'queen') queenLost = true;
    s.state = 'captive';
    s.captiveOf = winnerOwner;
    if (site !== null) {
      s.location = { kind: 'outpost', id: site.id };
    }
  }
  // Queen captured or destroyed → succession or elimination
  // (docs/10 §Elimination: "Their Queen is captured. … If they have
  // no Princess, they are eliminated."). onQueenLost no-ops if the
  // player somehow still has an active Queen.
  if (queenLost) {
    onQueenLost(world, loser.ownerId, site?.pos ?? null);
  }
}

// ---------------------------------------------------------------------
// Sub-vs-outpost
// ---------------------------------------------------------------------

export function resolveCombat(
  world: World,
  sub: Sub,
  outpost: Outpost,
): CombatOutcome {
  const attackerId: PlayerId = sub.ownerId;
  const defenderId = outpost.ownerId;
  if (defenderId === null) {
    throw new Error(`resolveCombat called on a dormant outpost ${outpost.id}`);
  }
  if (defenderId === attackerId) {
    throw new Error(`resolveCombat called on a friendly outpost ${outpost.id}`);
  }

  // Commit Neptunium for both players before anything mutates.
  commitNeptunium(world, attackerId, world.time);
  commitNeptunium(world, defenderId, world.time);

  const att = makeSubSide(world, sub);
  const def = makeOutpostSide(world, outpost);
  const attackerDrillersBefore = att.drillers;
  const defenderDrillersBefore = def.drillers;
  const shieldBefore = currentShieldCharge(outpost, world.time, world);

  // Phase 1: specialist phase. Encounter centred at the outpost.
  const phase1 = runSpecialistPhase(world, att, def, true, outpost, outpost.pos);
  if (phase1.martyrFired === true) {
    // Martyr annihilated everything in the blast (including possibly
    // the outpost itself, now dormant). No capture, no survivors —
    // everyone in the radius is gone.
    return {
      attackerDrillersBefore,
      defenderDrillersBefore,
      shieldBefore,
      shieldAbsorbed: 0,
      attackerSurviving: 0,
      defenderSurviving: 0,
      winner: 'defender',
      outpostCaptured: false,
      mineCapturePenaltyMg: 0,
    };
  }
  if (phase1.ended) {
    // (Reserved for future non-Martyr phase-1 terminators in
    // sub-vs-outpost — currently unreachable.)
    outpost.drillers = def.drillers;
    capturePhase(world, att, defenderId, outpost, null);
    return {
      attackerDrillersBefore,
      defenderDrillersBefore,
      shieldBefore,
      shieldAbsorbed: 0,
      attackerSurviving: 0,
      defenderSurviving: def.drillers,
      winner: 'defender',
      outpostCaptured: false,
      mineCapturePenaltyMg: 0,
    };
  }

  // Phase 2: shield. Use the (potentially Infiltrator-drained) live value.
  const liveShield = currentShieldCharge(outpost, world.time, world);
  const shieldAbsorbed = Math.min(liveShield, att.drillers);
  att.drillers -= shieldAbsorbed;
  att.drillersDestroyed += shieldAbsorbed;
  outpost.shieldCharge = liveShield - shieldAbsorbed;
  outpost.shieldChargedSince = world.time;

  // Phase 3: driller.
  let winner: 'attacker' | 'defender';
  let attackerSurviving = 0;
  let defenderSurviving = 0;
  let outpostCaptured = false;
  let mineCapturePenaltyMg = 0;

  if (att.drillers > def.drillers) {
    winner = 'attacker';
    attackerSurviving = att.drillers - def.drillers;
    att.drillersDestroyed += def.drillers;
    def.drillersDestroyed += def.drillers;
    att.drillers = attackerSurviving;
    def.drillers = 0;
    outpostCaptured = true;
  } else {
    winner = 'defender';
    defenderSurviving = def.drillers - att.drillers;
    def.drillersDestroyed += att.drillers;
    att.drillersDestroyed += att.drillers;
    def.drillers = defenderSurviving;
    att.drillers = 0;
  }

  // Engineer post-victory restore.
  if (winner === 'attacker') {
    // Winner side is `att`; local engineers are on the sub.
    applyEngineerRestore(world, att, true);
    attackerSurviving = att.drillers;
  } else {
    // Winner side is `def`; local engineers are at the outpost.
    applyEngineerRestore(world, def, true);
    defenderSurviving = def.drillers;
  }

  // Phase 4 capture + apply mutations.
  if (winner === 'attacker') {
    // Mine capture penalty.
    if (outpost.kind === 'mine') {
      const loser = playerById(world, defenderId);
      const num = loser.neptuniumMg * MINE_CAPTURE_PENALTY_NUMERATOR;
      mineCapturePenaltyMg = Math.ceil(num / MINE_CAPTURE_PENALTY_DENOMINATOR);
      loser.neptuniumMg -= mineCapturePenaltyMg;
    }
    outpost.ownerId = attackerId;
    // Clamp Engineer-restored drillers to attacker's electrical cap.
    outpost.drillers = clampOutpostToCap(world, outpost, attackerSurviving, attackerId);
    attackerSurviving = outpost.drillers;
    // Smuggler-laden subs heading here now have a new effective
    // destination ownership — recompute their speed/arrival.
    recomputeSubsTargeting(world, outpost.id, world.time);
    // Transfer pre-existing captives at this outpost to the new owner
    // (or free them if the new owner is their original owner).
    transferCaptivesOnCapture(world, outpost, attackerId);
    // Defender specialists captured by attacker at the (now-attacker's) outpost.
    capturePhase(world, def, attackerId, outpost, null);
    // Surviving attacker specialists move from the sub to the outpost.
    for (const s of att.specialists) {
      s.location = { kind: 'outpost', id: outpost.id };
    }
    // Inspector recharge on capture — if the attacker brought an
    // Inspector (or Security Chief) aboard, they're now at the
    // outpost and should fully charge its shield. Per docs/05§8.5
    // this fires "after every combat while present" — symmetric
    // between the two winner branches.
    tryInspectorRecharge(world, outpost, world.time);
  } else {
    // Clamp Engineer-restored drillers to defender's electrical cap.
    outpost.drillers = clampOutpostToCap(world, outpost, defenderSurviving, defenderId);
    defenderSurviving = outpost.drillers;
    // Attacker specialists captured by defender.
    capturePhase(world, att, defenderId, outpost, null);
    // Inspector recharge on a successful defence.
    tryInspectorRecharge(world, outpost, world.time);
  }

  emitEvent(
    world,
    'combat_outpost',
    [attackerId, defenderId],
    winner === 'attacker'
      ? `attacker captured ${outpost.name} (${attackerSurviving} drillers remain)`
      : `defender held ${outpost.name} (${defenderSurviving} drillers remain)`,
    outpost.pos,
  );
  return {
    attackerDrillersBefore,
    defenderDrillersBefore,
    shieldBefore,
    shieldAbsorbed,
    attackerSurviving,
    defenderSurviving,
    winner,
    outpostCaptured,
    mineCapturePenaltyMg,
  };
}

// ---------------------------------------------------------------------
// Sub-vs-sub
// ---------------------------------------------------------------------

export function mirrorEncounterTime(a: Sub, b: Sub): number | null {
  if (a.ownerId === b.ownerId) return null;
  if (a.giftTo !== undefined || b.giftTo !== undefined) return null;
  if (a.sourceId !== b.destinationId || a.destinationId !== b.sourceId) {
    return null;
  }
  // A redirected sub (leg anchor set) no longer travels the straight
  // source→destination corridor this formula assumes — its id pair may
  // still look like a mirror route, but the geometry is gone.
  if (a.legStartAt !== undefined || b.legStartAt !== undefined) return null;
  // Avoid re-firing the same encounter after a Double Agent swap or
  // any other outcome that leaves both subs in flight.
  const aId = a.id as unknown as number;
  const bId = b.id as unknown as number;
  if (a.encountered?.includes(bId) || b.encountered?.includes(aId)) {
    return null;
  }
  const fA = a.arrivalAt - a.launchAt;
  const fB = b.arrivalAt - b.launchAt;
  if (fA <= 0 || fB <= 0) return null;
  const meet = Math.round(
    (a.launchAt * fB + b.launchAt * fA + fA * fB) / (fA + fB),
  );
  const earliest = Math.max(a.launchAt, b.launchAt);
  const latest = Math.min(a.arrivalAt, b.arrivalAt);
  if (meet < earliest || meet > latest) return null;
  return meet;
}

function markEncountered(a: Sub, b: Sub): void {
  const aId = a.id as unknown as number;
  const bId = b.id as unknown as number;
  (a.encountered ??= []).push(bId);
  (b.encountered ??= []).push(aId);
}

// ---------------------------------------------------------------------
// Martyr blast geometry
// ---------------------------------------------------------------------

/**
 * Fraction of `SONAR_RANGE` that defines the Martyr's blast radius
 * (per docs/05_specialists.md §4.3 / §7.1 / §13#? — base sonar, not
 * specialist-modified sonar).
 */
const MARTYR_BLAST_FRACTION = 0.20;

/**
 * Detonate a Martyr blast centred at `center`. Every sub and every
 * outpost within `0.20 × SONAR_RANGE` is destroyed:
 *
 *   - Subs are removed from `world.subs`. Specialists aboard are
 *     destroyed outright (no capture, no save).
 *   - Outposts become dormant: ownerId=null, drillers=0, shield=0.
 *     Specialists at the outpost (active or captive) are destroyed
 *     outright. If the outpost owned a Queen who is annihilated and
 *     the player has no Princess, that player is eliminated.
 *
 * The blast is owner-blind — friendly assets in the radius are
 * destroyed too.
 */
export function martyrBlast(
  world: World,
  center: { x: number; y: number },
  now: number,
): void {
  // Emit the blast event before mutations so the visibleTo list still
  // contains the affected owners (some may be eliminated after).
  const blastRadius = SONAR_RANGE * MARTYR_BLAST_FRACTION;
  const blastR2 = blastRadius * blastRadius;
  const affectedOwners = new Set<PlayerId>();
  for (const s of world.subs) {
    const pos = subPosition(world, s, now);
    if (distSquared(center, pos) <= blastR2) affectedOwners.add(s.ownerId);
  }
  for (const o of world.outposts) {
    if (distSquared(center, o.pos) <= blastR2 && o.ownerId !== null) {
      affectedOwners.add(o.ownerId);
    }
  }
  emitEvent(
    world,
    'martyr_blast',
    [...affectedOwners],
    `martyr detonated — radius ${Math.round(blastRadius)} u`,
    center,
  );
  const radius = SONAR_RANGE * MARTYR_BLAST_FRACTION;
  const r2 = radius * radius;

  // 1. Subs in radius → destroy.
  const survivingSubs: Sub[] = [];
  const destroyedSubIds = new Set<number>();
  for (const sub of world.subs) {
    const pos = subPosition(world, sub, now);
    if (distSquared(center, pos) <= r2) {
      destroyedSubIds.add(sub.id as unknown as number);
    } else {
      survivingSubs.push(sub);
    }
  }
  world.subs = survivingSubs;

  // 2. Outposts in radius → dormant.
  const dormantedOutpostIds = new Set<number>();
  // Track Queen losses so we can run succession after.
  const queenLossOwners: { ownerId: PlayerId; pos: { x: number; y: number } }[] = [];
  for (const o of world.outposts) {
    if (distSquared(center, o.pos) > r2) continue;
    dormantedOutpostIds.add(o.id as unknown as number);
    const oldOwner = o.ownerId;
    o.ownerId = null;
    o.drillers = 0;
    o.shieldCharge = 0;
    o.shieldChargedSince = now;
    if (oldOwner !== null) {
      // If this outpost hosted an active Queen, queue succession.
      for (const s of world.specialists) {
        if (
          s.kind === 'queen' &&
          s.state === 'active' &&
          s.ownerId === oldOwner &&
          s.location.kind === 'outpost' &&
          (s.location.id as unknown as number) === (o.id as unknown as number)
        ) {
          queenLossOwners.push({ ownerId: oldOwner, pos: o.pos });
        }
      }
    }
  }

  // 3. Specialists on destroyed subs or outposts → removed entirely.
  world.specialists = world.specialists.filter((s) => {
    if (s.location.kind === 'sub') {
      return !destroyedSubIds.has(s.location.id as unknown as number);
    }
    return !dormantedOutpostIds.has(s.location.id as unknown as number);
  });

  // 4. Run succession for any Queens annihilated. onQueenLost finds
  //    the nearest Princess to promote or eliminates the player.
  for (const { ownerId, pos } of queenLossOwners) {
    onQueenLost(world, ownerId, pos);
  }
}

export function resolveSubVsSub(world: World, a: Sub, b: Sub): SubVsSubOutcome {
  commitNeptunium(world, a.ownerId, world.time);
  commitNeptunium(world, b.ownerId, world.time);

  // Record that this pair has resolved an encounter — used by
  // mirrorEncounterTime to avoid re-firing forever when one or both
  // subs survive (Double Agent swap, mutual destruction with empty
  // shells, etc.).
  markEncountered(a, b);

  const sideA = makeSubSide(world, a);
  const sideB = makeSubSide(world, b);
  const aBefore = sideA.drillers;
  const bBefore = sideB.drillers;

  // Sub-vs-sub encounter centre = positions of the two subs at meet
  // time, both at the same point by definition.
  const encounterPos = subPosition(world, a, world.time);
  const phase1 = runSpecialistPhase(world, sideA, sideB, false, null, encounterPos);
  if (phase1.swappedSubs === true) {
    // Double Agent: drillers on both subs destroyed; swap ownership
    // including all specialists aboard (including the Double Agent
    // itself). Both subs then continue toward their original
    // destinations under new ownership.
    a.drillers = 0;
    b.drillers = 0;
    swapSubOwnership(world, a, b);
    return {
      aDrillersBefore: aBefore,
      bDrillersBefore: bBefore,
      winner: 'tie',
      survivingDrillers: 0,
    };
  }
  if (phase1.martyrFired === true) {
    // martyrBlast() already removed both subs (if they were in the
    // radius — they always are, since the centre is their meet point)
    // and destroyed their specialists. Nothing left to do.
    return {
      aDrillersBefore: aBefore,
      bDrillersBefore: bBefore,
      winner: 'tie',
      survivingDrillers: 0,
    };
  }
  if (phase1.ended) {
    // Reserved for non-Martyr Phase-1 terminators in sub-vs-sub —
    // currently unreachable beyond Double Agent (handled above).
    a.drillers = 0;
    b.drillers = 0;
    removeSub(world, a);
    removeSub(world, b);
    return {
      aDrillersBefore: aBefore,
      bDrillersBefore: bBefore,
      winner: 'tie',
      survivingDrillers: 0,
    };
  }

  // Snapshot Saboteur presence on each side. The post-driller phase
  // below may capture or destroy these specialists; we need the
  // pre-driller "did this side bring a Saboteur?" answer to decide if
  // the survivor (if any) gets sent home.
  const aHadSab = sideA.specialists.some((s) => s.kind === 'saboteur');
  const bHadSab = sideB.specialists.some((s) => s.kind === 'saboteur');

  // Phase 3: driller (no shield in sub-vs-sub).
  let winner: 'a' | 'b' | 'tie';
  let surviving = 0;

  if (sideA.drillers > sideB.drillers) {
    winner = 'a';
    surviving = sideA.drillers - sideB.drillers;
    sideA.drillersDestroyed += sideB.drillers;
    sideB.drillersDestroyed += sideB.drillers;
    sideA.drillers = surviving;
    sideB.drillers = 0;
  } else if (sideB.drillers > sideA.drillers) {
    winner = 'b';
    surviving = sideB.drillers - sideA.drillers;
    sideB.drillersDestroyed += sideA.drillers;
    sideA.drillersDestroyed += sideA.drillers;
    sideB.drillers = surviving;
    sideA.drillers = 0;
  } else {
    winner = 'tie';
    sideA.drillersDestroyed += sideA.drillers;
    sideB.drillersDestroyed += sideB.drillers;
    sideA.drillers = 0;
    sideB.drillers = 0;
  }

  // Track which side's saboteur (if any) ends up firing. The
  // surviving sub gets redirected to *its own* owner's nearest
  // outpost — the saboteur's effect is to deny the attacker their
  // intended target, not to convert it into a friendly arrival.
  let saboteurFired: 'a-redirected' | 'b-redirected' | null = null;
  if (winner === 'a') {
    applyEngineerRestore(world, sideA, true);
    surviving = sideA.drillers;
    a.drillers = surviving;
    // Capture: sideB's surviving specialists become captives of
    // winner's nearest friendly outpost.
    const captureSite = nearestOwnedOutpost(world, a.ownerId, a);
    capturePhase(world, sideB, a.ownerId, captureSite, captureSite);
    removeSub(world, b);
    // Post-driller Saboteur: if the losing side (b) brought a
    // Saboteur, the winning sub (a) is redirected to a's own
    // nearest outpost — sent home with its surviving drillers and
    // captives instead of completing its intended mission.
    if (bHadSab) {
      redirectToNearestFriendly(world, a, a.ownerId);
      saboteurFired = 'a-redirected';
    }
  } else if (winner === 'b') {
    applyEngineerRestore(world, sideB, true);
    surviving = sideB.drillers;
    b.drillers = surviving;
    const captureSite = nearestOwnedOutpost(world, b.ownerId, b);
    capturePhase(world, sideA, b.ownerId, captureSite, captureSite);
    removeSub(world, a);
    if (aHadSab) {
      redirectToNearestFriendly(world, b, b.ownerId);
      saboteurFired = 'b-redirected';
    }
  } else {
    // Tie: both subs destroyed; surviving specialists vanish (they're
    // on subs that no longer exist). The spec says specialists return
    // to nearest friendly outpost on a tie — implement that.
    sendSpecialistsHome(world, sideA, a.ownerId, a);
    sendSpecialistsHome(world, sideB, b.ownerId, b);
    removeSub(world, a);
    removeSub(world, b);
  }
  const aName = playerNameFor(world, a.ownerId);
  const bName = playerNameFor(world, b.ownerId);
  const summary =
    saboteurFired !== null
      ? `saboteur sent ${saboteurFired === 'a-redirected' ? aName : bName}'s sub home (${surviving} drillers)`
      : winner === 'tie'
        ? `${aName} vs ${bName} — both subs lost`
        : `${winner === 'a' ? aName : bName} won the encounter · ${surviving} drillers`;
  emitEvent(world, 'combat_sub_vs_sub', [a.ownerId, b.ownerId], summary, encounterPos);
  return {
    aDrillersBefore: aBefore,
    bDrillersBefore: bBefore,
    winner,
    survivingDrillers: surviving,
  };
}

function swapSubOwnership(world: World, a: Sub, b: Sub): void {
  const aOwner = a.ownerId;
  const bOwner = b.ownerId;
  (a as { ownerId: PlayerId }).ownerId = bOwner;
  (b as { ownerId: PlayerId }).ownerId = aOwner;
  for (const s of world.specialists) {
    if (s.location.kind !== 'sub') continue;
    if (s.location.id === a.id) {
      (s as { ownerId: PlayerId }).ownerId = bOwner;
    } else if (s.location.id === b.id) {
      (s as { ownerId: PlayerId }).ownerId = aOwner;
    }
  }
}

function removeSub(world: World, sub: Sub): void {
  const idx = world.subs.indexOf(sub);
  if (idx >= 0) world.subs.splice(idx, 1);
}

function nearestOwnedOutpost(
  world: World,
  ownerId: PlayerId,
  sub: Sub,
): Outpost | null {
  // Use the sub's CURRENT position, not its launch source. For a
  // pirate that fought halfway across the map, the launch source is
  // long irrelevant — the capture site / return-home outpost should
  // be near where the sub is RIGHT NOW. Also use the torus-aware
  // distSquared so the picked outpost is the genuinely closest one,
  // not just closest in raw coordinates.
  const fromPos = subPosition(world, sub, world.time);
  let best: Outpost | null = null;
  let bestSq = Number.POSITIVE_INFINITY;
  for (const o of world.outposts) {
    if (o.ownerId !== ownerId) continue;
    const d = distSquared(o.pos, fromPos);
    if (d < bestSq) {
      best = o;
      bestSq = d;
    }
  }
  return best;
}

/**
 * Saboteur effect: redirect `sub` to the nearest outpost owned by
 * `redirectingOwner`. Measured from the sub's current position.
 * Recomputes arrivalAt at the sub's current speed.
 */
function redirectToNearestFriendly(
  world: World,
  sub: Sub,
  redirectingOwner: PlayerId,
): void {
  const candidates = world.outposts.filter((o) => o.ownerId === redirectingOwner);
  if (candidates.length === 0) return;
  const now = world.time;
  // Use the sub's TRUE current position — subPosition handles all
  // phases (in-flight, mid-chase, mid-return) correctly. Previous
  // version interpolated along the original source→dest line, which
  // was wrong for any sub whose trajectory had already been changed
  // (chase, prior redirect, etc.).
  const fromPos = subPosition(world, sub, now);
  let best: Outpost | null = null;
  let bestSq = Number.POSITIVE_INFINITY;
  for (const o of candidates) {
    const d = distSquared(o.pos, fromPos);
    if (d < bestSq) {
      best = o;
      bestSq = d;
    }
  }
  if (best === null) return;
  sub.destinationId = best.id;
  // Encode the new trajectory via a chase struct in 'returning'
  // phase. This is the cleanest way to make subPosition interpolate
  // from "current pos at now" to "best outpost at arrivalAt" without
  // mucking with sub.sourceId. The PixiMap renderer treats
  // 'returning' chases as solid lines, which is the right visual
  // for a saboteur-redirected sub.
  sub.chase = {
    targetSubId: sub.chase?.targetSubId ?? sub.id,
    chaseFromPos: fromPos,
    interceptPos: best.pos,
    chaseStartAt: now,
    phase: 'returning',
  };
  // Recompute arrivalAt from current position at current speed. Keep
  // the existing speedMultiplier (Saboteur doesn't change crew).
  const remaining = Math.sqrt(bestSq);
  const travelMs = Math.round((remaining * 36_000) / Math.max(0.01, sub.speedMultiplier));
  sub.arrivalAt = now + travelMs;
}

function sendSpecialistsHome(
  world: World,
  side: Side,
  ownerId: PlayerId,
  sub: Sub,
): void {
  const home = nearestOwnedOutpost(world, ownerId, sub);
  for (const s of side.specialists) {
    if (home !== null) {
      s.location = { kind: 'outpost', id: home.id };
    } else {
      // No friendly outpost left — specialist is lost.
      const idx = world.specialists.indexOf(s);
      if (idx >= 0) world.specialists.splice(idx, 1);
    }
  }
}
