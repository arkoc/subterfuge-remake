# Combat

Combat in Subterfuge is **fully deterministic**. There is no random
number generator, no dice roll, no chance modifier anywhere. Given the
inputs to a battle, the output is the same every time. This determinism
is what makes the Time Machine work: future battle outcomes can be
predicted exactly from current knowledge.

This file documents the complete combat resolution algorithm — the four
phases, how specialists modify them, how shields apply, what happens to
the loser's drillers and specialists, and the edge cases that catch
implementers.

## When Combat Happens

Combat occurs in exactly two situations:

1. **Sub-vs-Outpost**: a hostile sub arrives at an outpost.
2. **Sub-vs-Sub**: two hostile non-gift subs encounter each other in
   transit. The encounter condition per the rulebook is: the two subs
   are **traveling between the same pair of outposts in opposite
   directions** (Sub A: X → Y and Sub B: Y → X) and their paths meet
   while both are in flight. They collide at the meeting point and
   resolve combat there.

The encounter is fully deterministic from the launch / arrival times
of both subs (see `02_subs.md` for the meeting-time formula). No
specialists are required — two ordinary subs on mirror routes will
fight.

**Other crossing geometries do not fight passively.** Two subs whose
paths happen to cross — but who are not on the same two-outpost
corridor — sail past each other untouched. Forcing such an encounter
requires a **Pirate** specialist (which lets the carrier sub *target*
any visible enemy sub regardless of route) or other specialist
mechanics (e.g. Saboteur redirecting).

**Gift subs** never participate in sub-vs-sub combat. If either sub in
a mirror-route encounter is a gift, both pass without incident.

## Sides

A combat has two sides:

- **Attacker**: the incoming sub (or, in sub-vs-sub, the sub that was
  ordered to engage).
- **Defender**: the outpost being arrived at, or the other sub.

Each side has:

- A count of drillers.
- Zero or more specialists.
- (Outpost defender only) a shield with current charge.

Multiple attacking subs arriving in the same world tick combine into
one attacker pool. Multiple defenders never combine across owners; each
opposing party fights its own battle.

## The Four Phases

Every combat resolves in this order:

1. **Specialist phase**
2. **Shield phase** (skipped in sub-vs-sub combat)
3. **Driller phase**
4. **Capture phase**

Specialists in each phase apply their abilities, then the next phase
runs on the post-effect numbers. Each phase is "complete" before the
next begins.

### Phase 1 — Specialists

All specialists on both sides participate. Their order of resolution is
governed by **combat priority** — a numeric attribute. Specialists with
**lower priority numbers act first**. Specialists with identical
priority numbers act **simultaneously** (their effects are computed on
the same pre-phase state, then all applied at once).

Canonical combat priorities (full details in `05_specialists.md`):

| Priority | Specialist          | Effect                                                              |
|----------|---------------------|---------------------------------------------------------------------|
| 1        | Martyr              | Destroys all subs/outposts within `0.20 × SONAR_RANGE` blast radius |
| 2        | Revered Elder       | If exactly one side has an RE, no other specialists participate     |
| 3        | (Saboteur announced — fires post-driller, see below) |                                                  |
| 4        | Thief               | Converts 15% (ceil) of enemy drillers to your side (sequential when stacked) |
| 4        | Infiltrator         | Drains the ENTIRE shield charge to 0, regardless of count (outpost combat only) |
| 5        | Double Agent        | Both subs' drillers destroyed; subs swap owners; combat ends        |
| 6        | Assassin            | Kills all enemy specialists                                         |
| 7        | Lieutenant          | Destroys 5 enemy drillers                                           |
| 7        | War Hero            | Destroys 20 enemy drillers                                          |
| 7        | Sentry              | *No in-combat damage* — Sentry is a pure passive (2h between-combat sniping). See "Sentry Attrition (Pre-Arrival)" below. |
| post     | General             | +10 enemy drillers per General globally, every combat where you have any specialist |
| post     | King                | At King's outpost only: destroys `floor(myDrillers/3)` enemy drillers |

Two specialists carry a CP number but mechanically fire **after the
driller phase**:

- **Saboteur** (CP 3 for veto-ordering): post-driller. If the
  saboteur's side LOSES the driller phase, the surviving enemy sub is
  redirected to its **own** owner's nearest outpost — i.e. sent home,
  denying the attacker their target. If the saboteur's side wins or
  ties, the ability is silent (no surviving enemy to redirect).
  Sub-vs-sub only.
- **Engineer** (no CP slot): if the Engineer's owner won, restores 25%
  of the winning side's lost drillers per Engineer globally, plus 25%
  more if an Engineer was on the winning side at the battle site.

Key interactions:

