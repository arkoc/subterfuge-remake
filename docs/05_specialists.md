# Specialists

Specialists are *Subterfuge*'s heroes — named units that modify exactly
one of the eight core systems in a deterministic, well-defined way.
Each player hires specialists from the **Queen** on a cadence, places
them at outposts or aboard subs, and can promote some by skipping a
hire. This file is the authoritative reference for every specialist's
allowed location, exact effect, combat priority, promotion path,
capacity cap, stacking semantics, and counters.

Where authoritative sources disagreed we made a design choice and
documented it in **§13 Resolutions of Source Conflicts**. The numbers
below are the canonical ones to implement; do not treat any contrary
statement on the wiki or forum as overriding this file.

Sources mined for this document: the official rulebook
(`play.subterfuge-game.com/docs/Rulebook/Specialists.html`), the
community Fandom wiki, Herbert Zhang's summary
(`herbertzhb.wordpress.com/2016/06/28/subterfuge-2/`), and the official
forum archives (`forums.subterfuge-game.com`).

---

## 1. Hiring

- The **Queen** is the player's hiring agent. The Queen must be at an
  outpost (any of the player's own) when the hire timer fires.
- **First hire**: 4 hours after game start (per player; clock starts
  with the world).
- **Subsequent hires**: every 18 hours after the player's previous
  hire.
- Each hire offers exactly **3 candidates**: one **Offensive**, one
  **Defensive**, one **Other**. The pool is drawn from base
  (un-promoted) hireable specialists only; **Royalty** (Queen,
  Princess) and **promotion-only** forms (General, War Hero, Tycoon,
  Security Chief, Engineer, Minister of Energy, King, Admiral) never
  appear.
- **Previous-offer exclusion**: any specialist *offered* in the
  immediately preceding hire is removed from the next hire's pool —
  regardless of whether it was hired, declined, or the hire was used
  to promote. Promotions themselves do not trigger an exclusion
  entry (a "Promotion" outcome leaves the previous-offer set in
  place).
- The newly hired (or promoted) specialist materialises at the
  Queen's current outpost.
- **Alternative to hiring**: the player may skip the hire and
  **promote** a specialist who is at the Queen's outpost and has a
  promoted form. See §3.
- **Hire RNG (sim-purity rule)**: the 3-candidate roster is a pure
  function of `(worldSeed, playerId, hireIndex)`. We do not consult
  any global PRNG state — see `packages/sim/src/rng.ts` for the
  deterministic helper.

If the Queen is in transit (on a sub) when the hire timer fires, the
hire is **deferred** until she next arrives at one of the player's
outposts. If the Queen is captured at the moment of the timer, the
player has no Queen, and `§12 Royalty Succession` applies first
(usually meaning either a Princess promotes or the player is
eliminated).

---

## 2. Categories

- **Offensive** — direct combat damage / aggressive movement.
- **Defensive** — protection / shield / intercept / counter.
- **Other** (utility) — economy, sonar, mobility, captive management.
- **Royalty** — Queen, Princess (separate succession track, never
  hireable).

The category determines which slot on the hire wheel the specialist
fills. It has no in-combat effect.

### A note on "Where"

The **"Where"** label under each specialist entry describes **where
the specialist's ability fires**, not where the unit can physically
be. Per the official rulebook ("Subs can transport drillers and
specialists"), every specialist is a fully mobile unit — any of them
can be loaded onto a sub at one of your outposts and transported to
another. The only exception is a **captive** specialist, which can
only board a sub as the cargo of a Diplomat release (§5.2).

"Ability fires at an outpost" therefore means the *passive effect*
(Sentry firing, Foreman producing, Tinkerer draining, etc.)
**resumes the moment the unit lands at an outpost** and is
suspended while the unit is in transit on a sub.

---

## 3. Promotion

Promotion **replaces** the base specialist with its promoted form at
the Queen's outpost. Most promoted forms add a new global ability
*and* retain the base form's local ability; the exceptions are
documented under each entry.

| Base       | Promoted        | Base ability retained?           |
|------------|-----------------|----------------------------------|
| Lieutenant | General         | Yes — 1.5× sub speed when carried|
| Sentry     | War Hero        | No — passive sniping replaced    |
| Smuggler   | Tycoon          | Yes — 3× speed to own outposts   |
| Inspector  | Security Chief  | Yes — full charge on arrival / after combat |
| Tinkerer   | Minister of Energy | No — local electrical+drain replaced by global |
| Hypnotist  | King            | Yes — captive conversion at King's outpost |
| Foreman    | Engineer        | No — +6/cycle replaced by post-victory restore |
| Navigator  | Admiral         | **No** — Admiral cannot mid-flight redirect |
| Princess   | Queen *(automatic, on Queen death)* | Royalty succession only |

Promotion is permanent. There is no "demotion" path other than the
automatic Queen→Princess demotion when a player ends up with two
Queens (see §12).

---

## 4. Combat Priority

Specialists active in combat resolve in order of **combat priority
(CP)**: lower numbers first; ties act *simultaneously* on the same
pre-effect state. Specialists with no CP fall into one of two
**post-phase slots**:

```
Phase 1 (Specialist):
   CP 1   Martyr
   CP 2   Revered Elder
   CP 3   (reserved — Saboteur is announced here but executes post-driller)
   CP 4   Thief, Infiltrator           (simultaneous)
   CP 5   Double Agent
   CP 6   Assassin
   CP 7   Lieutenant, War Hero         (simultaneous)
   ---
   "Post-spec" (still part of Phase 1, after CP 7):
          General  (global)            – +10 enemy drillers per General
          King     (local, at King's outpost only) – 1 per 3 friendly
Phase 2 (Shield)         – skipped in sub-vs-sub
Phase 3 (Driller)
   ---
   "Post-driller" (after Phase 3 but before Phase 4):
          Saboteur                     – redirect enemy sub (sub-vs-sub only)
          Engineer                     – 25% lost-driller restore (winning side only)
Phase 4 (Capture)
```

Notes:

- **Saboteur** has CP 3 for *priority-of-announcement* (Revered Elder
  CP 2 can still suppress it), but mechanically the redirect resolves
  after the driller phase — so a Saboteur in a sub-vs-sub combat that
  ties on drillers still gets to redirect the survivor if there is
  one. The forum thread "G-Complex's Specialists and You — The
  Saboteurs" is the source for this nuance.
- **Engineer** has no CP slot; its restore is computed after the
  driller phase from "drillers the winning side lost in this combat".
  Multiple Engineers stack additively (see §11).
- **General** fires after CP 7 but before the shield phase. Multiple
  Generals stack additively (each adds another +10).
- **King** fires after CP 7 but before the shield phase, **at the
  King's own outpost only**. Multiple Kings at the same outpost stack.

### 4.1 Revered Elder veto

If exactly one side has a Revered Elder, the RE fires at CP 2 and
"no other specialists participate in this combat" — this means:

- All higher-CP specialists from both sides are silenced.
- Saboteur (post-driller) is silenced.
- Engineer (post-driller) is silenced.
- General and King post-spec abilities are silenced.
- Sentry's outpost-attrition is unaffected (it fires *between* combats,
  not during).

**Exception**: Martyr fires at CP 1, *before* the RE. So a Martyr
detonates even against a sole-RE opponent — the RE is destroyed
along with the rest of the local area.

If **both** sides have a Revered Elder, neither RE's veto fires; all
other specialists resolve normally.

### 4.2 Double Agent end-of-combat

Double Agent at CP 5 destroys all drillers on both sides, swaps
ownership of both subs (including all specialists aboard, including
the Double Agent itself), and **ends combat immediately**. No
remaining CP slots, no post-spec, no shield/driller/capture phases.

This is why Saboteur (post-driller) does *not* fire when a Double
Agent is present: the driller phase never happens.

### 4.3 Martyr blast geometry

When a Martyr participates in any combat, before any other specialist
resolves, every sub and every outpost within a blast radius centred
on the combat site is **destroyed outright** — including the Martyr's
own side's assets, including specialists aboard those subs/outposts
(no capture, no Princess save). Drillers on destroyed subs/outposts
are also destroyed.

Blast radius = **20% of the base sonar range** (i.e. `0.20 × SONAR_RANGE`),
measured as Euclidean distance on the torus. The radius is fixed; it
is **not** modified by Intelligence Officer, Princess, or any other
sonar modifier — it's a property of the Martyr, not of an outpost.

If a Martyr is on a sub and that sub is destroyed pre-combat (e.g. by
another Martyr), no blast occurs — only Martyrs *participating* in a
combat detonate.

---

## 5. Capacity Caps

Hard cap on *active* specialists per player. Captives do not count.

| Specialist | Cap   |
|------------|-------|
| Assassin   | 2     |
| Saboteur   | 2     |

Two more caps exist as natural consequences of the game rules rather
than as hard limits:

- **Queen**: exactly one active Queen per player at any moment. A
  second-acquired Queen (via gift or capture-and-convert) is
  immediately demoted to Princess (§12).
- **All other specialists**: no documented hard cap.

---

## 6. Royalty

### Queen

- **Where**: outpost or sub. The Queen is **just another specialist**
  in `world.specialists` — she may ride subs, be captured, killed, or
  succeeded by a Princess (§12) like any other specialist.
- **Effects** (applied only while she is *active* and *located at one
  of her owner's outposts* — both bonuses vanish while she's
  mid-flight on a sub or held captive):
  - **+150 electrical output** at her current outpost.
  - **+20 max shield charge** at her current outpost.
  - Enables this player's hire timer (must be at an owned outpost
    when the timer fires; otherwise the hire is deferred — §1).
