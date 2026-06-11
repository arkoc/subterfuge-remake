# Specialist Interactions Reference

A comprehensive breakdown of every specialist's effect categorized by where it applies, how combat ordering works, stacking semantics, edge cases, and test coverage gaps.

---

## 1. Every Specialist's Effect — Categorized by Location & Impact

| Specialist | Glyph | CP | Scope | Outpost Combat | Sub-vs-Sub Combat | Production/Economy/Visibility | Stacking |
|---|---|---|---|---|---|---|---|
| **ROYALTY** |
| Queen | 👑 | - | outpost+sub | +20 max shield at own | (none) | +150 electrical @ outpost | local-only; exactly 1 active |
| Princess | 👑 | - | outpost | (none) | (none) | +50% sonar @ outpost | local-only (saturates at outpost) |
| **OFFENSIVE** |
| Martyr | 💣 | 1 | both | Geometric blast: 0.20×SONAR_RANGE | Geometric blast | (none) | redundant (one annihilates area) |
| Lieutenant | ⚔️ | 7 | both | +5 driller damage | +5 driller damage | 1.5× speed (sub) | additive damage per Lieutenant; speed local-max |
| War Hero | ⚔️ | 7 | both | +20 driller damage | +20 driller damage | (no passive sniping) | additive per War Hero; speed local-max |
| General | ⚔️ | - | both | +10 driller damage globally per General | +10 per General globally | 1.5× speed (sub) | global additive; speed local-max |
| Sentry | 🎯 | 7 | outpost | +5 driller damage in-combat | (sub-only) | -5% (ceiling) driller attrition every 2h | per-Sentry independent timers; no combat stacking |
| Pirate | 🏴‍☠️ | - | sub | (enables encounter) | Enables sub-vs-sub targeting; 2× chase speed; 4× return speed | (none) | only one Pirate target per sub; speed fixed |
| Thief | 👀 | 4 | sub | Steals ceil(15% × enemy drillers) | Steals ceil(15% × enemy drillers) | (none) | sequential application by ID (compound effect) |
| Infiltrator | 🔓 | 4 | sub | Drains entire shield to 0 | (sub-vs-sub only, no effect) | (none) | redundant (one drain = 0); still capturable |
| **DEFENSIVE** |
| Revered Elder | 🛡️ | 2 | both | Silences all other specialists if alone | Silences all other specialists if alone | (none) | binary per-side (only existence matters) |
| Saboteur | 🚫 | 3 | sub | (sub-vs-sub only) | Redirects losing enemy sub home if survivor | (none) | redundant (one redirect = gone); capped at 2 |
| Smuggler | 📦 | - | sub | (sub-only) | 3× speed heading to own outpost; 1× if destination hostile | (none) | local-max speed (conditional on ownership) |
| Tycoon | 📦 | - | both | (from Smuggler) | 3× speed (sub); +50% Factory cycle | +3 drillers/cycle @ Factory | global +50% additive; local +3 additive |
| Inspector | 🔋 | - | outpost | Full shield recharge on arrival & post-victory | (outpost only) | (none) | binary (one = full charge) |
| Security Chief | 🔋 | - | both | +10 max shield globally + +10 local; Inspector recharge retained | (outpost only) | (none) | global +10 additive; local +10 additive |
| Double Agent | 🤝 | 5 | sub | (sub-vs-sub only) | Destroys all drillers both sides; swaps ownership & specialists | (none) | irrelevant (combat ends) |
| Diplomat | 📨 | - | outpost | (non-combat, pre-tick) | (none) | Releases captives to home on 1× sub | first Diplomat wins (rest see empty list) |
| **OTHER (UTILITY)** |
| Intelligence Officer | 👁️ | - | both | (outpost only) | (none) | +25% sonar globally | additive per IO; +50% = 2 IOs |
| Tinkerer | 🔌 | - | outpost | +3×max shield electrical; -3/hour drain | (none) | (none) | additive drain & electrical per Tinkerer |
| Minister of Energy | 🔌 | - | both | (from Tinkerer) | +300 electrical globally; -1/cycle/Factory | (none) | additive per MoE |
| Foreman | 📈 | - | outpost | (Factory only) | (none) | +6 drillers/cycle @ Factory | additive per Foreman at same Factory |
| Engineer | 📈 | - | both | (post-driller) | (post-driller) | 25% × losses global + 25% local (can exceed 100%) | global 25% additive; local 25% on top |
| Hypnotist | 🧠 | - | outpost | (non-combat, per-tick) | (none) | Converts captive specialists at own outpost | first wins; Diplomat preempts on same tick |
| King | 👨‍⚖️ | - | both | floor(friendly_drillers/3) damage @ King's outpost; +20 max shield @ King; captive conversion | floor(friendly_drillers/3) @ King's sub | -20 max shield globally, +20 @ King's outpost | combat damage additive; shield modifier additive |
| Navigator | 🧭 | - | sub | (sub-only) | Mid-flight course-change allowed | (none) | irrelevant (any changes allowed) |
| Admiral | 🧭 | - | both | (from Navigator) | 1.5× speed (sub); +50%/Admiral global (no-specialist subs) | (none) | speed local-max; global +50% additive (1 Admiral = 1.5×; 2 = 2.0×) |
| Helmsman | ⚙️ | - | sub | (sub-only) | 2× speed | (none) | local-max speed (mutually exclusive) |

