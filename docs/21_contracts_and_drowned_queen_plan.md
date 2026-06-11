# 21. Design + Implementation Plan — The Undertow & The Drowned Queen

*Drafted June 2026. Status: **committed plan**, not yet implemented. Funding
is removed. This doc supersedes [docs/16](./16_funding_redesign.md) and
[docs/18](./18_funding_replacement.md): the briefs from doc 18 stand (fill the
funding slot; fix the eliminated-player dead-zone), but both mechanics here
are **original designs**, deliberately distinct from doc 18's Contract Board
(4B) and Council of the Sunken (4D). §8 records why we diverged.*

---

## 0. The two systems

1. **Contracts (Letters of Marque)** *(funding-slot replacement)* — any
   player can post a public, escrowed Neptunium bounty on an enemy
   outpost: whoever captures it from its current owner takes the pot.
   Zero-sum, irrevocable after the normal 10-minute fuse, expiring with
   refund after 48h. The rich convert kg into violence; the trailing
   convert violence into kg.

2. **The Drowned Queen** *(eliminated-player fix)* — an eliminated
   player's Queen rises where she fell as an indestructible, always-visible
   ghost ship the dead player steers for the rest of the match. One verb
   (haunt), one regenerating strength number, one public score (the Toll).

They interlock: contracts give the living a reason to fight where the
money points, and the Drowned Queen gives the dead a reason to keep
sailing. Both put prices on aggression without formalising alliances.

---

## 1. Postmortem coverage (docs/13 §1 top-5)

| Problem | Contracts | Drowned Queen |
|---|---|---|
| #1 match length | paid aggression starts earlier — measure | leader attrition → faster closes — measure |
| #2 AFK/disengaged collapse | bounties recycle stagnant fronts | a dead-quit player still leaves a working match; their ghost idles harmlessly |
| #3 forced betrayal | alliance-positive: sponsor an ally’s war instead of fighting your own — cooperation with skin in the game | betrayed friend isn't gone — they're your personal ghost. Grief → grudge match |
| #4 king-stacking | — | the ghost carries no specialists at all |
| #5 eliminated dead-zone | trailing players earn kg as mercenaries before things get fatal | the headline fix: real agency, own score, until match end |

