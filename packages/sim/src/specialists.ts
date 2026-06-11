import type {
  OutpostId,
  PlayerId,
  Specialist,
  SpecialistId,
  SpecialistKind,
  SpecialistLocation,
  Sub,
  SubId,
  World,
} from './types.js';

/**
 * Specialist roster — data model + immutable metadata table.
 *
 * Phase 6a: types, the canonical SPECIALIST_META table, and queries.
 * No behaviour yet (hire scheduler, combat effects, captives, etc.
 * land in later sub-phases). See docs/05_specialists.md for the
 * authoritative spec.
 */

// ---------- Categories & locations ----------

export type SpecialistCategory = 'royalty' | 'offensive' | 'defensive' | 'other';

/**
 * Where this specialist's *passive ability* fires. This is **not** a
 * physical movement restriction — every specialist (other than a
 * captive, who is locked until released) can ride a sub between
 * outposts. `abilityScope` only describes the location predicate
 * encoded in the spec text: e.g. Sentry "fires while at an outpost",
 * Helmsman "speeds up the sub he's carried on", etc. Combat-only
 * specialists (Assassin, Martyr, Lieutenant…) report `'both'`
 * because their effect doesn't depend on being at one place or the
 * other — it fires from wherever the unit happens to be when combat
 * engages.
 *
 * The validation cost of this field is zero — it's a documentation
 * marker used by UI hints, not a placement filter.
 */
export type AbilityScope = 'sub' | 'outpost' | 'both';

/**
 * When this specialist's effect resolves during combat. `null` means
 * the specialist has no in-combat effect (passive or out-of-combat
 * only). See docs/05_specialists.md §4 for the full phase table.
 *
 *   - 'specialist': in Phase 1, in CP order (uses `combatPriority`).
 *   - 'post-spec':  after Phase 1 / CP 7, before Phase 2 (General, King).
 *   - 'post-driller': after Phase 3, before Phase 4 (Saboteur, Engineer).
 */
export type CombatTiming = 'specialist' | 'post-spec' | 'post-driller';

// ---------- Metadata table ----------

export interface SpecialistMeta {
  readonly kind: SpecialistKind;
  readonly category: SpecialistCategory;
  /** Appears in the random hire roster? Promoted forms and Royalty are false. */
  readonly hireable: boolean;
  /** Promoted form (null if terminal or already promoted). */
  readonly promotesTo: SpecialistKind | null;
  /** Base form (null if not a promoted form). */
  readonly promotedFrom: SpecialistKind | null;
  /**
   * Where the specialist's passive ability fires. Documentation only —
   * does **not** restrict where the specialist may be located (every
   * non-captive specialist can ride subs freely).
   */
  readonly abilityScope: AbilityScope;
  /** Hard cap on **active** instances per player; null = uncapped. Captives don't count. */
  readonly cap: number | null;
  /** Combat priority (1=first, 7=last); null if no specialist-phase effect. */
  readonly combatPriority: number | null;
  /** When in the combat pipeline the effect resolves; null if no combat effect. */
  readonly combatTiming: CombatTiming | null;
}