---

## 2. Combat Ordering & Phase Resolution

All combat follows this deterministic 4-phase order, with specialists resolving in combat-priority (CP) order within Phase 1:

```
PHASE 1 (SPECIALIST):
  CP 1   Martyr
         • Geometric blast: 0.20 × SONAR_RANGE (fixed, not modified by IO/Princess)
         • Destroys all subs & outposts (incl. friendly) within radius
         • Specialists on destroyed assets removed outright (no capture, no Princess save)
         • Queen losses trigger succession immediately

  CP 2   Revered Elder
         • If exactly one side has RE, RE silences all other specialists (both sides)
         • Silencing scope: CP 3–7, post-spec (General, King), post-driller (Saboteur, Engineer)
         • Exception: Martyr (CP 1) fires before RE can veto it
         • If both sides have RE, neither silences anything

  CP 3   (Saboteur announced for veto-ordering, but fires post-driller — see below)

  CP 4   Thief & Infiltrator (simultaneous, but Thief sequential by ID)
         • Thief: steals ceil(15% × enemy_drillers) per Thief
           - Applied sequentially on the diminishing remainder
           - Stolen drillers added to Thief's side
           - Converted drillers excluded from Engineer restore calculation
         • Infiltrator: drains entire outpost shield to 0 (outpost combat only)
           - One Infiltrator is sufficient; additional ones redundant for drain
           - Shield recharge clock resets

  CP 5   Double Agent (sub-vs-sub only; outpost combat has no CP-5 effect)
         • Destroys all drillers on both subs
         • Swaps ownership of both subs + all specialists aboard (including DA itself)
         • Combat ends immediately (no Phase 2, 3, 4)
         • Both subs continue toward original destinations under new ownership

  CP 6   Assassin
         • Kills all enemy specialists outright (no capture, no Princess save)
         • Captive specialists at the site are untouched (not in combat.specialists list)
         • Does NOT fire in sub-vs-sub if both sides have Revered Elder

  CP 7   Lieutenant, War Hero (simultaneous, apply to same pre-state)
         • Lieutenant: +5 driller damage per Lieutenant
         • War Hero: +20 driller damage per War Hero
         • Sentry has no in-combat damage (passive-only); War Hero is the promoted form with damage

  POST-SPEC (after CP 7, before Phase 2):
         General (global)
         • +10 driller damage per General owned by this player (any specialist participating)
         • Applies even if the attacking General isn't at this combat site
         • Applies to sub-vs-sub encounter

         King (local at King's outpost only)
         • floor(friendly_remaining_drillers / 3) × count_of_Kings damage
         • Only fires if King is at the combat location (outpost or sub)
         • Fires in both outpost and sub-vs-sub combats

PHASE 2 (SHIELD) — skipped in sub-vs-sub
  • Attacker drillers vs. outpost shield charge (live, post-Infiltrator drain)
  • Shield absorbs min(shield_charge, attacker_drillers)
  • Attacker drillers -= absorbed
  • Outpost shield -= absorbed
  • Recharge clock continues from new shield value

PHASE 3 (DRILLER)
  • Attacker drillers vs. Defender drillers
  • Attacker wins if att > def
  • Defender wins if def >= att (ties go to defender)
  • Winner remaining = winner_drillers - loser_drillers
  • In sub-vs-sub tie: both destroyed, specialists return home (not captured)
  • In outpost tie: outpost remains defender's; drillers = 0

POST-DRILLER (after Phase 3, before Phase 4):
         Saboteur (sub-vs-sub only)
         • Fires if Saboteur's side LOST the driller phase
         • Surviving enemy sub redirected to its own owner's nearest outpost
         • Measured from the sub's current position
         • Does not fire if Saboteur's side wins or if there's no survivor
         • Does not fire if combat ended by Double Agent (CP 5)

         Engineer (post-victory restore)
         • Fires only if Engineer's owner won the driller phase
         • Restores ceil(25% × drillersLostThisCombat) × globalEngineers
         • Plus ceil(25% × drillersLostThisCombat) × localEngineers (if at site)
         • totalRestore = ceil(lostDrillers × (0.25 × globalCount + 0.25 × localCount))
         • drillersLostThisCombat = only destroyed drillers (excludes Thief-converted & DA-swapped)
         • Restore can exceed losses; clamped to electrical cap at end of tick

PHASE 4 (CAPTURE)
  • Loser's specialists → captive state, held at winner's location
  • Captives held at outpost (outpost combat) or nearest friendly outpost (sub-vs-sub tie)
  • Destroyed-in-Phase-1 specialists removed entirely (no capture)
  • Queen capture triggers succession (unless Princess available)
  • Outpost ownership transfers (if attacker wins)
  • 20% neptunium penalty applied to loser (mine captures only)
  • Inspector recharge fires (if defender wins & Inspector at outpost)
  • Attacker specialists move from sub to outpost (if attacker wins)
```