- **Revered Elder** silences every other specialist in the combat —
  including post-driller (Saboteur, Engineer) and post-spec (General,
  King) effects — unless both sides have an RE. Martyr (CP 1) fires
  first and is the canonical RE counter; the RE is destroyed in the
  blast before it can silence anything.
- **Martyr** destroys *all* subs/outposts within `0.20 × SONAR_RANGE`,
  friend and foe alike. The radius is fixed (not modified by
  Intelligence Officer or Princess).
- **Saboteur** redirects the enemy sub to the **Saboteur's owner's**
  nearest outpost, measured from the redirected sub's *current*
  position. Sub-vs-sub only.
- **Double Agent**'s CP-5 effect ends combat immediately. Phases 2–4
  do not run. Saboteur/Engineer post-driller hooks do not fire.
- **Assassin** does **not** kill captive specialists at the outpost
  (captives do not "participate in combat").
- **Caps**: Assassin and Saboteur are each capped at **2 active per
  player**. Captives don't count toward the cap.

### Phase 2 — Shield

Skipped in sub-vs-sub combat. In sub-vs-outpost combat:

```
defender_shield = outpost.shield_current
shield_absorbed = min(defender_shield, attacker_drillers_remaining)
attacker_drillers_remaining -= shield_absorbed
outpost.shield_current = defender_shield - shield_absorbed
```

The shield consumes attacker drillers 1-for-1 until exhausted or until
no attackers remain. Defender drillers are untouched by the shield
phase. The Infiltrator's Phase-1 effect can pre-drain the shield to 0
before this phase, neutralising it.

After the shield phase the outpost's `shield_current` is reduced by
exactly the amount absorbed, and the **48-hour recharge clock continues
to tick** from wherever the shield is now.

### Phase 3 — Driller

```
if attacker_drillers > defender_drillers:
    winner = attacker
    winner_remaining = attacker_drillers - defender_drillers
elif attacker_drillers < defender_drillers:
    winner = defender
    winner_remaining = defender_drillers - attacker_drillers
else: # tie
    winner = defender   # ties go to the defender
    winner_remaining = 0  # defender keeps 0 drillers; outpost stays defender's
```

A tie destroys both sides' drillers but the outpost stays with the
defender. The attacker loses its entire driller force.

In **sub-vs-sub combat with a driller tie**, both sides' drillers are
destroyed and specialists from each side return to their owner's
nearest friendly outpost (instead of being captured, since there is no
winner).

### Phase 4 — Capture

The **losing side's specialists** become **captives** of the winner.
Captives are held at the winning outpost (or, if the combat was in
mid-ocean, at the winner's nearest friendly outpost when the sub later
docks).

Captive properties:

- Captives are **inactive** — their abilities do not apply.
- Captives can be **released** by a Diplomat (sent home on a 1× sub).
- Captives can be **converted** by a Hypnotist on the outpost where
  they are held.