const META: Record<SpecialistKind, SpecialistMeta> = {
  // ---------- Royalty ----------
  queen: {
    kind: 'queen',
    category: 'royalty',
    hireable: false,
    promotesTo: null,
    promotedFrom: null,
    abilityScope: 'both',
    cap: 1,
    combatPriority: null,
    combatTiming: null,
  },
  princess: {
    kind: 'princess',
    category: 'royalty',
    hireable: false,
    promotesTo: 'queen', // automatic on Queen-loss, handled in Phase 6b
    promotedFrom: null,
    abilityScope: 'outpost',
    cap: null,
    combatPriority: null,
    combatTiming: null,
  },

  // ---------- Offensive (hireable: 7) ----------
  martyr: {
    kind: 'martyr', category: 'offensive', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'both', cap: null,
    combatPriority: 1, combatTiming: 'specialist',
  },
  thief: {
    kind: 'thief', category: 'offensive', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'sub', cap: null,
    combatPriority: 4, combatTiming: 'specialist',
  },
  infiltrator: {
    kind: 'infiltrator', category: 'offensive', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'sub', cap: null,
    combatPriority: 4, combatTiming: 'specialist',
  },
  assassin: {
    kind: 'assassin', category: 'offensive', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'both', cap: 2,
    combatPriority: 6, combatTiming: 'specialist',
  },
  lieutenant: {
    kind: 'lieutenant', category: 'offensive', hireable: true,
    promotesTo: 'general', promotedFrom: null,
    abilityScope: 'both', cap: null,
    combatPriority: 7, combatTiming: 'specialist',
  },
  sentry: {
    kind: 'sentry', category: 'offensive', hireable: true,
    promotesTo: 'war_hero', promotedFrom: null,
    abilityScope: 'outpost', cap: null,
    combatPriority: 7, combatTiming: 'specialist',
  },
  pirate: {
    kind: 'pirate', category: 'offensive', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'sub', cap: null,
    combatPriority: null, combatTiming: null, // enables encounters; no special CP
  },

  // ---------- Offensive (promoted) ----------
  general: {
    kind: 'general', category: 'offensive', hireable: false,
    promotesTo: null, promotedFrom: 'lieutenant',
    abilityScope: 'both', cap: null,
    combatPriority: null, combatTiming: 'post-spec',
  },
  war_hero: {
    kind: 'war_hero', category: 'offensive', hireable: false,
    promotesTo: null, promotedFrom: 'sentry',
    abilityScope: 'both', cap: null,
    combatPriority: 7, combatTiming: 'specialist',
  },

  // ---------- Defensive (hireable: 6) ----------
  revered_elder: {
    kind: 'revered_elder', category: 'defensive', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'both', cap: null,
    combatPriority: 2, combatTiming: 'specialist',
  },
  saboteur: {
    kind: 'saboteur', category: 'defensive', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'sub', cap: 2,
    combatPriority: 3, combatTiming: 'post-driller',
  },
  smuggler: {
    kind: 'smuggler', category: 'defensive', hireable: true,
    promotesTo: 'tycoon', promotedFrom: null,
    abilityScope: 'sub', cap: null,
    combatPriority: null, combatTiming: null,
  },
  inspector: {
    kind: 'inspector', category: 'defensive', hireable: true,
    promotesTo: 'security_chief', promotedFrom: null,
    abilityScope: 'outpost', cap: null,
    combatPriority: null, combatTiming: null,
  },
  double_agent: {
    kind: 'double_agent', category: 'defensive', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'sub', cap: null,
    combatPriority: 5, combatTiming: 'specialist',
  },
  diplomat: {
    kind: 'diplomat', category: 'defensive', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'outpost', cap: null,
    combatPriority: null, combatTiming: null,
  },

  // ---------- Defensive (promoted) ----------
  tycoon: {
    kind: 'tycoon', category: 'defensive', hireable: false,
    promotesTo: null, promotedFrom: 'smuggler',
    abilityScope: 'both', cap: null,
    combatPriority: null, combatTiming: null,
  },
  security_chief: {
    kind: 'security_chief', category: 'defensive', hireable: false,
    promotesTo: null, promotedFrom: 'inspector',
    abilityScope: 'both', cap: null,
    combatPriority: null, combatTiming: null,
  },

  // ---------- Other (hireable: 6) ----------
  intelligence_officer: {
    kind: 'intelligence_officer', category: 'other', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'both', cap: null,
    combatPriority: null, combatTiming: null,
  },
  tinkerer: {
    kind: 'tinkerer', category: 'other', hireable: true,
    promotesTo: 'minister_of_energy', promotedFrom: null,
    abilityScope: 'outpost', cap: null,
    combatPriority: null, combatTiming: null,
  },
  foreman: {
    kind: 'foreman', category: 'other', hireable: true,
    promotesTo: 'engineer', promotedFrom: null,
    abilityScope: 'outpost', cap: null,
    combatPriority: null, combatTiming: null,
  },
  hypnotist: {
    kind: 'hypnotist', category: 'other', hireable: true,
    promotesTo: 'king', promotedFrom: null,
    abilityScope: 'outpost', cap: null,
    combatPriority: null, combatTiming: null,
  },
  navigator: {
    kind: 'navigator', category: 'other', hireable: true,
    promotesTo: 'admiral', promotedFrom: null,
    abilityScope: 'sub', cap: null,
    combatPriority: null, combatTiming: null,
  },
  helmsman: {
    kind: 'helmsman', category: 'other', hireable: true,
    promotesTo: null, promotedFrom: null,
    abilityScope: 'sub', cap: null,
    combatPriority: null, combatTiming: null,
  },

  // ---------- Other (promoted) ----------
  minister_of_energy: {
    kind: 'minister_of_energy', category: 'other', hireable: false,
    promotesTo: null, promotedFrom: 'tinkerer',
    abilityScope: 'both', cap: null,
    combatPriority: null, combatTiming: null,
  },
  engineer: {
    kind: 'engineer', category: 'other', hireable: false,
    promotesTo: null, promotedFrom: 'foreman',
    abilityScope: 'both', cap: null,
    combatPriority: null, combatTiming: 'post-driller',
  },
  king: {
    kind: 'king', category: 'other', hireable: false,
    promotesTo: null, promotedFrom: 'hypnotist',
    abilityScope: 'both', cap: null,
    combatPriority: null, combatTiming: 'post-spec',
  },
  admiral: {
    kind: 'admiral', category: 'other', hireable: false,
    promotesTo: null, promotedFrom: 'navigator',
    abilityScope: 'sub', cap: null,
    combatPriority: null, combatTiming: null,
  },
};