---

## 3. Stacking Interactions — Exhaustive Matrix

### 3.1 Damage Dealers (Driller Destruction)

| Combo | Interaction | Example | Code Line |
|-------|-------------|---------|-----------|
| Lieutenant + War Hero | Additive both CP 7 | 2 Lts + 2 WHs = +50 damage | combat.ts:205-212 |
| General + General | Additive global damage | 2 Generals = +20 damage | combat.ts:220-221 |
| General + Lieutenant | Additive (diff scopes) | General +10 global + Lt +5 local = +15 | combat.ts:219-226 |
| King + King (same outpost) | Additive damage per King | 2 Kings @ outpost + 30 drillers = +20 damage | combat.ts:230-233 |
| Thief + Thief | Sequential on remainder | 2 Thieves: 15% of N, then 15% of (N-first) | combat.ts:242-253 |
| Assassin + Assassin | Redundant | One Assassin kills all; second doesn't add | combat.ts:192-198 |
| Martyr + any | Mutual destruction | Martyr blast destroys combat before CP 2+ fire | combat.ts:129-138 |
| Sentry (outpost) in combat | Fires at CP 7 with damage | Sentry: +ceil(5% of attacker drillers) | specialists.ts:139; combat.ts no explicit Sentry CP-7 (note: docs say it has no in-combat damage) | **GAP: Sentry combat damage not implemented?** |

**GAP FOUND**: Docs/05_specialists.md §7.4 & §4 claim Sentry has "no in-combat damage — she is a pure outpost passive", but the CP table lists "CP 7 Sentry destroys 5 enemy drillers (in-combat)". Code (`combat.ts`) makes no mention of Sentry in Phase 1, only Lieutenant and War Hero at CP 7. This is a **doc-code mismatch**: Sentry's passive-only interpretation is correct per code.

### 3.2 Shield Modifiers

| Combo | Interaction | Example | Code Line |
|-------|-------------|---------|-----------|
| Queen + Security Chief | Additive max | Queen +20 + SC +10 global + SC +10 local = +40 max | shield.ts:26-52 |
| King (at outpost) + King | Additive max @ King outpost | 2 Kings @ outpost: -20 globally + 20 per King = 0 locally, -20 elsewhere | shield.ts:51 |
| King + Security Chief | Additive modifiers | King -20 global + SC +10 global = net -10; King +20 local + SC +10 local = +30 @ King | shield.ts:51-52 |
| Inspector + Inspector | Redundant | One recharge = full; second doesn't stack | passives.ts:130 |
| Tinkerer + Tinkerer | Additive drain | 2 Tinkerers = -6/hour drain | shield.ts:83-84 |
| Infiltrator + Infiltrator | Redundant drain | One drain = 0; second still present but no additional effect | combat.ts:167 |
| Tinkerer + Inspector | Sequential effect | Infiltrator drains to 0 (phase 1) → Inspector recharges post-victory | docs/05_§8.5 |

### 3.3 Speed Multipliers (Local-Max Rule)