Anti-coalition / anti-leader pressure (doc 18's brief): the market points
at the front-runner naturally — who do people pay to have hurt? Public,
structural, no leader-detection rule needed.

---

## 2. Architectural ground rules (from the engine we built)

- **R1 — Event-driven inside `tick()`.** Freighter spawns/dockings, wreck
  decay thresholds, ghost arrivals are **scheduler candidates** in the
  unified min-selection (like factory cycles / victory crossing). No
  boundary sweeps; the split-invariance property test extends to cover both
  systems and gates every merge.
- **R2 — Determinism.** Spawn schedules, routes, respawn points derive from
  `world.seed` via `rng.ts` patterns (server-side; seed stays redacted —
  manifests ship as *state*). The Time Machine must project freighters and
  ghost courses/regen exactly — that's a feature, not a constraint.
- **R3 — Integer state**, closed-form decay (the `shieldChargedSince` /
  `neptuniumMg` checkpoint pattern). No per-hour mutation loops.
- **R4 — Player verbs are GameEvents** (salvage orders, haunt orders,
  loadout picks). World reproducible from `baseline + events`.
- **R5 — `SIM_VERSION` bump per replay-visible phase; epoch promotion
  handles live games.**
- **R6 — Visibility via `viewForPlayer`.** Manifests + wrecks + ghosts
  are public (see §3.4, §4.3). Nothing new is private.

---

## 3. System 1 — Contracts (Letters of Marque)

*Supersedes the Undertow draft (archived in §10) — player-posted bounties
are simpler, social, and need no new moving entities.*

> Any player can post a public contract on an enemy outpost, escrowing
> Neptunium from their own total. **Whoever captures that outpost from
> its current owner takes the pot.**

### 3.1 Rules

1. **Posting** — target any outpost you don't own; stake 1–10 kg
   (`POT_MIN`/`POT_MAX`). The kg is escrowed from the poster's live
   total immediately (`commitNeptunium` then subtract — integer
   thousandths). Posting rides the normal 10-minute cancel fuse; after
   the fuse the contract is **irrevocable** (no rug-pulls — attackers can
   plan 9-hour strikes on its strength).
2. **Fulfillment** — the first player to capture the outpost **in combat
   from the owner it had at posting time** is credited the pot at the
   capture event. Multiple contracts on one outpost stack; each pays.
3. **Expiry & voiding** — 48h (`CONTRACT_TTL`); unfulfilled → full
   refund. If the target leaves the posted owner's hands any other way
   first (unrelated capture, elimination → dormant), the contract voids
   and refunds: you paid for a specific job against a specific regime.
4. **Public** — the contract list, pots, posters, and a price marker on
   the contracted outpost are visible to everyone. The target sees the
   price on their head.

### 3.2 Why this fixes funding

Funding cost the donor nothing and was invisible — it amplified the lead
coalition (doc 18 §1). Contracts invert every property: **real zero-sum
cost** (escrow comes out of the poster's victory total; nothing is
minted, so no inflation and no budget caps), **a true comeback channel**
(trailing players with military skill earn kg as mercenaries), **natural
anti-leader pressure** (the market prices the front-runner without any
leader-detection rule), and **alliance-positive cooperation with skin in
the game** ("I post 5 kg on Triton, you take it") that never formalises
an alliance.

### 3.3 Edge cases (pinned)

- Posting on your own outpost: forbidden (one validation).
- Capturing your own contract: allowed — you repay yourself; no-op.
- Multi-account: the alt must win a real combat; escrow only moves
  between pockets — no net gain.
- **Kingmaking-by-payment** (the real risk): a coalition pumping one
  member over 200 kg via contracts. Brakes: the 10 kg per-contract cap,
  the zero-sum sponsor cost (sponsors fall in the standings), and total
  publicity (the lobby sees the pot and can react). #1 playtest metric.
- Drowned Queen: ghosts cannot capture, so ghosts cannot collect.

### 3.4 Sim integration map

- `packages/sim/src/contracts.ts` (new): `world.contracts[]`
  `{ id, posterId, outpostId, targetOwnerId, potThousandths, postedAt,
  expiresAt, status }`, post/validate, fulfillment hook, expiry+refund.
- GameEvents: `post-contract` (rides the defer pipeline like other
  cancellable orders).
- `combat.ts`: capture path calls `settleContracts(world, outpost,
  attacker)`.
- `tick.ts`: earliest contract expiry is a scheduler candidate
  (split-invariant; refunds land at deterministic times).
- `visibility.ts`: contracts pass through to all viewers.
- UI: "post contract" button on the enemy outpost sheet (beside hail);
  public contract list (fleet sheet section); pot marker on the map.
- Estimate: **3–4 d sim + 2–3 d UI.**

## 4. System 2 — The Drowned Queen

*Revised after a design deep-dive (June 2026): the earlier Revenant sketch
(strength formulas, specialist loadouts, respawn rules, leader multipliers)
is superseded by a radically simpler core. Design goal: ONE entity, ONE
verb, ONE number — every interaction answered by an existing system rather
than a new rule.*

> When you're eliminated, your Queen doesn't die. She sinks — and rises
> where she fell, as a ghost ship only you can steer.

### 4.1 The three rules

1. **One entity.** The ghost is a single special sub. It is **always
   visible to every player** (an unmistakable wail on all sonar), moves
   like a sub, and **cannot be destroyed — only depleted**. Spectral crew
   regenerates over time toward a fixed cap, closed-form (the
   `shieldChargedSince` checkpoint pattern):
   `strength(t) = min(CAP, committed + floor((t − sinceAt) × REGEN))`.
   Pinned defaults: **CAP 60 crew, REGEN +2/h** (classic; presets scale).
2. **One verb: haunt.** Target an outpost or a sub; she travels there;
   **normal combat resolves** with exactly one change — *where capture
   would happen, nothing happens*. She destroys drillers and drains
   shields; she can never own, hold, mine, hire, gift, or carry anything.
   Survivor crew sails on; losses regenerate.

   **The dead take crew, never souls.** Specialists are untouchable by
   her in both directions: her combat kills drillers only. If she wins an
   outpost raid, stationed specialists remain in place, shaken but free.
   If she sinks a sub, its specialists escape in a **lifeboat** — the
   exact release-captive machinery (a 1× gift-to-self sub auto-routed to
   the owner's nearest outpost; a normal sub the living may interact
   with). Corollary invariant: **a ghost can never eliminate a player** —
   a Queen aboard a sunk sub lifeboats home. The dead cannot create more
   dead; eliminations remain solely authored by the living, and her power
   stays strictly driller-denominated (bounded by REGEN, counted by the
   Toll).
3. **One number: the Toll.** Drillers she destroys accumulate on a public
   per-ghost counter, shown beside the Neptunium race and on the end
   screen. The Toll converts to nothing, ever.

She rises **at the Abyss** — a single fixed landmark computed at
world-gen (the point maximizing distance from every player's starting
Queen; deterministic, seed-derived) and **drawn on the chart from day
one**, foreshadowing the mechanic before anyone has died. Rising at
strength zero at a known faraway point means the conqueror gets hours of
visible approach instead of a threat materialising on their freshly
captured, shield-drained outpost — no spawn-adjacency griefing, no
permanent garrison burden at capture sites, and a map landmark with lore
gravity (multiple deaths = a visible ghost-fleet anchorage the whole
lobby watches).

### 4.2 Interaction audit (why no new rules are needed)

| System | Interaction | New rule? |
|---|---|---|
| Combat | normal resolution; capture step skipped | one branch |
| Shields | absorb her crew first → **hard counter**; Inspector/Security Chief gain late-game value | none |
| Sentries | attrit her like any hostile sub | none |
| Pirates | can intercept and force her to zero — "exorcism for hire" | none |
| Specialists | she carries none, kills none, captures none; specialist-targeting effects no-op against her; survivors of her victories stay put (outpost) or lifeboat home (sub — reuses the release-captive sub path) | none |
| Time Machine | course + closed-form regen are deterministic → living players can scrub forward and watch the dread arrive; dead players plan hunts the same way | none |
| Fog of war | she is public; the **dead player's vision shrinks to a sonar bubble around her** (an omniscient dead friend with chat is an intel broker — bubble vision bounds it; chat stays) | one view rule |
| Victory / mining | she can't mine or win; her damage only redistributes tempo | none |
| Undertow (System 1) | her battles spill wrecks; she can sink freighters but never take the prize — the dead generate content for the living | none |
| Orders / cancellation | haunt orders flow through the normal queued/pending pipeline (cancellable like everything else) | none |
| Determinism | movement = existing sub machinery; regen = closed form; arrivals = scheduler candidates → split-invariant by construction | none |

### 4.3 Kingmaking, bounded structurally

She can't transfer value; her damage rate is capped by REGEN (~one
meaningful raid/day at defaults); she is visible and dodgeable; shields
blunt her. **REGEN is the single balance knob** bounding how far a grudge
can bend a match. Revenge naturally points at the strong — the player who
eliminated you usually is the threat — so no leader-bonus multiplier is
needed.