- **Combat priority**: none. The Queen herself does not damage
  drillers in combat; if she is at an outpost being captured, she is
  treated as a regular specialist and is captured (or killed by an
  Assassin) along with the rest.
- **Promotes**: not applicable.
- **Death/loss**: see §12 (nearest Princess promotes; if none, the
  player is eliminated).
- **Counters**: Assassin (CP 6 kills her in a losing combat),
  Hypnotist at the capturing outpost (converts her if captured).

### Princess

- **Where**: ability fires at an outpost. (The Princess herself is
  mobile — she can ride subs like any other specialist; the sonar
  bonus and succession-eligibility are paused while she's in transit.)
- **Effects**: +50% sonar range at her outpost (additive, not
  multiplicative — see §11).
- **Combat priority**: none.
- **Promotes**: automatically to Queen on the active Queen's death,
  *only if* no other Queen exists yet (multiple Princesses → only the
  one nearest to the lost Queen promotes). The "nearest" tie-break
  is by Princess outpost id ascending.
- **Counters**: capture and kill before promotion fires.

A player may have any number of Princesses (subject to the hire pool
producing them only via Queen-demotion, since Princess is not
hireable from the wheel — she enters play only via Queen-acquisition
demotion; see §12).

---

## 7. Offensive Specialists

### 7.1 Martyr

- **Where**: sub or outpost.
- **CP 1**.
- **Effect**: see §4.3. Annihilates all entities within `0.20 ×
  SONAR_RANGE` of the combat site.
- **Promotes**: none.
- **Stacking**: redundant (one Martyr already destroys the local
  area).
- **Counters**: geometric avoidance, Assassin pre-positioned in the
  target sub (but Assassin is CP 6 and Martyr is CP 1, so this only
  works if the Martyr is on a different sub being killed *before* it
  reaches the combat).
- **Implementation**: `martyrBlast()` in
  `packages/sim/src/combat.ts` performs the geometric scan over
  `world.subs` and `world.outposts`. Subs in radius are removed,
  outposts become dormant, specialists at destroyed entities are
  removed outright (no capture, no Princess save). Queen losses
  trigger `onQueenLost()` succession automatically.

### 7.2 Lieutenant

- **Where**: sub or outpost (combat effect fires from either; speed
  effect applies only when riding a sub).
- **CP 7**.
- **Effect**: destroys 5 enemy drillers in any combat it participates
  in. While riding a sub, the sub travels at 1.5× ordinary speed (see
  §10 speed stacking).
- **Promotes**: General.
- **Stacking**: per-Lieutenant additive — two Lieutenants in the
  same combat destroy 10 enemy drillers.
- **Counters**: Revered Elder, Martyr, Assassin (CP 6 < 7 → kills it
  before it fires).

### 7.3 General (promoted from Lieutenant)

- **Where**: sub or outpost.
- **Combat timing**: post-spec (after CP 7, before shield phase).
- **Effect**:
  - **Global**: in *every* combat in which this player has at least
    one specialist participating, destroy 10 additional enemy
    drillers. Stacks additively across Generals you own.
  - **Local**: while riding a sub, the sub travels at 1.5× speed
    (retained from Lieutenant).
- **Promotes**: terminal.
- **Stacking**: global additive (2 Generals → +20 per combat). Local
  speed does not stack with other speed specialists on the same sub
  (§10).
- **Counters**: Revered Elder; Martyr; Assassin (kills it if it is
  *in* the combat). The global effect cannot be Assassin'd because
  no specific specialist instance is in the combat for the global
  fire.

### 7.4 Sentry

- **Where**: ability fires at an outpost only. The Sentry is mobile
  and can ride subs; the 2-hour attrition timer pauses while in
  transit and resumes (with the timer reset) the moment she lands at
  one of her owner's outposts.
- **CP**: none. Sentry has **no in-combat damage** — she is a pure
  outpost passive. (Her upgrade, War Hero, is where in-combat
  damage starts.)
- **Passive (outside combat)**: every 2 hours, fires at one enemy
  sub within *half* of the outpost's sonar range. Each shot
  destroys `ceil(5% × sub.drillers)` drillers from that sub. Target
  selection: the sub on which the shot will destroy the most drillers
  this tick; on tie, the sub with the lowest `sub.id`.
- **Timer**: per-Sentry. Starts when the Sentry is hired or arrives
  at an outpost; resets to 2h after firing. If the Sentry is moved
  via sub to a new outpost, the timer is reset on arrival.
- **Promotes**: War Hero.
- **Stacking**: each Sentry has its own timer; multiple Sentries at
  the same outpost each fire independently.
- **Counters**: many small ~20-driller subs (each shot rounds up to
  exactly 1 lost driller); shield charge does not protect the sub —
  the attrition is dealt to drillers directly.

### 7.5 War Hero (promoted from Sentry)

- **Where**: sub or outpost.
- **CP 7**.
- **Effect**: destroys 20 enemy drillers in any combat it
  participates in. No outpost-passive sniping (replaced).
- **Promotes**: terminal.
- **Stacking**: per-War-Hero additive.
- **Counters**: Revered Elder; Martyr; Assassin (CP 6 < 7).

### 7.6 Assassin

- **Where**: sub or outpost.
- **CP 6**.
- **Effect**: kills *all* enemy specialists participating in this
  combat — outright, no capture, no Princess save.
- **Promotes**: terminal.
- **Cap**: 2 per player.
- **Stacking**: redundant (one Assassin already kills everyone).
- **Counters**: Revered Elder (CP 2 < 6 silences it); Martyr (CP 1
  blast destroys it); Saboteur (CP 3 redirect happens post-driller —
  doesn't suppress Assassin here, but the encounter may be cancelled
  if it's the *Assassin's* sub being Saboteur'd in a different way).
- **Captives**: an Assassin does **not** kill captive specialists at
  the outpost being attacked — captives "do not participate in
  combat" so they're not in the Assassin's target set.

### 7.7 Thief

- **Where**: sub.
- **CP 4** (simultaneous with Infiltrator).
- **Effect**: `ceil(15% × enemyDrillers)` enemy drillers are
  **converted** to the Thief's side at the moment Phase 1 resolves.
  Effect applies in sub-vs-outpost (steal from outpost garrison) and
  in sub-vs-sub (steal from the other sub).
- **Promotes**: terminal.
- **Stacking**: two Thieves in the same combat apply **sequentially**,
  not simultaneously: first Thief steals `ceil(15% × N)`, second
  steals `ceil(15% × (N - stolen_1))`. (Sources confirm this is a
  "compound" effect rather than additive.) Despite both Thieves being
  at CP 4, the stealing is ordered by `specialist.id` ascending.
- **Counters**: Revered Elder; Martyr; Infiltrator on the same sub
  cohabits without conflict (Infiltrator drains shield, Thief steals
  drillers).

### 7.8 Infiltrator

- **Where**: sub.
- **CP 4** (simultaneous with Thief).
- **Effect**: when attacking an outpost, drains the **entire** live
  shield charge to 0. The shield-recharge clock is reset to the
  moment of arrival. **Does not** apply in sub-vs-sub.
- **Promotes**: terminal.
- **Stacking**: redundant for the drain effect (one Infiltrator
  already wipes the shield); additional Infiltrators still occupy
  specialist slots and can be Assassin targets, but they don't
  compound the drain.
- **Counters**: Revered Elder (silences); Martyr (CP 1 ends combat);
  Inspector (recharges shield after combat, but only if the outpost
  is held).

### 7.9 Pirate

- **Where**: sub.
- **CP**: none — Pirate enables an *encounter* (sub-vs-sub combat
  against an arbitrary target), then participates in the combat as
  an ordinary specialist with no special CP effect.
- **Effect**:
  - Sub carrying a Pirate may **target an enemy sub** directly (any
    enemy sub visible to the player via sonar). This is the only
    way to initiate sub-vs-sub combat outside of a mirror-route
    encounter.
  - While the sub is moving toward the target: travels at **2× base
    speed** (overrides any other local speed specialist on the sub,
    per §10).
  - After the encounter resolves (target killed, target reached its
    destination, or target Saboteur'd away), the Pirate sub
    auto-routes to the **nearest friendly outpost of the Pirate's
    owner** and travels at **4× base speed** to it.
- **Retarget mid-flight**: a Pirate sub may be redirected to a
  **different enemy sub** at any point while the chase is in
  `phase: 'chasing'`. The previous target is dropped, the geometric
  intercept is recomputed against the new target, and `arrivalAt`
  rewrites accordingly. There is **one exception**: once the chase
  enters `phase: 'returning'` (target was destroyed / reached its
  outpost / sub-vs-sub combat resolved), the Pirate is locked into
  its return trip and **cannot** be retargeted. Implementation guard:
  `packages/sim/src/pirate.ts:64` — `if (sub.chase?.phase ===
  'returning') throw 'pirate is already returning home'`. This is
  the only Pirate target-change limit in the sim. (Note: unlike the
  Navigator's destination-redirect, retarget does NOT require a
  Navigator aboard — the Pirate's targeting is its own mechanic.)
- **Implementation**: `targetSub()` in `packages/sim/src/pirate.ts`
  validates the order and computes the geometric intercept point.
  `Sub.chase` carries the chase state (`phase: 'chasing'` ↔
  `'returning'`); `subPosition()` overrides interpolation when
  `chase` is set. The tick loop fires `resolveSubVsSub()` at the
  intercept time and calls `returnPirateHome()` for the survivor.
  `recomputeChase()` refreshes the intercept if the target re-routes
  or vanishes.
- **Promotes**: terminal.
- **Stacking**: only one Pirate-target per sub (you can't have a sub
  chasing two enemies). Multiple Pirates on the same sub don't
  multiply the speed (it's a fixed 2× / 4×).
- **Counters**: Navigator on the target sub (re-routes, forcing the
  Pirate to keep chasing); Martyr on the target; Saboteur in any
  sub-vs-sub encounter the Pirate initiates.

---

## 8. Defensive Specialists

### 8.1 Revered Elder

- **Where**: sub or outpost.
- **CP 2**.
- **Effect**: if exactly one side has an RE, that RE silences every
  other specialist effect in this combat (see §4.1 for the exact
  scope). If both sides have an RE, neither silences anything.
- **Promotes**: terminal.
- **Stacking**: irrelevant — only existence matters per side.
- **Counters**: Martyr (CP 1 < 2 → blasts before RE silences).

### 8.2 Saboteur

- **Where**: sub.
- **CP 3** for priority-of-announcement; mechanically executes
  **post-driller** (see §4).
- **Effect**: in a sub-vs-sub combat where the Saboteur's own side
  *loses* the driller phase (or in any case where the opposing sub
  survives), the surviving **enemy sub is redirected to its own
  owner's nearest outpost** — i.e. sent home — as measured from its
  current position. The redirected sub's `destinationId` is
  rewritten; `arrivalAt` is recomputed from the current position at
  the existing speed multiplier. The Saboteur's own sub is already
  destroyed by the driller phase (along with the Saboteur). If the
  Saboteur side *wins* the driller phase the ability is silent — the
  enemy sub doesn't exist to be redirected.
- **Promotes**: terminal.
- **Cap**: 2 per player.
- **Stacking**: two Saboteurs on the same losing sub is redundant
  (one redirect cancels the survivor's mission).
- **Counters**: Revered Elder (silences Saboteur even though it's
  post-driller); Martyr (CP 1 ends combat); Double Agent (CP 5 ends
  combat before Saboteur fires).

### 8.3 Smuggler

- **Where**: sub.
- **CP**: none.
- **Effect**: 3× base speed **while** the sub is heading to one of
  the Smuggler's owner's outposts. If en route the destination is
  captured by an enemy, the bonus disappears (speed drops to 1×) and
  the arrival time is recomputed.
- **Promotes**: Tycoon.
- **Stacking**: local speed does not stack with other locals (§10).
- **Counters**: Pirate (2× chase against a 3× Smuggler — viable from
  the right angle); Saboteur (redirect ⇒ destination is no longer
  friendly ⇒ speed bonus disappears anyway).

### 8.4 Tycoon (promoted from Smuggler)

- **Where**: sub or outpost.
- **CP**: none.
- **Effect**:
  - **Global**: +50% to the driller-production rate of *all* this
    player's Factories (cycles complete 50% faster — equivalent to
    multiplying `FACTORY_CYCLE_MS` by ⅔ for this player). Stacks
    additively per Tycoon: 2 Tycoons → +100%, 3 → +150%, etc.
  - **Local** (at a Factory the Tycoon is at): +3 drillers added to
    that Factory's per-cycle output, on top of the base 6.
  - **Local** (while riding a sub heading to a friendly outpost): 3×
    speed (Smuggler ability retained).
- **Promotes**: terminal.
- **Stacking**: globals additive; locals at the same Factory are also
  additive (two Tycoons at the same Factory → +6/cycle local).
- **Counters**: Assassin on Tycoon's sub; capture the Tycoon's outpost.

### 8.5 Inspector

- **Where**: ability fires at an outpost. The Inspector is mobile —
  a classic opening loads a freshly-hired Inspector onto a sub bound
  for a dormant Generator so that outpost lands with a full shield
  the instant it's claimed.
- **CP**: none. *(Inspector's recharge is a post-combat effect, but
  not a "post-driller" combat slot — it fires after Phase 4
  completes, only if the Inspector survived.)*
- **Effect**:
  - On arrival at an outpost: instantly sets that outpost's shield
    charge to its max.
  - After every combat at the Inspector's outpost (if the outpost
    holds and the Inspector survives): instantly sets shield to max.
- **Promotes**: Security Chief.
- **Stacking**: redundant (binary full-charge).
- **Counters**: Infiltrator (still drains during Phase 1; Inspector
  only recharges after); outpost capture (Inspector becomes captive,
  recharge does not fire for the new owner).

### 8.6 Security Chief (promoted from Inspector)

- **Where**: sub or outpost.
- **CP**: none.
- **Effect**:
  - **Global**: +10 *max* shield charge to every outpost the player
    owns. Stacks additively per Security Chief.
  - **Local** (at the Security Chief's outpost): an additional +10
    max shield.
  - Inspector's on-arrival and post-combat full-recharge **retained**
    (at the Security Chief's own outpost only).
- **Promotes**: terminal.
- **Stacking**: globals additive; locals at the same outpost additive
  per Security Chief.
- **Counters**: Infiltrator (still drains during combat).

### 8.7 Double Agent

- **Where**: sub.
- **CP 5**.
- **Effect**: in sub-vs-sub combat, when the Double Agent fires it:
  1. destroys *all* drillers on both subs;
  2. swaps ownership of both subs, including the Double Agent itself
     and every other specialist aboard;
  3. ends the combat immediately (no further phases).

  Both swapped subs then continue toward their original destinations
  (now under new ownership). Their `arrivalAt` is unchanged.
- **Promotes**: terminal.
- **Stacking**: irrelevant (combat ends on first fire).
- **Counters**: Revered Elder (CP 2 < 5); Martyr (CP 1); a Saboteur
  on the same sub does **not** fire (Saboteur is post-driller, Double
  Agent ends combat before the driller phase).

### 8.8 Diplomat

- **Where**: ability fires at an outpost (the captive-release scan
  is from the Diplomat's *current* outpost's sonar bubble). The
  Diplomat is mobile — pair her with a Princess or IO at the same
  outpost to extend her release reach.
- **CP**: none. (Acts on captives outside of combat.)
- **Effect**: at every tick of the sim, the Diplomat scans for the
  player's own captive specialists held at *any outpost within the
  Diplomat's outpost's sonar range*. For each such captive, a 1×
  speed sub is generated from the holding outpost, carrying that
  specialist, bound for the **original owner's nearest friendly
  outpost** (measured from the holding outpost). The captive is
  removed from the holder's captive list at the same tick; the sub
  is non-gift, non-combat (it is treated like a gift sub for the
  purposes of mirror-route immunity, but the cargo is a specialist,
  not a driller payload).

  If the holding outpost has an enemy Hypnotist as well, the
  Diplomat preempts the Hypnotist — release fires before conversion
  on the same tick.
- **Promotes**: terminal.
- **Stacking**: not really — first Diplomat in range releases each
  captive; subsequent Diplomats see an empty captive list.
- **Counters**: capture the outpost holding the Diplomat; place the
  captives' holding outpost outside any Diplomat's sonar.

---

## 9. Other (Utility) Specialists

### 9.1 Intelligence Officer

- **Where**: sub or outpost.
- **CP**: none.
- **Effect**:
  - **Global**: +25% sonar range at *every* outpost the player owns
    (additive per IO — 2 IOs → +50%).
  - **!** The original Subterfuge IO also revealed every outpost's
    *kind* across the map. In this reimplementation outposts are
    common knowledge (see `docs/07`), so the kind-reveal effect is
    a no-op. IO is purely informational via the sonar range boost.
- **Promotes**: terminal.
- **Stacking**: sonar additive; type-reveal redundant.
- **Counters**: none — IO is purely informational.

### 9.2 Tinkerer

- **Where**: ability fires at the Tinkerer's current outpost. The
  Tinkerer is mobile and can be ferried between outposts; the
  electrical bonus and shield drain are paused while she's on a sub
  and resume at her new outpost on arrival.
- **CP**: none.
- **Effect**:
  - **Local**: adds `3 × outpost.maxShieldCharge` to that outpost's
    electrical output (so 30 for a weak-shield outpost, 60 for
    strong, including +20 if the Queen is there or +10/+20 if SC is
    there, etc. — the max is evaluated *live*, after Queen/SC/King
    modifiers).
  - **Local**: drains the outpost's shield charge at a rate of 3 per
    hour, continuously. Drain runs whether or not combat is
    happening; floors at 0.
- **Promotes**: Minister of Energy.
- **Stacking**: at the same outpost, additive (2 Tinkerers → +6×max
  electrical, -6/hour drain).
- **Counters**: Infiltrator (further drains shield to 0 in combat —
  but Tinkerer's drain is the constant problem); Inspector (recharges
  after every combat, undoing the drain temporarily).

### 9.3 Minister of Energy (promoted from Tinkerer)

- **Where**: sub or outpost.
- **CP**: none.
- **Effect**:
  - **Global**: +300 electrical output to the player.
  - **Global**: −1 driller per Factory production cycle, *per
    Factory*. (So a player with 4 Factories and 1 MoE loses 4
    drillers per cycle wave.)
- **Promotes**: terminal.
- **Stacking**: per-MoE additive on both effects.
- **Counters**: Tycoon's +3/cycle local can offset MoE's penalty at
  the same Factory.

### 9.4 Foreman

- **Where**: ability fires at a Factory. The Foreman is mobile and
  can be relayed between Factories (commonly via a Smuggler-loaded
  sub for 3× transit) so two Factories get the +6 boost on alternate
  cycles. While the Foreman is on a sub, or at an outpost that
  isn't a Factory, the bonus is dormant.
- **CP**: none.
- **Effect**: +6 drillers per production cycle at the Foreman's
  Factory (so a base 6/cycle Factory with a Foreman produces 12/cycle).
- **Promotes**: Engineer.
- **Stacking**: at the same Factory, per-Foreman additive (2 Foremen
  → +12/cycle).
- **Counters**: capture the Factory.

### 9.5 Engineer (promoted from Foreman)

- **Where**: sub or outpost.
- **CP**: none — Engineer fires in the **post-driller** combat slot.
- **Effect**: after a combat the Engineer's owner **wins**, restores
  `ceil(25% × drillersLostThisCombat)` drillers to the winner.
  - **Global**: 25% per Engineer the player owns anywhere on the map.
  - **Local**: an additional 25% if the Engineer was at the combat
    site (on a winning sub, or at a winning outpost).
- **Promotes**: terminal.
- **Stacking**: globals additive (3 Engineers → +75% from globals
  alone). With a local Engineer on top, +100% — total recovery
  matches losses. With more Engineers it can *exceed* losses;
  drillers above the loss line are also restored (so the winning
  side's post-combat driller count can be higher than its pre-combat
  count). Drillers added are clamped to the electrical cap at the
  end of the tick (existing cap rule from
  `docs/03_drillers_production.md`).
- **Counters**: Thief — the Thief's "stolen" drillers do not count
  as losses for Engineer (they are converted, not destroyed), so
  Thief + Engineer-rich opponent is a net positive for the opponent.
  Make the Engineer fire on `lostDrillers = preCombat - postCombat -
  stolenByThief - convertedByDoubleAgent` so it only restores actual
  destroyed drillers.

### 9.6 Hypnotist

- **Where**: ability fires at the Hypnotist's current outpost
  (converts captives present there). The Hypnotist is mobile — send
  her to whichever outpost is currently holding enemy captives you
  want to flip.
- **CP**: none. (Acts on captives outside of combat.)
- **Effect**: at every tick of the sim, the Hypnotist takes control
  of every captive specialist held *at the Hypnotist's own outpost*.
  Converted specialists become active specialists of the Hypnotist's
  owner; they spawn at the Hypnotist's outpost.

  If a Diplomat in sonar range targets the same captive on the same
  tick, the Diplomat resolves first (the captive goes home, not to
  the Hypnotist).
- **Promotes**: King.
- **Stacking**: Hypnotists at different outposts each convert
  whatever captives are at their respective outposts. Multiple
  Hypnotists at the same outpost — redundant (first converts).
- **Counters**: enemy Diplomat in sonar range; Assassin in any
  combat at the Hypnotist's outpost (kills the Hypnotist before it
  can convert this tick).

### 9.7 King (promoted from Hypnotist)

- **Where**: sub or outpost.
- **CP**: post-spec, post-CP-7, before shield phase (same slot as
  General). Fires in combats at the King's own location only — that
  is:
  - If the King is at an outpost being attacked, fires in that
    combat.
  - If the King is on a sub in combat (mirror-route or sub-vs-sub
    encounter), fires in that combat.
- **Effect**:
  - **Local combat**: destroys `floor(myRemainingDrillers / 3)` enemy
    drillers. ("My remaining drillers" = the King's side's drillers
    surviving Phase 1 specialists up to this slot.)
  - **Global**: every outpost the player owns has its *max shield
    charge* reduced by 20 — except the King's own outpost, which
    has *+20* max shield charge. Net effect: −20 elsewhere, neutral
    at the King's outpost.
  - **Local (at King's outpost)**: retains Hypnotist's capture
    conversion.
- **Promotes**: terminal.
- **Stacking**: combat damage additive per King in the combat.
  Shield modifier additive per King: 2 Kings at separate outposts →
  every outpost the player owns gets −40 max shield except those two
  (which get net 0).
- **Counters**: Revered Elder; Martyr; Infiltrator (since the
  shield-network is already weakened).

### 9.8 Navigator

- **Where**: sub.
- **CP**: none.
- **Effect**: while in flight, the Navigator's owner may issue a
  course-change order rewriting the sub's `destinationId`. The new
  arrival time is recomputed from the sub's current position. Any
  number of course changes are allowed.
- **Promotes**: Admiral.
- **Stacking**: irrelevant (any number of course changes is the same
  as one).
- **Counters**: Pirate (still chases regardless of course); Saboteur
  (post-driller redirect overrides the Navigator's manual course).

### 9.9 Admiral (promoted from Navigator)

- **Where**: sub.
- **CP**: none.
- **Effect**:
  - **Local**: the Admiral's own sub travels at 1.5× speed.
  - **Global passive**: every sub the player owns that is **not**
    carrying any specialist gets +50% speed per Admiral the player
    owns (1 Admiral → 1.5×, 2 → 2.0×, additive).
  - **Loses** Navigator's mid-flight course-change ability.
- **Promotes**: terminal.
- **Stacking**: local 1.5× is mutually exclusive with other local
  speed specialists on the same sub (§10); global is fully additive
  across Admirals.
- **Counters**: Saboteur in any sub-vs-sub the Admiral hits; Pirate;
  Assassin on the Admiral's sub.

### 9.10 Helmsman

- **Where**: sub.
- **CP**: none.
- **Effect**: the carrying sub travels at 2× speed.
- **Promotes**: terminal.
- **Stacking**: mutually exclusive with other local speed
  specialists (§10).
- **Counters**: Pirate; Saboteur.

---

## 10. Sub Speed Modifier Stacking

This is the **canonical rule**: on any single sub, **at most one
local speed modifier applies, and it is the largest**. The local
speed modifiers are:

| Specialist          | Local speed |
|---------------------|-------------|
| Smuggler (heading to own outpost) | 3.0× |
| Helmsman            | 2.0×        |
| Pirate (toward target sub)        | 2.0× |
| Pirate (return to own outpost)    | 4.0× |
| Admiral             | 1.5×        |
| General             | 1.5×        |
| Lieutenant          | 1.5×        |

Notes:

- **Highest-wins**: Helmsman + Lieutenant on the same sub = 2.0×
  (not 3.0×, not 2.5×). Helmsman + Smuggler heading to own outpost =
  3.0×. Pirate always overrides during chase / return regardless of
  what else is on board.
- **Smuggler's 3× is conditional**: if the sub's current destination
  is not owned by Smuggler's owner *at the moment*, Smuggler's
  contribution is 1.0× and falls out of the max.
- **Admiral global passive** is *separate* from this rule: it adds
  +50% per Admiral to every sub the player owns that carries *no
  specialist*. It does not interact with the local-max calculation
  because by definition the sub it boosts has no local speed
  specialist anyway.
- **Speed re-evaluation**: the effective multiplier is recomputed
  on every sim event that could change it — sub launch, specialist
  embark/disembark (only at launch in normal play), destination
  capture or recapture (affects Smuggler), Saboteur redirect
  (affects Smuggler if redirect lands on a non-friendly outpost).
- **`arrivalAt` is recomputed** whenever the effective multiplier
  changes. This means a Smuggler's arrival time stretches if you
  lose the destination mid-flight, and compresses again if you
  recapture it.

---

## 11. Global vs Local Stacking Cheat Sheet

| Specialist           | Local effect                         | Global effect                          | Both stack? |
|----------------------|--------------------------------------|----------------------------------------|-------------|
| General              | 1.5× speed (its sub)                 | +10 drillers/combat where you have any spec | global additive |
| King                 | 1-per-3 driller in combat at King's outpost; +20 max shield at King's outpost; converts captives at King's outpost | −20 max shield at every owned outpost | global additive (every King contributes) |
| Tycoon               | +3 drillers/cycle at Tycoon's Factory; 3× speed (sub) | +50% Factory rate            | both additive   |
| Engineer             | +25% post-victory restore at battle site | +25% per Engineer anywhere       | additive        |
| Security Chief       | +10 max shield at own outpost; Inspector full-recharge | +10 max shield at every owned outpost | additive |
| Admiral              | 1.5× speed (its sub)                 | +50% per Admiral to no-spec subs      | additive        |
| Intelligence Officer | n/a                                  | +25% sonar per IO; reveal kinds        | additive        |
| Minister of Energy   | n/a                                  | +300 electrical; −1 driller/cycle/Factory | additive    |
| Foreman              | +6 drillers/cycle at Foreman's Factory | n/a                                  | local only      |
| Tinkerer             | +3×max shield electrical; −3/hour shield drain | n/a                          | local only      |
| Princess             | +50% sonar at own outpost            | n/a                                    | local only      |
| Queen                | +150 electrical + +20 max shield at own outpost | hire timer (no numeric effect)| local only      |

---

## 12. Royalty Succession

- A player **must** have exactly one active Queen at all times. Loss
  of the active Queen triggers succession **the same tick** as the
  loss. There is no "Queenless for a tick" state — succession is
  atomic with the loss event.
- **Succession order**:
  1. If the player has at least one active (non-captive) Princess,
     the **nearest** Princess to the lost Queen's location promotes.
     "Nearest" = smallest Euclidean distance on the torus from the
     Princess's outpost to the lost-Queen location. Tie-break on
     outpost id ascending.
  2. Otherwise, the player is **eliminated**: all their outposts
     become dormant (per `docs/10_game_flow_and_lifecycle.md`); all
     their in-flight subs are destroyed; all their specialists
     anywhere on the map are destroyed (Princesses included — there
     are none, by hypothesis); captives held by other players are
     released to nowhere (they vanish — the original owner is gone).
- **Demotion to Princess**: if a player acquires a *second* Queen
  via gift sub or Hypnotist conversion, the incoming Queen is
  immediately demoted to Princess on the receiving tick. The
  original Queen stays Queen.

---

## 13. Resolutions of Source Conflicts

Where the rulebook, wiki, and forums disagreed, this is what we
chose to implement:

| # | Question | Resolution |
|---|----------|------------|
| 1 | Infiltrator drain magnitude | **Drains the ENTIRE live shield charge to 0**, regardless of how many Infiltrators are aboard. One is enough — additional Infiltrators are redundant for drain (they still occupy slots and can be Assassin targets, but don't compound). Matches the rulebook literally; supersedes earlier "20 per Infiltrator" speculation. |
| 2 | Saboteur "nearest" reference | **Nearest outpost of Saboteur's owner**, measured from the *redirected sub's current position*. |
| 3 | Admiral retains Navigator? | **No.** Admiral loses mid-flight course-change. |
| 4 | King retains Hypnotist? | **Yes** at the King's outpost only. |
| 5 | Engineer >100% restore? | **Yes** — multiple Engineers can over-restore; drillers above pre-combat count are allowed, capped only by the player's electrical cap at end of tick. |
| 6 | Princess sonar stacking | **No** — multiple Princesses at the same outpost contribute only +50% local sonar (saturating). |
| 7 | Tinkerer / Foreman same-outpost stacking | **Yes**, additive. |
| 8 | Hire-pool RNG | Deterministic per `(worldSeed, playerId, hireIndex)`. Independent per player. |
| 9 | Royalty in hire pool | **Never** — Princess and Queen are never hireable. Princess only arises via Queen-demotion. |
| 10 | Captives killed by Assassin | **No** — captives "do not participate in combat", so Assassin's target set excludes them. |
| 11 | Inspector recharge on outpost loss | **No** — the Inspector is captive; recharge does not fire for new owner. |
| 12 | Sentry timer cadence | Per-Sentry, started on hire/arrival; reset on shot. Wall-clock, not synced. |
| 13 | Hire previous-offer exclusion | Applies to **offered** identity (not just hired), regardless of whether the previous hire was used to promote. |
| 14 | Engineer post-victory restore base | `lostDrillers` excludes drillers converted by Thief or destroyed by Double Agent — only "destroyed in driller phase" counts. |
| 15 | Are any specialists outpost-locked? | **No.** Per the rulebook, "subs can transport drillers and specialists" — every kind (Queen included) can be loaded onto a sub. The "Where" label per entry describes where the *ability fires*, not where the *unit may be*. The only loading restriction is on *captive* specialists, who may only board a sub as the cargo of a Diplomat release. |

---

## 14. Implementation Notes

- **Specialist as data**: model each specialist as
  `{ id, kind, ownerId, location: SpecialistLocation, state: 'active'|'captive', captiveOf?: PlayerId }`
  where `SpecialistLocation` is one of `{ outpost: OutpostId }`,
  `{ sub: SubId }`. `world.specialists: Specialist[]` is the
  authoritative list.
- **Hire schedule**: per-player `nextHireAt: number` and `hireIndex:
  number`. Hire fires when sim time reaches `nextHireAt` AND the
  player's Queen is at one of their outposts; otherwise the hire is
  deferred (re-checked on the next event involving that Queen).
  After a hire (or skip-to-promote) `hireIndex += 1` and
  `nextHireAt += 18h`.
- **Combat order**: replace the current Phase 1 stub with a real
  CP-walker. CP buckets in order: 1, 2, 3 (announce-only — Saboteur
  is post-driller), 4, 5, 6, 7, post-spec (General/King). After
  Phase 1 ends, if combat was not terminated by Double Agent, run
  Phase 2 (shield, if outpost), Phase 3 (driller), post-driller
  (Saboteur, Engineer), Phase 4 (capture). Engineer's restore goes
  through after captures complete.
- **Sentry tick**: model as a per-Sentry `nextFireAt` analogous to
  `nextProductionAt` for Factories — schedule alongside other events
  in the main tick loop.
- **Tinkerer drain**: continuous; commit at each event that consults
  shield charge (similar to how `currentShieldCharge` already
  computes recharge live). Introduce `shieldDrainPerHour` derived
  from Tinkerer count at the outpost.
- **Diplomat / Hypnotist**: each acts as a per-tick captive scan.
  Resolve in priority order on the same tick: Diplomat first
  (releases captives in sonar), then Hypnotist (converts whatever
  remains at its outpost).
- **Speed cache**: each sub stores its current `speedMultiplier` and
  `nextSpeedRecomputeAt` (typically launch time; for Smuggler, the
  next destination ownership change). The tick loop already handles
  these arrivals; we add an event type for "speed recompute".

---

## 15. Quick-Reference Combat Priority Table

```
Phase 1 (Specialist):
   CP  1   Martyr
   CP  2   Revered Elder
   CP  3   (Saboteur announces — fires post-driller)
   CP  4   Infiltrator, Thief         (simultaneous)
   CP  5   Double Agent               (ends combat on fire)
   CP  6   Assassin
   CP  7   Lieutenant, War Hero       (simultaneous)
   post   General (+10 globally per General),
          King   (1-per-3 driller at King's outpost only)

Phase 2 (Shield)                       (skipped in sub-vs-sub)

Phase 3 (Driller)

   post   Saboteur (redirect, sub-vs-sub only)
          Engineer (25% × Engineers globally + 25% × locals if at site)

Phase 4 (Capture)
```

---

## 16. Common Counter Pairings

- **Assassin vs Revered Elder**: Elder fires at CP 2; Assassin (CP 6)
  is silenced.
- **Pirate vs Saboteur**: Saboteur (post-driller) redirects the
  Pirate's sub if combat resolves at all; if the Pirate's sub also
  has a Double Agent, the DA at CP 5 ends combat first.
- **Infiltrator vs Inspector**: Infiltrator (CP 4) drains during
  Phase 1; Inspector's full-recharge only fires if the outpost
  holds. Strong shield + Inspector + low Infiltrator count = the
  outpost is permanently at full charge between waves.
- **Martyr vs anything**: Martyr's CP 1 blast destroys before any
  other specialist resolves. Avoid the radius, or kill the Martyr's
  carrying sub pre-combat.
- **Engineer + Thief**: Thief converts enemy drillers (no Engineer
  restore on those — they were not "lost"). Bring Engineer for the
  drillers genuinely destroyed in driller phase.
- **Pirate + Assassin**: the canonical Queen-snipe combo — Pirate
  forces a sub-vs-sub vs the Queen-carrying sub; Assassin (CP 6)
  kills the Queen during Phase 1.
- **Smuggler/Pirate vs Navigator**: the Navigator's owner can re-aim
  in a feint; Pirate keeps chasing regardless.
- **Double Agent vs Saboteur** (both on same enemy sub): Saboteur is
  post-driller, Double Agent is CP 5 in Phase 1 — Double Agent ends
  combat before the Saboteur fires.

---

## 17. Non-Existent Specialists (Often Confused With Subterfuge)

These names appear in other strategy games but **do not** exist in
Subterfuge — do not implement:

Theologian, Industrialist, Scientist, Revolutionary, Toxicologist,
Wraith, Provocateur, Reaver. "Driller" is the basic unit, not a
specialist.