| Combo | Interaction | Example | Code Line |
|-------|-------------|---------|-----------|
| Pirate (chase) + any local | Pirate 2× wins in chase | Pirate + Helmsman heading to target: 2× chase | subs.ts:44-50; pirate logic |
| Pirate (return) + any local | Pirate 4× wins in return | Pirate + Admiral returning home: 4× (fixed override) | subs.ts:91-93 |
| Smuggler + Helmsman | Smuggler 3× wins | Both on sub to own outpost: 3× applies | subs.ts:70-75 |
| Smuggler (non-friendly dest) + any | Smuggler 1×, other wins | Smuggler heading to enemy outpost → destination captured → 1× (Smuggler bonus lost) | subs.ts:104-107 |
| Admiral + Admiral | Global stacks, not local | 2 Admirals on no-specialist sub = 1.0 + 0.5 + 0.5 = 2.0× | subs.ts:97 |
| Admiral local + Admiral global | Admiral local only | Admiral on sub = 1.5× local; doesn't stack with global bonus (sub has cargo) | subs.ts:87-110 |
| Navigator + Admiral | Admiral replaces Navigator | Admiral loses mid-flight course-change ability | docs/05_§3; admiral.promotedFrom='navigator' but no course-change code |

### 3.4 Production Modifiers

| Combo | Interaction | Example | Code Line |
|-------|-------------|---------|-----------|
| Tycoon + Tycoon (at Factory) | Additive local +3 | 2 Tycoons @ Factory = +6/cycle | (production code) |
| Tycoon (global) + Tycoon | Additive global +50% | 2 Tycoons = +100% cycle rate | (production code) |
| Foreman + Foreman (at Factory) | Additive +6 | 2 Foremen @ Factory = +12/cycle | (production code) |
| Tycoon + Foreman (at Factory) | Additive both | Tycoon +3 + Foreman +6 = +9/cycle | (production code) |
| Tycoon (global) + Minister of Energy | Offset penalty | MoE -1/cycle/Factory vs. Tycoon +50% cycle (speed offsets count penalty) | docs/05_§9.5 |
| Minister of Energy + Minister | Additive -1/cycle/Factory | 2 MoEs = -2/cycle/Factory | (production code) |

### 3.5 Sonar & Visibility

| Combo | Interaction | Example | Code Line |
|-------|-------------|---------|-----------|
| Princess + Princess (at outpost) | Saturating +50% | 2 Princesses @ outpost = +50% (not +100%); documented in docs/05_§13.6 | visibility.ts (Princess handling) |
| Intelligence Officer + Intelligence Officer | Additive +25% | 2 IOs = +50% sonar | visibility.ts (IO handling) |
| Intelligence Officer + Princess | Additive both | IO +25% + Princess +50% (non-saturating) = +75% total | visibility.ts |

### 3.6 Captive Management

