/**
 * Core sim types. Everything here is data — no behaviour, no I/O.
 *
 * Brand-typed IDs prevent accidental cross-domain mixups (e.g. passing a
 * PlayerId where an OutpostId is expected).
 */

export type PlayerId = number & { readonly __brand: 'PlayerId' };
export type OutpostId = number & { readonly __brand: 'OutpostId' };
export type SubId = number & { readonly __brand: 'SubId' };
export type QueuedOrderId = number & { readonly __brand: 'QueuedOrderId' };
export type SpecialistId = number & { readonly __brand: 'SpecialistId' };
export type PendingCommandId = number & { readonly __brand: 'PendingCommandId' };

/**
 * The 29 specialist kinds. Royalty: queen, princess. Promoted forms:
 * general, war_hero, tycoon, security_chief, minister_of_energy,
 * engineer, king, admiral. Everything else is hireable from the wheel.
 * See docs/05_specialists.md for full details.
 */
export type SpecialistKind =
  | 'queen' | 'princess'
  | 'pirate' | 'lieutenant' | 'general' | 'sentry' | 'war_hero'
  | 'assassin' | 'thief' | 'infiltrator' | 'martyr'
  | 'revered_elder' | 'saboteur' | 'smuggler' | 'tycoon' | 'inspector'
  | 'security_chief' | 'double_agent' | 'diplomat'
  | 'intelligence_officer' | 'tinkerer' | 'minister_of_energy'
  | 'foreman' | 'engineer' | 'hypnotist' | 'king'
  | 'navigator' | 'admiral' | 'helmsman';

/** Where a specialist is physically located. */
export type SpecialistLocation =
  | { readonly kind: 'outpost'; readonly id: OutpostId }
  | { readonly kind: 'sub'; readonly id: SubId };

/**
 * Active specialists apply their abilities normally. Captive
 * specialists are held by another player as a result of losing
 * combat — they apply no abilities, can be released by a Diplomat,
 * and can be converted by a Hypnotist. See docs/05_specialists.md §6.
 */
export interface Specialist {
  readonly id: SpecialistId;
  /**
   * Current owning player. Mutable because Hypnotist conversion and
   * Double Agent sub swaps both transfer ownership. The "original"
   * owner pre-capture is recoverable from captive state if needed.
   */
  ownerId: PlayerId;
  kind: SpecialistKind; // mutable for promotion
  location: SpecialistLocation; // mutable (Hypnotist convert keeps location, etc.)
  state: 'active' | 'captive';
  /** Set only when `state === 'captive'`. The player holding this captive. */
  captiveOf?: PlayerId;
  /**
   * Next scheduled passive action time (ms). Used by Sentry for its
   * 2-hour attrition cadence. Undefined for kinds with no scheduled
   * passive.
   */
  nextActionAt?: number;
}

/**
 * Map coordinate. Integer-valued; the playing field is `0..MAP_SIZE` on
 * each axis. We use integers to keep position math exactly reproducible
 * across server and client.
 */
export interface Coord {
  readonly x: number;
  readonly y: number;
}

/** Total playing-field extent on each axis. */
export const MAP_SIZE = 10_000;

// ---------- Time constants (sim time is integer ms) ----------

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// ---------- Production constants (per docs/03_drillers_production.md) ----------

/** A Factory completes a production cycle every 8 hours. */
export const FACTORY_CYCLE_MS = 8 * HOUR_MS;

/** Drillers produced per Factory per cycle (base, before specialist mods). */
export const FACTORY_DRILLERS_PER_CYCLE = 6;

/** Electrical output contributed by the Queen's home outpost. */
export const QUEEN_ELECTRICAL_OUTPUT = 150;

/** Electrical output contributed by each Generator outpost. */
export const GENERATOR_ELECTRICAL_OUTPUT = 50;

/**
 * Sentinel `nextProductionAt` value for outposts that do not produce
 * drillers (Generators, captured Mines, dormants). Number.MAX_SAFE_INTEGER
 * is far beyond any plausible game time so the tick loop's `time >=
 * nextProductionAt` check will never fire for these.
 */
export const NEVER_PRODUCE = Number.MAX_SAFE_INTEGER;

// ---------- Hire constants (per docs/05_specialists.md §1) ----------