### 4.4 Counterplay menu (all pre-existing systems)

Shield up · dodge (she's slow and public) · hire a Pirate to drain her ·
post a Sentry on her lane · or camp her with a fleet that is now not
defending home. Every option costs something; none removes her. *"You
can't kill what's already dead — you can only buy time."*

### 4.5 Explicitly cut from the earlier Revenant sketch

- ~~strength = 25% of fleet at death~~ → fixed CAP (late eliminations were
  overpowered; a constant beats a formula)
- ~~choose 2 specialists to haunt with~~ → none (re-imported king-stacking
  + preview complexity)
- ~~death → respawn at deep point at 60%~~ → undepletable, regen-in-place
  (three rules became zero; the fiction improved)
- ~~Haunt ×2 vs leader~~ → flat Toll (one number beats a weighted score)
- ~~raid-withdraws-with-50%~~ → plain combat minus capture (one branch
  beats a special resolution)
- Ghost-vs-ghost combat: **none** — ghosts pass through each other (the
  dead have no quarrel with the dead).

### 4.6 Sim integration map

- `packages/sim/src/ghost.ts` (new): ghost state on World
  (`world.ghosts[]`: ownerId, pos/course, strength checkpoint
  {committed, sinceAt}, toll), haunt-order dispatch, arrival resolution
  (combat minus capture), regen math.
- `world-gen.ts`: compute + store the Abyss point (max-min-distance from
  starting Queens); client draws the landmark from t=0.
- `royalty.ts` elimination path: spawn the ghost at the Abyss, strength 0.
- ghost-wins-vs-sub: reuse the release-captive lifeboat path for the
  loser's specialists (no new machinery).
- `combat.ts`: the no-capture branch + toll credit + (later) wreck spill.
- `visibility.ts`: ghosts always pass through; eliminated viewer =
  ghost-centred sonar bubble + public state.
- `tick.ts`: ghost arrivals are scheduler candidates like sub arrivals.
- Lobby guard: active at ≥3 players (2P elimination ends the match).
- UI: hollow-queen glyph blip (♛ outline) with wisp trail; one order verb;
  strength bar; Toll on the fleet sheet; eliminated players keep the
  normal client in "drowned" mode.

### 4.7 Open playtest questions

1. Idle/AFK ghost behaviour — default: she loiters where she stopped
   (a motionless ghost looming on the map is its own dread). Revisit if
   playtests find idle ghosts dead weight.
2. CAP/REGEN values (60, +2/h) — the only two numbers in the system.
3. Does always-visible feel oppressive for HER (no ambush play)? The bet:
   public dread + Time-Machine-projectable hunts beat hidden-ganking, and
   visibility is what keeps the mechanic kingmaking-safe.
4. Abyss placement on extreme maps (max-min-distance can sit near a map
   seam on the torus — verify the landmark renders/labels well across the
   wrap, and that travel times from it are roughly uniform per seat).

## 5. Phases, estimates, gates

| Phase | Scope | Est. | Gate |
|---|---|---|---|
| A | Remove funding (sim+server+client+docs 03/09) | 1–2 d | suite + split-invariance green |
| B | Contracts sim (escrow → capture settle → expiry) | 3–4 d | determinism/replay tests; extended split-invariance scenario |
| C | Contracts UI (post button, public list, map pot markers) | 2–3 d | blitz playtest: do players post + collect? kingmaking-by-payment watch |
| D | Drowned Queen sim (rise, haunt, regen, toll) | 4–6 d | split-invariance with elimination; replay across elimination |
| E | Drowned Queen UX (ghost mode, toll board) + end-of-match summary | 3–4 d | playtest: does an eliminated tester keep playing? |

Total ≈ 3 weeks. `SIM_VERSION` bumps at B and D minimum; epoch promotion
covers live games. Each phase lands with unit tests + the property-test
scenario extension (R1 is the merge gate).

**Playtest metrics**: post-elimination session minutes; match-length delta
(systems on/off); Undertow share of total Neptunium velocity (≤30%);
ghost-vs-leader attack share; contract volume + fulfillment rate; and
endgame contract pots aimed at near-winners (kingmaking-by-payment).

---

## 6. Open questions (pinned defaults, playtest to revisit)

1. POT_MIN/POT_MAX (1/10 kg) and CONTRACT_TTL (48h) — three constants,
   tune in playtest.
2. Blitz presets for the ghost's CAP/REGEN (she must matter inside 24h).
3. Ghost-vs-ghost: **none** — ghosts pass through each other (superseded
   the earlier "ghost duels" idea; see §4.5).
   freighter history)? They're public anyway — default fine.