| Combo | Interaction | Example | Code Line |
|-------|-------------|---------|-----------|
| Diplomat + Diplomat (same outpost) | First wins | Multiple Diplomats: first releases; rest see empty list | passives.ts or captives logic |
| Diplomat + Hypnotist (same tick, same captive) | Diplomat preempts | Diplomat releases before Hypnotist converts | docs/05_§8.8; captives.ts |
| Hypnotist + Hypnotist (different outposts) | Independent | Each converts captives at its own outpost | (captives logic) |
| King + Hypnotist (at King's outpost) | Both apply | King converts captives (retained ability); no interaction | docs/05_§9.7 |

---

## 4. Sub-vs-Sub Combat Specifics

### 4.1 Encounter Initiation

**Mirror-route encounters** (automatic, no specialist needed):
- Two subs travel between the same pair of outposts in opposite directions
- Math: subs A (X→Y) and B (Y→X) meet deterministically at geometric midpoint
- Encounter time: `meet = (a.launchAt × fB + b.launchAt × fA + fA × fB) / (fA + fB)` where `fA = a.arrivalAt - a.launchAt`
- Must satisfy: `launchAt ≤ meet ≤ arrivalAt` for both subs
- Both sides in combat resolve specialist phase immediately
- **Code location**: `combat.ts:495-518` (`mirrorEncounterTime` function)

**Pirate-initiated encounters**:
- Pirate sub targets any visible enemy sub (not just mirror routes)
- Pirate chases at 2× speed toward the target
- Intercept point computed geometrically
- Target can Saboteur away (post-driller), Pirate gets redirected home
- Navigator on target can re-route; Pirate keeps chasing
- **Code location**: `pirate.ts`, `combat.ts`, `subs.ts` chase logic

### 4.2 Specialist Participation & Order

**Who fights in sub-vs-sub**:
- All active specialists aboard both subs (except Sentry, who is outpost-locked)
- Captive specialists do NOT participate (they don't fire, can't be killed by Assassin)
- Gift subs never participate (both pass without incident if either is a gift)

**Specialist phase resolution order**:
- CP 1: Martyr (blast center at encounter position)
- CP 2: Revered Elder (veto if alone)
- CP 4: Thief & Infiltrator (Infiltrator has no sub-vs-sub effect per spec)
- CP 5: Double Agent (ends combat immediately)
- CP 6: Assassin
- CP 7: Lieutenant, War Hero
- Post-spec: General (global), King (if King on this sub)
- Post-driller: Saboteur (redirects survivor if loser had one), Engineer (post-victory restore)

### 4.3 Driller Phase & Winner Determination

```
if a.drillers > b.drillers:
    winner = 'a'
    surviving = a.drillers - b.drillers
elif b.drillers > a.drillers:
    winner = 'b'
    surviving = b.drillers - a.drillers
else:
    winner = 'tie'
    surviving = 0
    both subs destroyed
    specialists return to owners' nearest friendly outposts
```

- Ties destroy both subs entirely
- Winning sub continues toward original destination with survivor drillers
- Loser's specialists become captives at winner's nearest friendly outpost (not at encounter site)
- **Code location**: `combat.ts:704-771` (`resolveSubVsSub`)

### 4.4 Combat Preview Coverage

`preview.ts:simulateSubEncounter` covers:
- ✅ Mirror-route encounters with full specialist resolution
- ✅ Driller loss calculation
- ✅ Winner determination (win/lose/tie)
- ✅ Saboteur redirect outcome
- ✅ Engineer post-victory restore

What's **NOT** covered in preview:
- ❓ Pirate-initiated encounters (non-mirror routes) — only mirror encounters are previewed
- ❓ Chase mechanics mid-flight — preview only handles static mirror routes

---

## 5. Outpost Combat Specifics

### 5.1 Arrival Sequence

**Step 1**: Sub approaches outpost, emits sonar alert
**Step 2**: If dormant → attacker claims (no combat)
**Step 2**: If friendly → cargo merges (no combat)
**Step 2**: If enemy → combat fires

**In combat**:
1. Neptunium commits for both players
2. Specialist Phase 1 (Martyr, RE, Thief/Infiltrator drain shield, DA, Assassin, CP7, post-spec)
3. Shield Phase 2 (shield absorbs attacker drillers 1:1 until exhausted or attacker gone)
4. Driller Phase 3 (winner determined; losers destroyed)
5. Engineer post-driller restore (if attacker wins)
6. Capture Phase 4 (loser's specialists → captive)
7. **Post-combat**: Inspector recharge (if defender wins)

**Code location**: `combat.ts:331-489` (`resolveCombat`)

### 5.2 Shield Drain & Recharge

**Infiltrator (Phase 1)**:
- Drains entire live shield to 0
- Does NOT affect shield max (Queen/SC/King modifiers still apply)
- Recharge clock resets
- One Infiltrator sufficient; additional ones redundant but still occupy specialist slots

**Tinkerer (continuous, outside combat)**:
- Drains 3 per hour continuously
- Drain rate = `1 charge per (HOUR_MS / (3 × tinkerer_count))` milliseconds
- Applied each time shield charge is queried via `currentShieldCharge`
- Drain floors at 0
- **Code location**: `shield.ts:70-86`

**Inspector/Security Chief (post-victory)**:
- Only fires if outpost is held by the owner AND specialist survived
- Sets shield to max (accounting for Queen/SC/King max modifiers)
- Fires immediately after Phase 4 completes
- **Code location**: `passives.ts:115-133`

### 5.3 Specialist Behavior on Capture

**When attacker wins**:
- Defender specialists become captives at the outpost (now owned by attacker)
- Attacker specialists move from sub to outpost
- Pre-existing captives at the outpost transfer ownership (become attacker's, or freed if they're already attacker's specialists)
- **Code location**: `combat.ts:454-465`

**When defender wins**:
- Attacker specialists become captives at the outpost
- Captive specialists cannot move, re-route, or participate in actions
- Diplomat can release them on 1× sub toward home
- Hypnotist can convert them (if Diplomat doesn't preempt)
- **Code location**: `combat.ts:464; captives.ts`

### 5.4 Mine Capture Penalty

- Applies when attacker captures a mine from a defender
- Penalty = `ceil(loser.neptuniumMg × 20 / 100)` = 20% of loser's reserves
- Applied immediately at capture (Phase 4)
- **Code location**: `combat.ts:437-441`

### 5.5 Specialist Transfer Order

When attacker captures outpost:
1. Defender specialists → captive state at outpost
2. Attacker specialists → location updated to outpost (from sub)
3. Pre-existing captives at outpost → ownership transferred to attacker (or freed if they're already attacker's)

When defender wins:
1. Attacker specialists → captive state at outpost
2. Inspector recharge fires (if applicable)

---

## 6. Edge Cases & Gotchas

### 6.1 Multi-Sub Arrival (Same Tick)

When multiple attacking subs from the **same player** arrive at the same defender outpost on the same tick:
- They **combine into one attacker pool**
- Driller counts sum
- Specialists from all subs participate together
- Combat resolves once against the outpost
- Winner's drillers split among attacker subs (TBD: exact split logic)
- **Code location**: `combat.ts` comment about "multiple attacking subs"

When multiple attacking subs from **different players** arrive at the same outpost on the same tick:
- Resolve in arrival-time order (or player-ID order on tie)
- First combat determines new owner (if attacker wins)
- Second combat fires against the (new) defender
- Each combat is independent

### 6.2 Gift Sub Collision with Attacker

Gift sub arriving at its target's own outpost:
- No combat, cargo transfers immediately
- Specialists re-owned via `acquireSpecialist` (Queen demotion logic applies)
- Even if an enemy sub arrives at the same tick, the gift processes first and merges with the destination

**Code location**: `subs.ts:270-282`

### 6.3 King -20 Global vs King +20 Local (Multi-King Outposts)

King shield modifier matrix:
- 1 King at outpost A: outpost A has +20 max, all other owned outposts have -20 max
- 2 Kings at outpost A: outpost A has 0 max (−20 + 20 + 20 = +20), all others have -40 max
- 1 King at A, 1 King at B: A has 0 max, B has 0 max, all others have -20 max

**Code location**: `shield.ts:32-51` (per-outpost calculation)

### 6.4 Multiple Pirate Stacking

- Only one Pirate-target per sub (can't chase two enemies simultaneously)
- Multiple Pirates on the same sub don't increase speed (fixed 2× chase, 4× return)
- Multiple Pirates on different subs each have their own chase
- If a Pirate sub's target is Saboteur'd away, Pirate returns home at 4×

**Code location**: `pirate.ts`, `subs.ts:91-93`

### 6.5 Tinkerer + Shield Interactions

- Tinkerer drain is **continuous** (not per-tick), applied whenever shield charge is computed
- Infiltrator drains during Phase 1 (sets to 0)
- Inspector recharge post-combat overrides Tinkerer drain (only applies post-victory)
- If Tinkerer arrives at an outpost mid-flight on a sub:
  - Drain pauses while on sub
  - Resumes immediately on arrival
  - **Shield commit happens on arrival** (so history pre-arrival is baked in)
  - **Code location**: `subs.ts:264-265`

### 6.6 Double Agent Swap

After a Double Agent swap in sub-vs-sub combat:
- Both subs' drillers = 0
- Both subs continue toward original destinations
- Specialists switch ownership
- Double Agent itself switches sides
- Both subs marked as "encountered" to prevent re-firing the same combat forever
- **Code location**: `combat.ts:656-669` (`resolveSubVsSub` Double Agent case)

### 6.7 Saboteur Redirect Edge Case

Saboteur redirects the **winning** enemy sub home if Saboteur's side **loses** the driller phase:
- If Saboteur's side wins driller phase: no redirect (no enemy to redirect)
- If both sides tie drillers: Saboteur doesn't fire (no surviving enemy sub)
- Redirect measured from the surviving sub's current position
- Recompute arrival time from current position at sub's current speed
- **Code location**: `combat.ts:748-751` (sub-vs-sub) and `combat.ts:833-873` (`redirectToNearestFriendly`)

### 6.8 Engineer Restore with Thief

Engineer restore calculation **excludes** drillers converted by Thief:
- `drillersLostThisCombat = pre_combat - post_combat - stolenByThief - convertedByDoubleAgent`
- Only "destroyed" drillers count as losses
- Example: Thief converts 10, Engineer restores only from actual destroyed-in-phase-3 drillers
- **Code location**: `combat.ts:266-272`; docs/05_§9.5

### 6.9 Revered Elder + Martyr Interaction

- Martyr (CP 1) fires before RE (CP 2)
- RE is destroyed in the Martyr blast
- RE cannot veto Martyr
- If both sides have a Martyr, both detonate (mutual destruction)
- **Code location**: `combat.ts:129-138`

### 6.10 Captive + Assassin

- Assassin does **NOT** kill captive specialists at an outpost (captives "do not participate in combat")
- Assassin kills active specialists only
- Captives remain captive after the combat
- **Code location**: `combat.ts:189-199` (Assassin filter, excludes captives)

---

## 7. Test Coverage Analysis

### 7.1 Tests by Specialist

| Specialist | Tests | Coverage Level |
|---|---|---|
| **Martyr** | `martyr-blast.test.ts` | ✅ Full (blast radius, destruction, Queen succession) |
| **Revered Elder** | `combat-specialists.test.ts` | ✅ Good (veto behavior, Martyr interaction) |
| **Saboteur** | `saboteur-mirror-encounter.test.ts`, `redirect-saboteur.test.ts` | ✅ Full (mirror encounters, redirects, Pirate interaction) |
| **Lieutenant/War Hero** | `combat-specialists.test.ts` | ✅ Good (CP 7 damage) |
| **General** | `combat-specialists.test.ts` | ✅ Partial (global damage, speed?) |
| **King** | `combat-specialists.test.ts` | ✅ Partial (damage at outpost, shield modifier) |
| **Assassin** | `combat-specialists.test.ts` | ✅ Good (kills specialists, captive immunity) |
| **Thief** | `combat-specialists.test.ts` | ✅ Good (conversion, sequential) |
| **Infiltrator** | `combat-specialists.test.ts` | ✅ Good (shield drain) |
| **Double Agent** | `combat-specialists.test.ts` | ✅ Partial (swap ownership, drillers destroyed?) |
| **Pirate** | `pirate.test.ts` | ✅ Full (targeting, chasing, return, speed) |
| **Navigator/Admiral** | `sub-speed.test.ts`, `mechanics-followup.test.ts` | ✅ Partial (speed, course-change?) |
| **Helmsman** | `sub-speed.test.ts` | ✅ Partial (local speed) |
| **Smuggler/Tycoon** | `sub-speed.test.ts` | ✅ Partial (3× speed, conditional) |
| **Inspector/Security Chief** | `passives.test.ts` | ✅ Good (full recharge, max shield) |
| **Tinkerer/Minister of Energy** | `passives.test.ts` | ⚠️ Partial (drain rate?) |
| **Foreman/Engineer** | `passives.test.ts`, `victory.test.ts` | ✅ Good (production, restore) |
| **Hypnotist/King** | `captives.test.ts`, `diplomacy.test.ts` | ✅ Partial (conversion order, Diplomat preempt?) |
| **Diplomat** | `diplomacy.test.ts` | ✅ Good (release, sonar range) |
| **Intelligence Officer** | `specialist-visibility.test.ts` | ✅ Good (sonar range) |
| **Sentry** | `passives.test.ts` | ✅ Partial (2-hour timer, target selection?) |
| **Queen/Princess** | `royalty.test.ts`, `hiring.test.ts` | ✅ Partial (electrical, sonar, succession?) |

### 7.2 Gaps in Test Coverage

| Gap | Why It Matters | Severity |
|---|---|---|
| **Sentry in-combat damage** | RESOLVED — passive-only, no CP-7 damage. Test: `specialist-edge-cases.test.ts` "Sentry has NO in-combat damage". | ✅ Fixed |
| **Multi-King shield interaction** | Tested via `specialist-combos.test.ts` "Multi-King shield (2 Kings, 2 outposts)" | ✅ Fixed |
| **Engineer + Thief loss exclusion** | Tested via `specialist-combos.test.ts` "Engineer restore excludes Thief-converted drillers" | ✅ Fixed |
| **Double Agent + Saboteur same sub** | Tested via `specialist-combos.test.ts` "Double Agent preempts Saboteur" | ✅ Fixed |
| **Pirate + Smuggler destination capture mid-flight** | Tested structurally via `specialist-edge-cases.test.ts` "Smuggler speed recompute on destination flip" | ✅ Fixed |
| **Diplomat + Hypnotist same tick** | Tested via `specialist-combos.test.ts` "Diplomat preempts Hypnotist" | ✅ Fixed |
| **Martyr + Queen in different locations** | Tested via `specialist-edge-cases.test.ts` "Queen destroyed by Martyr blast" | ✅ Fixed |
| **Multi-Thief sequential by ID** | Tested in `combat-specialists.test.ts` | ✅ |
| **Infiltrator redundancy** | Documented in `docs/05_specialists.md §13#1`; behaviorally redundant | ⚪ Locked by docs |
| **Princess sonar saturation** | Tested structurally via `specialist-combos.test.ts` "Princess saturation" | ✅ Fixed |
| **Tinkerer drain continuous** | Tested via `specialist-edge-cases.test.ts` "Tinkerer continuous shield drain" | ✅ Fixed |
| **Navigator mid-flight course-change** | Tested via `specialist-edge-cases.test.ts` "Navigator full mid-flight re-route" | ✅ Fixed |
| **Admiral global passive (no-specialist subs)** | Partial coverage in `sub-speed.test.ts` | 🟡 MEDIUM |
| **Security Chief local + global stacking** | Tested via `specialist-combos.test.ts` "Security Chief local + global" | ✅ Fixed |
| **King captive conversion at King's outpost** | Tested via `specialist-edge-cases.test.ts` "King converts captives at his outpost". **Sim bug found + fixed**: `captives.ts` was missing King in the conversion loop. | ✅ Fixed |
| **Gift sub + attacker same tick** | Tested via `specialist-edge-cases.test.ts` "gift sub + attacker on same tick" | ✅ Fixed |
| **Minister of Energy -1 driller per Factory** | Tested via `specialist-edge-cases.test.ts` "MoE -1 driller per Factory cycle" (quantitative) | ✅ Fixed |

---

## 8. Discrepancies Between Docs and Code

### 8.1 Resolved Mismatches (docs now match code)

| Issue | Code | Docs (after 2026-05-31 update) | Resolved? |
|---|---|---|---|
| **Sentry in-combat damage** | No CP-7 damage, passive-only | `docs/04_combat.md` Phase 1 table now reads "No in-combat damage" for Sentry; §7.4 already aligned | ✅ Fixed |
| **Infiltrator drain magnitude** | Drains entire shield to 0 | `docs/05_specialists.md §13#1` updated to "drains ENTIRE shield to 0, regardless of count"; `docs/04_combat.md` Phase 1 table aligned | ✅ Fixed |

### 8.2 Minor Ambiguities Resolved in Code

| Issue | Resolution | Evidence |
|---|---|---|
| **Admiral retains Navigator?** | No. Admiral loses mid-flight course-change. | `admiral.promotedFrom='navigator'`, but no course-change code in Admiral section. |
| **King retains Hypnotist?** | Yes, at King's outpost only. | docs/05_§9.7 & code: King has captive conversion. |
| **Engineer >100% restore?** | Yes, multiple Engineers can over-restore. | combat.ts:272 has no cap on restore; clamped only to electrical cap. |
| **Princess sonar stacking** | Saturating at +50% (not additive). | docs/05_§13.6; visibility.ts handles Princess as saturating. |

---

## 9. Key Takeaways for Implementation

1. **Combat order is strict**: CP walker must process in order 1 → 2 → 4 → 5 → 6 → 7 → post-spec → Phase 2 → Phase 3 → post-driller → Phase 4.
2. **Local-max speed**: Store effective multiplier on sub; recompute on specialist embark/disembark, destination ownership change, Saboteur redirect.
3. **Engineer restore excludes conversions**: Track `drillersDestroyed` separately from `drillersConverted` (Thief/DA).
4. **Shield commit on Tinkerer arrival**: When a Tinkerer arrives at an outpost, commit shield before adding new drain source.
5. **Martyr blast radius is fixed**: Not modified by Intelligence Officer or Princess; purely `0.20 × SONAR_RANGE`.
6. **Specialist lifecycle**: active → captive (on loss) or destroyed (Assassin, Martyr). Captives can't participate in combat, Diplomat release, or Hypnotist convert.
7. **Queen demotion to Princess**: Automatic when a second Queen is acquired; existing Queen stays Queen.
8. **Succession is atomic**: On Queen loss, nearest Princess promotes immediately (or player eliminated if none).

---

## Appendix: Test Checklist for Missing Coverage

```
SPECIALIST INTERACTION TESTS (Priority Order):

CRITICAL (blocks correctness claims):
[ ] Sentry: confirm in-combat behavior (passive-only or CP-7 damage?) per code intent
[ ] Engineer + Thief: restore excludes stolen drillers
[ ] Double Agent + Saboteur same sub: DA ends combat before Saboteur fires
[ ] Infiltrator: multiple on same sub = redundant drain (test slot occupancy + Assassin targeting)

HIGH (affects gameplay):
[ ] Multi-King at different outposts: shield math (−20 global, +20 King, additive)
[ ] Pirate + Smuggler: destination capture mid-flight → speed drop
[ ] Diplomat + Hypnotist: same tick precedence (Diplomat first)
[ ] Tinkerer drain: continuous per shield query (not per-tick)
[ ] King at outpost + King on sub: damage stacking in same combat

MEDIUM (edge cases):
[ ] Martyr + Queen in different radius locations: succession fires
[ ] Gift sub + attacker same tick: gift processes first
[ ] Princess sonar saturation: multiple at same outpost
[ ] Security Chief local + global: +10 + +10 = +20 at own outpost
[ ] Navigator mid-flight: full course-change re-routing during travel

LOW (completeness):
[ ] Admiral global passive: +50% per Admiral on no-specialist subs
[ ] Minister of Energy: -1 driller per Factory per MoE
[ ] King captive conversion: at King's outpost only
[ ] Multi-Thief sequential: order by specialist.id ascending
[ ] Revered Elder both sides: neither silences anything
```