/** Time of the first specialist hire for every player. */
export const HIRE_INITIAL_MS = 4 * HOUR_MS;

/** Cadence between specialist hires after the first. */
export const HIRE_CADENCE_MS = 18 * HOUR_MS;

// ---------- Sub constants (per docs/02_subs.md) ----------

/**
 * Delay between issuing a launch order and the sub physically departing
 * its source outpost. During this window a player may (in later phases)
 * modify cargo or cancel.
 */
export const LAUNCH_DELAY_MS = 10 * MINUTE_MS;

/**
 * Delay between issuing a deferable command (drill, hire, promote,
 * redirect, pirate-target, chat) and it taking effect. The player can
 * cancel during this window. Matches LAUNCH_DELAY_MS by design — the
 * rulebook describes a single uniform "10-minute cancel" semantics.
 */
export const PENDING_DELAY_MS = 10 * MINUTE_MS;

/**
 * Base sub travel time per unit of map distance, in milliseconds.
 *
 * Chosen so a typical neighbour-to-neighbour hop (~1000 map units) takes
 * ~10 hours — close to the "~12 hours" the designers cite as a typical
 * short trip. Specialists that modify speed (Helmsman, Admiral, etc.)
 * land in Phase 6+ and will multiply this base.
 */
export const BASE_MS_PER_UNIT = 36_000; // 100 units / hour

// ---------- Shield constants (per docs/07_shields_sonar_visibility.md) ----------

/** Time for a shield to recharge from 0 to its max charge. */
export const SHIELD_RECHARGE_TIME_MS = 48 * HOUR_MS;

// ---------- Sonar / visibility constants ----------

/**
 * Default sonar radius per outpost (map units). With MAP_SIZE = 10000
 * and ~10 outposts per player slot, ~1500 unit sonar gives each outpost
 * 1–3 neighbours of overlap — feels "tactical" not omniscient.
 *
 * Specialist modifiers (Princess +50%, Intelligence Officer +25%) land
 * in Phase 6+ and will multiply this base.
 */
export const SONAR_RANGE = 1500;

// ---------- Mining & victory constants (per docs/06_mining_neptunium.md) ----------

/**
 * Neptunium required to win, in thousandths-of-a-kilogram. 200 kg = 200_000.
 */
export const NEPTUNIUM_VICTORY_THOUSANDTHS = 200_000;

/**
 * Fraction of Neptunium the previous owner loses when one of their
 * Mines is captured by combat. Per docs: 20%, rounded up.
 */
export const MINE_CAPTURE_PENALTY_NUMERATOR = 1;
export const MINE_CAPTURE_PENALTY_DENOMINATOR = 5;

export type OutpostKind = 'factory' | 'generator' | 'mine';
export type ShieldKind = 'weak' | 'strong';

/**
 * Maximum shield charge by kind. Per docs/01_outposts.md.
 */
export const SHIELD_MAX: Record<ShieldKind, number> = {
  weak: 10,
  strong: 20,
};

/** Drillers per starting non-Queen outpost. */
export const STARTING_DRILLERS = 40;

/** Total outposts owned by each player at game start (1 Queen + 4 standard). */
export const STARTING_OUTPOSTS_PER_PLAYER = 5;

/** Outposts placed on the map per player slot (5 owned + 5 dormant). */
export const TOTAL_OUTPOSTS_PER_PLAYER_SLOT = 10;