5. Multi-account abuse: a throwaway account aiming its ghost at a
   friend's rivals. Mitigation unchanged from docs/13 §2.7 (identity
   anchoring); the ghost can't transfer value and REGEN caps its damage.

---

## 7. Deliberately deferred

- Additional contract kinds ("sink sub X", "hold X for 24h") — capture
  contracts ship first.
- Ghost cosmetic identity (hull liveries) — monetization hook later.
- Undertow live-ops tuning tables — constants in sim v1.

---

## 8. Why not doc 18's 4B/4D (recorded for posterity)

- **Contract Board (4B)** is a quest log grafted onto a spatial game: an
  invisible "engine" handing out objectives breaks the game's fiction of
  emergent player-driven conflict, adds a generation/balance subsystem
  with perpetual live-ops cost (four contract kinds × slots × payout
  curves), and its objectives live in a UI sheet rather than in the
  water. The Undertow puts the same incentives **on the map**: every
  objective is a physical thing subs travel to, every race is visible on
  sonar, and the Time Machine — the game's crown jewel — becomes the
  planning tool for intercepts because freighters are deterministic.
  Emergent wrecks need no generator at all: the players write the
  contracts by fighting.
- **Council of the Sunken (4D)** gives the dead a committee: shared
  control needs a voting state machine, deadlock tie-breakers,
  abstain-timeouts, decay rules, and produces design-by-committee
  gameplay where individual dead players don't feel *agency* — plus a
  faction that inherits king-stacks and can kingmake with a whole navy.
  The Drowned Queen gives each dead player **their own boat, their own grudge,
  their own score**: no governance code, works in any lobby size, can't
  transfer power to living allies, and the betrayal story lands harder
  ("my friend's ghost is hunting me" beats "my friend joined a
  committee"). Sim footprint is roughly half of 4D's.

---

## 9. Proposal: Battle Stations (anti-dogpile defense)

*Status: design proposal (June 2026), not yet committed to a build phase.
Brief: a mechanical lever for a player being attacked by a multi-player
coalition, without touching diplomacy or formalising alliances.*

> **While ≥2 distinct players have hostile subs inbound to your
> outposts, all your shields recharge at 2× rate.**

- **Duels untouched** — one attacker grants no bonus; the mechanic only
  exists when outnumbered, so turtling never becomes dominant.
- **The gang controls the trigger** — attack as one player (no surge),
  stagger waves (defender recovers between), or eat the 2×. Every option
  dilutes the dogpile; coordinated aggression stops being free.
- **Buys time, not victory** — extra shield-hours mean another factory
  cycle / redeploy / hire window. A 3v1 should still usually win; it
  should be slow and expensive enough that the third attacker wonders if
  they're the sucker.
- **Visible + deterministic** — derived from inbound hostile subs
  (public state); shield math keeps the closed-form pattern with a rate
  factor committed at launch/arrival/redirect events (`commitShield`),
  split-invariant by construction; Time Machine projects it.
- **Taxes wolf-packing/multi-accounting automatically** (docs/13 §2.7) —
  multi-account gangs are exactly "multiple distinct owners inbound."
- **Known exploit, accepted** — a friend can keep your surge alive with a
  fake hostile sub. Bounded by the 2× cap, travel cost, public optics,
  sentry/pirate exposure. Watch in playtest; no rule.

**Companion (hold for playtest): Redeployment** — friendly-to-friendly
transfers at 1.5×, determined at launch (Smuggler-conditional machinery).
Gives defenders interior lines against multi-vector convergence. Costs:
shaves the Smuggler's niche (keep it at 3×), and helps all logistics, not
only victims. Ship Battle Stations first.

**Rejected**: post-loss immunity windows (gameable, breaks the real-time
fiction) · distress bounties to third parties (diplomacy in a trenchcoat)
· once-per-game panic buttons (no cooldown-button grammar in this game)
· attacker-count combat penalties at impact (invisible resolution math —
breaks the transparent combat-preview promise; the surge acts *before*
combat, in plain sight).

---

## 10. Archived: The Undertow (freighters + wrecks)

The original System 1 draft — neutral cargo freighters on posted routes
plus salvageable battle wrecks — is archived in favour of player-posted
Contracts (§3): simpler (no NPC entities, no spawn/route generation, no
minted Neptunium needing budget caps), more social (players write the
incentives), and closer to the funding slot's original political intent.
The Undertow's wreck-salvage half remains a candidate future layer on top
of contracts if playtests want more map-driven objectives. Battle
Stations (§9) likewise remains proposal-stage.