/** Read-only access to the metadata table. */
export function specialistMeta(kind: SpecialistKind): SpecialistMeta {
  return META[kind];
}

/** Iterate all kinds — useful for hire-roster generation and tests. */
export const ALL_SPECIALIST_KINDS: readonly SpecialistKind[] = Object.keys(META) as SpecialistKind[];

export const HIREABLE_KINDS: readonly SpecialistKind[] = ALL_SPECIALIST_KINDS.filter(
  (k) => META[k].hireable,
);

export const HIREABLE_BY_CATEGORY: Readonly<Record<Exclude<SpecialistCategory, 'royalty'>, readonly SpecialistKind[]>> = {
  offensive: HIREABLE_KINDS.filter((k) => META[k].category === 'offensive'),
  defensive: HIREABLE_KINDS.filter((k) => META[k].category === 'defensive'),
  other: HIREABLE_KINDS.filter((k) => META[k].category === 'other'),
};

// ---------- Construction ----------

/**
 * Append a new specialist to the world. Returns the created specialist
 * so callers can use its id immediately. World gen, hire dispatch, and
 * Hypnotist conversion all funnel through here so id assignment stays
 * monotonic and deterministic.
 */
export function createSpecialist(
  world: World,
  ownerId: PlayerId,
  kind: SpecialistKind,
  location: SpecialistLocation,
): Specialist {
  // Enforce at-most-one-active-Queen invariant directly here so even
  // callers that bypass grantQueen / acquireSpecialist (in tests,
  // scripts, custom scenarios) can't mint a second active Queen for
  // the same player. The newly-created Queen is auto-demoted to
  // Princess in that case.
  let effectiveKind = kind;
  if (kind === 'queen') {
    for (const other of world.specialists) {
      if (other.kind !== 'queen') continue;
      if (other.state !== 'active') continue;
      if (other.ownerId !== ownerId) continue;
      effectiveKind = 'princess';
      break;
    }
  }
  const id = world.nextSpecialistId as SpecialistId;
  world.nextSpecialistId += 1;
  const spec: Specialist = {
    id,
    ownerId,
    kind: effectiveKind,
    location,
    state: 'active',
  };
  world.specialists.push(spec);
  return spec;
}

// ---------- Queries ----------

/** All specialists currently at the given outpost (active or captive). */
export function specialistsAtOutpost(world: World, outpostId: OutpostId): Specialist[] {
  return world.specialists.filter(
    (s) => s.location.kind === 'outpost' && s.location.id === outpostId,
  );
}