export interface Outpost {
  readonly id: OutpostId;
  readonly pos: Coord;
  readonly name: string;
  kind: OutpostKind;
  shieldKind: ShieldKind;
  ownerId: PlayerId | null;
  drillers: number;
  shieldCharge: number;
  /**
   * Sim time (ms) at which this outpost next runs its production cycle.
   * For Factories this is the next 8-hour driller-production tick. For
   * non-producing outposts (Generators, Mines, dormants) this is set to
   * `NEVER_PRODUCE` so it is naturally ignored.
   */
  nextProductionAt: number;
  /**
   * Sim time at which `shieldCharge` was last set. Combined with
   * shieldKind's max charge this lets us compute the current shield
   * level at any future moment without per-tick increments.
   */
  shieldChargedSince: number;
  /**
   * Set on filtered per-player views: this outpost appears because of
   * global mine visibility, not because the viewer can actually see it
   * with sonar. Garrison/shield fields are placeholder zeros in this
   * case — the client renders a dim "mine-info-only" glyph. Absent on
   * the authoritative world.
   */
  fogged?: boolean;
}

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  /**
   * Neptunium accumulated, stored as thousandths-of-a-kilogram (an
   * integer for determinism). 200_000 = 200 kg = victory threshold.
   *
   * This is a *checkpoint* value, not the live total. The live total
   * accumulates over time at the current `mines × outposts` rate.
   * Use `liveNeptuniumThousandths()` to query the live value.
   */
  neptuniumMg: number;
  /** Sim time (ms) at which `neptuniumMg` was last updated. */
  neptuniumLastAt: number;
  /**
   * Total number of mines this player has ever drilled. Used for the
   * escalating drill cost ladder. Does not decrease when mines are
   * lost.
   */
  minesDrilled: number;
  /**
   * Sim time at which this player's next specialist hire becomes
   * eligible. The hire only fires when the Queen is at one of the
   * player's outposts. See docs/05_specialists.md §1.
   */
  nextHireAt: number;
  /**
   * Per-player secret seed for the hire-roster RNG, derived from the
   * world seed once at world-gen. Lives on the Player (instead of
   * being recomputed from `world.seed` at call time) so that
   * `viewForPlayer` can redact both `world.seed` and other players'
   * `hireSeed` — otherwise any client could precompute every
   * opponent's current and future hire offers.
   */
  hireSeed: number;
  /**
   * Monotonic count of hires the player has consumed. Drives the
   * deterministic hire RNG.
   */
  hireIndex: number;
  /**
   * Kinds offered in this player's previous hire. Excluded from the
   * next hire's candidate pool (rulebook cooldown rule).
   */
  lastOfferedKinds: SpecialistKind[];
  /**
   * Set to true when the player is eliminated (Queen captured/killed
   * with no Princess to promote). All their outposts go dormant; all
   * subs and specialists are removed; the player remains in the
   * roster as a tombstone for chat history etc.
   */
  eliminated: boolean;
  /**
   * Ids of outposts this player has ever observed (currently or in
   * the past). Per docs/07: "first sight locks the position on the
   * map forever" — once discovered, an outpost remains visible to
   * this player as a fogged dot (current ownership colour) even
   * after they lose sonar on it. Mines are added automatically the
   * moment they're drilled (they have global visibility), so this
   * set is also the union of "ever seen + every mine".
   */
  knownOutposts: number[];
}

export interface Sub {
  readonly id: SubId;
  ownerId: PlayerId; // mutable: Double Agent swaps ownership in sub-vs-sub combat
  readonly sourceId: OutpostId;
  destinationId: OutpostId; // mutable for Navigator redirect / Saboteur
  /** Sim time (ms) at which the sub physically departs its source. */
  readonly launchAt: number;
  /** Sim time (ms) at which the sub arrives at its destination. */
  arrivalAt: number; // mutable for speed changes (Smuggler) and redirects
  /** Drillers aboard. Deducted from the source at launch-order time. */
  drillers: number;
  /**
   * Composite speed multiplier in effect for this sub. Recomputed on
   * launch and any subsequent change (Smuggler destination ownership
   * flip, Pirate state machine in Phase 6g). See
   * docs/05_specialists.md §10.
   */
  speedMultiplier: number;
  /**
   * Gift recipient. When set, and the sub arrives at an outpost owned
   * by this player, the cargo transfers without combat. If the
   * destination is owned by anyone else (or dormant), the gift status
   * falls through to the normal arrival path.
   */
  readonly giftTo?: PlayerId;
  /**
   * Ids of subs this sub has already mirror-route-encountered. Used to
   * prevent the same pair from re-triggering combat at the same meet
   * time after a Double Agent swap or a winner continuing on its
   * corridor (the geometric formula would otherwise re-fire forever).
   */
  encountered?: number[];
  /**
   * Pirate chase state. When set, this sub is hunting a specific
   * enemy sub instead of going to a destination outpost. The position
   * interpolation runs from `chaseFromPos` toward `interceptPos` over
   * `[chaseStartAt, arrivalAt]`. On `arrivalAt` the tick loop fires
   * sub-vs-sub combat against the target instead of `arriveSub`. Once
   * the chase resolves, the surviving pirate's `chase` is cleared and
   * it auto-routes to its nearest friendly outpost at 4× speed.
   */
  chase?: {
    readonly targetSubId: SubId;
    readonly interceptPos: Coord;
    readonly chaseFromPos: Coord;
    readonly chaseStartAt: number;
    phase: 'chasing' | 'returning';
  };
  /**
   * Mid-flight leg anchor. Set whenever the sub's trajectory changes
   * in flight (Navigator redirect, Smuggler speed flip on destination
   * capture): position interpolation runs from `legFromPos` toward the
   * destination over `[legStartAt, arrivalAt]` instead of from the
   * source outpost over `[launchAt, arrivalAt]`. Without this anchor a
   * redirect teleports the sub onto the source→new-destination line —
   * the course change must visibly pivot from where the sub actually
   * was. `chase` (when set) takes precedence.
   */
  legFromPos?: Coord;
  legStartAt?: number;
}