- Captives do not count toward any specialist limits (e.g., the 2 Assassin
  cap applies to the captor's active Assassins, not their captured ones).

If the loser's Queen is captured, that loser is **eliminated** — unless
they have an active Princess somewhere on their map, in which case the
nearest Princess automatically promotes to Queen and the player
continues.

## Engineer Post-Combat Recovery

After a victorious combat, an **Engineer** specialist (a promoted
Foreman) restores `ceil(25% × drillersLostThisCombat)` drillers to the
winning side. Sources of restoration are additive:

- **Per Engineer globally**: +25% of losses per Engineer the winning
  player owns anywhere on the map.
- **Local bonus**: an additional +25% if at least one Engineer was at
  the battle site (on a winning sub, or at a winning outpost).
- Multiple Engineers stack additively without cap; total recovery can
  exceed 100% of losses (the winning side's post-combat driller count
  can be higher than its pre-combat count).
- `drillersLostThisCombat` counts only drillers **destroyed in Phase
  3** — drillers converted by a Thief, or removed by a Double Agent
  swap, are not "losses" for Engineer purposes.
- Losing combats trigger no restoration (you must win).

## Sentry Attrition (Pre-Arrival)

A **Sentry** at an outpost fires every 2 hours at any enemy sub within
**half the outpost's sonar range**, destroying **5% (rounded up) of
that sub's drillers per shot**. This happens before the sub arrives.

Anti-Sentry counter: small subs of ~20 drillers each take exactly 1
driller of damage per shot (5% of 20 = 1, ceiling). Sending many small
subs blunts a Sentry's effect.

The Sentry is **pure passive** — she fires *between combats* (the 2-hour
attrition cycle) but contributes no in-combat damage. Subs being
chewed on by Sentry attrition arrive with fewer drillers than they
launched with; the loss happens before combat resolution begins.

## Worked Example — Sub-vs-Outpost

A sub with 60 drillers and a Lieutenant attacks an outpost defended by
20 drillers, a Sentry, and a strong shield (current charge 15). The
Sentry has been attriting the inbound sub for two 2-hour cycles, so
the sub arrives with `60 - 3 - 3 = 54` drillers (each cycle: `ceil(5%
× 60) = 3`, `ceil(5% × 57) = 3`).

- **Specialist phase**:
  - Lieutenant (CP 7) destroys 5 enemy drillers → defender 15.
- **Shield phase**: shield 15 absorbs 15 attackers → attacker 39;
  shield → 0.
- **Driller phase**: 39 vs 15 → attacker wins, 24 drillers remaining.
- **Capture phase**: the Sentry (defender's surviving specialist) is
  captured.

Outcome: outpost changes hands, attacker garrisons 24 drillers, Sentry
becomes a captive.

## Worked Example — Sub-vs-Sub

Sub A (40 drillers, Pirate, Helmsman) targets Sub B (30 drillers,
Saboteur).

- **Specialist phase** (no Shield phase in sub-vs-sub):
  - Saboteur (priority 3) fires first → redirects Sub A's owner's sub
    (Sub A) to its own owner's nearest outpost. Combat resolves between
    the two but Sub A's intercept is broken.
  - In the real game, with Pirate ordering the engage and Saboteur
    redirecting it, the rulebook resolves Saboteur first (priority 3),
    cancelling Pirate's intercept. The two subs do **not** actually
    fight; Sub A returns home, both keep their cargo, neither side
    loses drillers.

This example illustrates why specialist priority matters: a lower
priority can outright cancel the encounter.

## Combat Preview

When a hostile sub enters one of the defender's sonar bubbles, the
defender's UI shows a **combat preview** — a deterministic prediction
of the battle outcome at the projected arrival time. The preview
includes:

- Current driller counts on both sides.
- Specialist abilities and their order of resolution.
- Projected shield charge at arrival.
- Estimated drillers remaining after the fight.

The preview is fully accurate given the visible information — if the
attacker has hidden specialists outside sonar, the preview won't show
them.

## Edge Cases

- **Multiple attackers from one player same tick**: combine into one
  attacker pool; sum drillers and specialists.
- **Multiple attackers from different players same tick**: resolve in
  arrival time-order; in pure ties, the defender's order of preference
  is implementation-defined but typically alphabetical by attacker
  player ID. Each combat is independent and runs against the surviving
  defender from the previous one.
- **Attacker driller count of 0 after specialist phase**: defender wins
  by default; the attacker loses all specialists as captives.
- **Both sides 0 drillers after specialist phase**: tie; defender keeps
  outpost; specialists swap as captives if it's an outpost battle
  (defender captures attacker specialists; attacker had 0 surviving
  drillers so no shield drain occurred).
- **Defender 0 drillers, shield > 0**: shield still absorbs attackers
  in shield phase, leaving fewer attackers for the driller phase.
- **Defender 0 drillers, shield 0**: attacker captures with 0 losses;
  any attacker specialists capture any defender specialists.

## Implementation Reference Algorithm

```python
def resolve_combat(attacker, defender, is_outpost):
    # Phase 1: Specialists
    specialists = attacker.specs + defender.specs
    for prio in sorted_unique_priorities(specialists):
        actors = [s for s in specialists if s.priority == prio]
        apply_simultaneously(actors, attacker, defender, is_outpost)
        if combat_ended_by_double_agent_or_martyr: return

    # Phase 2: Shield (outpost only)
    if is_outpost:
        absorbed = min(defender.shield, attacker.drillers)
        attacker.drillers -= absorbed
        defender.shield -= absorbed

    # Phase 3: Driller
    if attacker.drillers > defender.drillers:
        winner, loser = attacker, defender
        winner_drillers = attacker.drillers - defender.drillers
    else:
        winner, loser = defender, attacker
        winner_drillers = defender.drillers - attacker.drillers

    # Phase 4: Capture
    capture(winner, loser.surviving_specs)

    # Engineer post-combat
    if engineer_global(winner) or engineer_local(winner, battle_site):
        winner_drillers += ceil(winner.drillers_lost * 0.25)

    return Outcome(winner=winner, drillers=winner_drillers)
```

## Non-Combat Outcomes That Look Like Combat

These resolve **without** the 4-phase combat:

- Friendly sub arriving at friendly outpost: just merges.
- Gift sub arriving at the target's outpost: just transfers.
- Sub arriving at a dormant (neutral, unowned) outpost: just claims it.
- Two friendly subs from same player crossing: nothing.
- Two enemy subs crossing without a Pirate ordering engagement: nothing.

These distinctions are important. Implementations that route every
arrival through the combat function will produce wrong results.