/**
 * Build a `outpostId → Specialist[]` index in a single O(specialists)
 * pass. Hot-loop callers (electricalOutput, factoryProductionFor,
 * sonarRange) used to call `specialistsAtOutpost` once per outpost
 * (each itself O(specialists)); this version is O(specialists + outposts)
 * end-to-end. Caller is responsible for re-building when specialist
 * locations change.
 */
export function specialistsByOutpostIndex(
  world: World,
): Map<number, Specialist[]> {
  const map = new Map<number, Specialist[]>();
  for (const s of world.specialists) {
    if (s.location.kind !== 'outpost') continue;
    const key = s.location.id as unknown as number;
    let bucket = map.get(key);
    if (bucket === undefined) {
      bucket = [];
      map.set(key, bucket);
    }
    bucket.push(s);
  }
  return map;
}

/** All specialists currently aboard the given sub. */
export function specialistsOnSub(world: World, subId: SubId): Specialist[] {
  return world.specialists.filter(
    (s) => s.location.kind === 'sub' && s.location.id === subId,
  );
}

/** All **active** (non-captive) specialists owned by `ownerId`. */
export function activeSpecialistsOf(world: World, ownerId: PlayerId): Specialist[] {
  return world.specialists.filter(
    (s) => s.ownerId === ownerId && s.state === 'active',
  );
}

/** Number of **active** specialists of `kind` owned by `ownerId`. */
export function activeCountOf(world: World, ownerId: PlayerId, kind: SpecialistKind): number {
  let n = 0;
  for (const s of world.specialists) {
    if (s.ownerId === ownerId && s.kind === kind && s.state === 'active') n += 1;
  }
  return n;
}

/** True if `ownerId` is at the hard cap for `kind`. Always false for uncapped kinds. */
export function isCapReached(world: World, ownerId: PlayerId, kind: SpecialistKind): boolean {
  const cap = META[kind].cap;
  if (cap === null) return false;
  return activeCountOf(world, ownerId, kind) >= cap;
}

/** Convenience: this player's active Queen, if any. */
export function activeQueenOf(world: World, ownerId: PlayerId): Specialist | null {
  for (const s of world.specialists) {
    if (s.ownerId === ownerId && s.kind === 'queen' && s.state === 'active') return s;
  }
  return null;
}

/**
 * Returns the outpost id where this player's active Queen currently
 * sits, or null if she's on a sub / captured / dead. Useful for "find
 * my Queen" UI affordances and for tests that want to exclude the
 * Queen's outpost from a search.
 */
export function queenOutpostOf(world: World, ownerId: PlayerId): OutpostId | null {
  const q = activeQueenOf(world, ownerId);
  if (q === null) return null;
  return q.location.kind === 'outpost' ? q.location.id : null;
}

/** True if any player's active Queen is currently at this outpost. */
export function hasQueenAt(world: World, outpostId: OutpostId): boolean {
  for (const s of world.specialists) {
    if (s.kind !== 'queen') continue;
    if (s.state !== 'active') continue;
    if (s.location.kind === 'outpost' && s.location.id === outpostId) return true;
  }
  return false;
}

/** True if this kind has any in-combat effect (any of the three combat slots). */
export function hasCombatEffect(kind: SpecialistKind): boolean {
  return META[kind].combatTiming !== null;
}

/**
 * Order key for specialist phase resolution. Smaller fires earlier.
 * Returns `Infinity` for specialists that have no specialist-phase
 * effect (those resolve in post-spec or post-driller slots instead).
 */
export function specialistPhaseOrder(kind: SpecialistKind): number {
  const meta = META[kind];
  if (meta.combatTiming !== 'specialist') return Number.POSITIVE_INFINITY;
  return meta.combatPriority ?? Number.POSITIVE_INFINITY;
}

// ---------- Convenience type guards ----------

export function isAtSub(s: Specialist, subId: SubId): boolean {
  return s.location.kind === 'sub' && s.location.id === subId;
}

export function isAtOutpost(s: Specialist, outpostId: OutpostId): boolean {
  return s.location.kind === 'outpost' && s.location.id === outpostId;
}

// Re-export the Sub type to make it easy for callers to mention "Sub"
// without having to import from two modules.
export type { Sub };