/**
 * Time-Machine queued orders — issued in advance, executed when the
 * sim clock reaches `executeAt`. Treated equivalently to a fresh
 * player-issued order at that moment: the same 10-min launch delay,
 * the same validations.
 *
 * Invalid orders at execute time (e.g., the source outpost has been
 * captured) are silently dropped; the docs say "the player is notified"
 * which we'll wire up via a server event log later.
 */
export interface QueuedLaunchOrder {
  readonly kind: 'launch';
  readonly id: QueuedOrderId;
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly sourceId: OutpostId;
  readonly destinationId: OutpostId;
  readonly drillers: number;
  /** Optional gift recipient — same semantics as `LaunchOrder.giftTo`. */
  readonly giftTo?: PlayerId;
  /**
   * Specialists to load when the order fires. Validation happens at
   * dispatch time (each must be active, owned, and physically at the
   * source). The common reason to schedule a specialist that *isn't*
   * at the source yet is "a sub carrying my saboteur arrives at this
   * outpost before my queue executes" — the specialist boards on
   * arrival and is then available when the queue fires.
   */
  readonly specialistIds?: readonly SpecialistId[];
  /**
   * If set, the moment this launch fires it also orders the freshly
   * created sub to Pirate-chase this enemy sub. Lets you schedule
   * "launch a pirate at that sub" in the Time Machine — the chase binds
   * to the new sub's id at dispatch, so no pre-known id is needed.
   */
  readonly pirateTargetSubId?: SubId;
}

export interface QueuedDrillOrder {
  readonly kind: 'drill';
  readonly id: QueuedOrderId;
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly outpostId: OutpostId;
}

export interface QueuedHireOrder {
  readonly kind: 'hire';
  readonly id: QueuedOrderId;
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly specialistKind: SpecialistKind;
}

export interface QueuedPromoteOrder {
  readonly kind: 'promote';
  readonly id: QueuedOrderId;
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly specialistId: SpecialistId;
}

/** Time-Machine future redirect: re-route an in-flight sub (Navigator
 *  aboard) at a chosen future moment. Validated at dispatch time. */
export interface QueuedRedirectOrder {
  readonly kind: 'redirect';
  readonly id: QueuedOrderId;
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly subId: SubId;
  readonly newDestinationId: OutpostId;
}

/** Time-Machine future pirate-target: order a Pirate sub to chase an
 *  enemy sub at a chosen future moment. Validated at dispatch time. */
export interface QueuedPirateTargetOrder {
  readonly kind: 'pirate-target';
  readonly id: QueuedOrderId;
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly subId: SubId;
  readonly targetSubId: SubId;
}

export type QueuedOrder =
  | QueuedLaunchOrder
  | QueuedDrillOrder
  | QueuedHireOrder
  | QueuedPromoteOrder
  | QueuedRedirectOrder
  | QueuedPirateTargetOrder;

/**
 * Deferable player commands. Issued via the UI, sit in
 * `world.pendingCommands` for 10 minutes (PENDING_DELAY_MS) before
 * being applied. The player can cancel any pending command before its
 * `executeAt`. Mirrors the canonical sub-launch pre-launch window for
 * everything else the rulebook describes as cancellable.
 *
 * NOT deferable: `launch` (already handled at the sub level via
 * `sub.launchAt`) and `chat` (instant — the diplomacy UX would break
 * with a 10-min delay).
 */
export type DeferableCommand =
  | {
      kind: 'drill';
      ownerId: PlayerId;
      outpostId: OutpostId;
    }
  | {
      kind: 'hire';
      ownerId: PlayerId;
      specialistKind: SpecialistKind;
    }
  | {
      kind: 'promote';
      ownerId: PlayerId;
      specialistId: SpecialistId;
    }
  | {
      kind: 'redirect';
      ownerId: PlayerId;
      subId: SubId;
      newDestinationId: OutpostId;
    }
  | {
      kind: 'pirate-target';
      ownerId: PlayerId;
      subId: SubId;
      targetSubId: SubId;
    }
  | {
      kind: 'release-captive';
      ownerId: PlayerId;
      specialistId: SpecialistId;
    };

export type DeferableCommandKind = DeferableCommand['kind'];

export interface PendingCommand {
  readonly id: PendingCommandId;
  readonly issuedAt: number;
  readonly executeAt: number;
  readonly ownerId: PlayerId;
  readonly command: DeferableCommand;
}

/**
 * Chat message. `to === null` is a global broadcast; otherwise it's a
 * direct message visible only to `from` and `to`.
 */
export interface ChatMessage {
  readonly id: number;
  readonly from: PlayerId;
  readonly to: PlayerId | null;
  readonly text: string;
  readonly sentAt: number;
}

/** Maximum chat history retained in `World.messages`. */
export const MAX_CHAT_MESSAGES = 200;

// ---------- Sim event log (combat / specialist effects / passive fires) ----------

export type SimEventKind =
  | 'combat_outpost'
  | 'combat_sub_vs_sub'
  | 'martyr_blast'
  | 'sentry_shot'
  | 'captive_released'
  | 'captive_converted'
  | 'pirate_intercept'
  | 'princess_promoted'
  | 'player_eliminated'
  | 'order_failed';

export interface SimEvent {
  readonly id: number;
  readonly at: number; // sim time ms
  readonly kind: SimEventKind;
  /** Players who should see this event surfaced (subset of all players). */
  readonly visibleTo: readonly PlayerId[];
  /** Short human-readable summary for UI rendering. */
  readonly summary: string;
  /** Optional world-coordinate the event "happened at". Used by the
   *  client to pulse the affected outpost / encounter location.
   *  Absent for non-spatial events (e.g. captive_converted at a
   *  hidden outpost). */
  readonly pos?: Coord;
  /** Optional second world-coordinate, used when the event spans two
   *  points (e.g. sentry_shot: sentry outpost → target sub). The
   *  client draws a tracer between `pos` and `pos2`. */
  readonly pos2?: Coord;
}

/** Maximum events retained in `World.events`. */
export const MAX_EVENTS = 100;

export interface World {
  readonly seed: number;
  readonly players: Player[];
  readonly outposts: Outpost[];
  /** In-flight or queued subs. Removed when they arrive. */
  subs: Sub[];
  /** Monotonic ID counter for new subs. */
  nextSubId: number;
  /**
   * All specialists in the world — active and captive. Royalty (Queen,
   * Princess) lives here too. See docs/05_specialists.md.
   */
  specialists: Specialist[];
  /** Monotonic ID counter for new specialists. */
  nextSpecialistId: number;
  /** Time-Machine queue — orders to execute at their `executeAt` time. */
  queuedOrders: QueuedOrder[];
  /** Monotonic ID counter for new queued orders. */
  nextQueuedOrderId: number;
  /** Deferable commands awaiting their 10-minute finalisation. Each
   *  command applies (or is cancelled by its owner) at `executeAt`. */
  pendingCommands: PendingCommand[];
  /** Monotonic ID counter for new pending commands. */
  nextPendingCommandId: number;
  /** Persistent chat log (global + DMs). Bounded to last N messages. */
  messages: ChatMessage[];
  /** Monotonic ID counter for chat messages. */
  nextMessageId: number;
  /** Ring-buffered combat / specialist event log. Bounded to last MAX_EVENTS. */
  events: SimEvent[];
  /** Monotonic ID counter for events. */
  nextEventId: number;
  /** Simulated wall-clock time in milliseconds since game start. */
  time: number;
  /**
   * Player who has won the game, or null if still in progress. Once
   * set, `tick` no-ops — the game is frozen.
   */
  winnerId: PlayerId | null;
}
