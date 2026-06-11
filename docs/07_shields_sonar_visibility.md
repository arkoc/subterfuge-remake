# Shields, Sonar, and Visibility

Subterfuge has two defensive layers and one informational layer that
intertwine in subtle ways. **Shields** protect outposts from incoming
drillers; **sonar** determines what each player can see; together with
the game's strict fog of war, they create the bluff-and-deduction
texture that makes diplomacy meaningful.

This file documents:

- The full shield model (weak/strong, recharge, modifiers).
- The full sonar / visibility model (what's seen, what's hidden, by
  whom).
- How shields and sonar interact (Sentry, Inspector, Infiltrator).
- What is *always* visible to all players (mines).

## Shields

### Shield Strength

Every outpost has a fixed shield type assigned at map generation:

- **Weak shield**: max charge **10**.
- **Strong shield**: max charge **20**.

Strong shields are less common than weak shields on the map. The
shield type is a property of the *outpost*, not the owner, and does
not change when ownership changes. When a player captures an outpost
they inherit whatever shield type was already there.

### Recharge

- All shields begin a game **fully discharged (0)**.
- Shields recharge **linearly** to their max over **48 hours**.
- Recharge rate: `max_charge / 48 h` (so weak shields gain ≈ 0.208
  charge/hour; strong shields gain ≈ 0.417 charge/hour).
- Recharge runs continuously regardless of combat; combat just
  consumes charge and the timer keeps running on whatever's left.

A weak shield that was just drained to 0 will be back to 10 in 48
hours. A strong shield drained to 0 will be back to 20 in 48 hours
(yes, strong shields recharge in absolute units faster).

### Shield Modifiers (Max Charge)

A number of specialists raise or lower the **maximum** shield charge
of one or more outposts:

| Specialist            | Effect on Max Shield                                  |
|-----------------------|-------------------------------------------------------|
| Queen at outpost      | +20 at her outpost                                    |
| Security Chief        | +10 global, +10 additional local (so +20 at her own)  |
| King at outpost       | −20 global, +20 at his outpost (net: own +0, others −20)|
| Tinkerer at outpost   | Drains 3 charge/hour from his own outpost (no max change)|

The Inspector specialist does not change max charge but **instantly
refills** the outpost's shield to full on arrival and after any combat
at that outpost.

### Shield Mechanics in Combat

- Shields apply **only in sub-vs-outpost combat**, never sub-vs-sub.
- Shields consume attacker drillers **1-for-1** during the Shield
  phase of combat (phase 2 of 4 — see `04_combat.md`).
- **Infiltrator** (attacker specialist, priority 4) drains all shield
  charge to 0 in the Specialist phase before the Shield phase. A
  defender's strong shield is useless against an Infiltrator-led
  attack.
- Shield charge can drop to 0 mid-combat; the surplus attacker
  drillers continue to the Driller phase.

### Funded Bonus

No diplomacy mechanic grants a shield bonus — economics
affects production, not defence.

## Sonar (Visibility)

### Sonar Range

Each outpost has a **sonar radius** — a continuous-distance bubble
within which the owner sees everything. The radius is the same for
every outpost by default (the rulebook does not publish the exact
distance in map units; implementations typically pick a value such
that two adjacent outposts cover each other's blind spots).

Within an outpost's sonar bubble, the owner sees:

- **Outposts**: their type (Factory/Generator/Mine), current owner,
  current driller count, specialists present, shield strength and
  current charge.
- **Subs**: their position, owner, destination, drillers aboard,
  specialists aboard, projected arrival time.
- **Combat previews**: when an enemy sub is on a trajectory into the
  bubble, the UI shows a deterministic projection of the resulting
  battle.

### Outside Sonar

Outside any of the player's sonar bubbles, the player sees only:

- Their own subs (regardless of where they are).
- The route their subs are flying.
- The location and ownership of **Mines** (mines are globally visible
  — see below).
- The position of outposts they have previously seen (but no info on
  current garrison, shield, owner, or specialists).

In gameplay terms: **a sub sailing through the dark ocean has no
situational awareness** until it enters one of the owner's own sonar
bubbles. This is what makes intercepts possible — the attacker is
flying blind.

### Sonar Modifiers

| Specialist             | Effect on Sonar                                   |
|------------------------|---------------------------------------------------|
| Princess at outpost    | +50% sonar range at her outpost                   |
| Intelligence Officer   | +25% sonar range at every owned outpost; also reveals the *type* (Factory/Generator/Mine) of outposts beyond sonar (without their garrison) |
| Sentry at outpost      | Fires every 2 h within half its outpost's sonar — implicitly extends combat reach, not visibility |

### Combat Preview Accuracy

The combat preview shown to the defender is **exactly accurate** for
all information visible to the defender. If the attacker has a
Lieutenant aboard and the sub is in sonar range, the Lieutenant shows
up in the preview. If the attacker has a Pirate aboard but the sub is
still outside sonar, the Pirate doesn't appear. The deterministic
combat algorithm means the preview never "could go either way" — it
shows the precise outcome given the visible inputs.

Implementers must run the combat algorithm hypothetically using only
the inputs visible to the defender, not the inputs known to the
omniscient server.

## Outposts Are Always Visible (common-knowledge model)

Every **outpost** on the map is **globally visible** to every player
at all times. Outposts are static fixtures of the world map — like
cities on a real-world map. Players always see:

- That the outpost exists at a specific position.
- Its **kind** (Factory / Generator / Mine).
- Its **name**.
- Its current **owner** (or "dormant" if unowned).

Players do **not** see (outside sonar):

- The outpost's driller garrison.
- The outpost's shield charge / max shield.
- Specialists at the outpost (active or captive).
- Production phase / `nextProductionAt`.

The reasoning is twofold: (1) a static map of places anchors player
mental models — players don't have to wonder whether an outpost
"exists" at a coordinate; (2) Neptunium is the win condition, so the
race must be legible. Trailing players need to be able to intelligently
target leaders, which would be impossible if mines could be hidden.

**!** This is a deliberate simplification vs. the original game. The
original Subterfuge hid non-Mine outposts entirely until sonar
discovery. Our reimplementation makes all outposts common knowledge
and gates only their internals.

## Sub Visibility Rules in Detail

A sub is visible to a viewer at time `t` if **any** of the following
is true:

- The viewer is the sub's **owner**.
- The sub is currently within **any of the viewer's outposts' sonar
  ranges**.

A sub is **not** visible just because it was visible a moment ago. As
soon as it leaves the viewer's sonar, it disappears from the viewer's
map.

Notable cases:

- A sub launched from an enemy outpost that is itself outside the
  viewer's sonar is **invisible from launch**. The viewer has no
  warning until the sub crosses into one of their sonar bubbles.
- A sub passing briefly through a sonar bubble appears, then vanishes
  again on exit.
- A sub heading directly at one of the viewer's outposts becomes
  visible the moment it enters that outpost's sonar — even if the
  attacker is also moving through other unowned space.

## Outpost Visibility Rules

Every outpost is **always visible** to every player:

- Position, kind, name, and current owner are common knowledge from
  game start.
- Garrison, shield charge, max shield, and specialists at the
  outpost are visible **only while it's currently in your sonar**.

Outside sonar, the outpost passes through `foggedOutpost` on the
wire: position + kind + name + owner are preserved, everything else
is redacted to zero / placeholder values. The `fogged: true` flag is
set so the client renders the outpost dimmer to signal "you can see
it but not what's inside".

## Interactions Between Shields and Sonar

There is no direct mechanical interaction except via specialists:

- **Tinkerer** at an outpost: trades shield charge (drains 3/hour) for
  electrical output (+3 × max shield). This affects shield, not
  sonar.
- **Inspector**: refills shield to full at the outpost.
- **Sentry**: defensive fire within half-sonar range of its outpost,
  destroying 5% (ceil) of incoming subs' drillers per 2 hours. This
  blurs the line between visibility and combat — Sentry uses sonar
  range as its reach.

## Inspector + Strong Shield + Security Chief Stack

A defensive stack with all three:

- Strong shield: 20 max.
- Security Chief at the outpost: +10 global + 10 local = **40 max
  shield**.
- Inspector at the outpost: shield always topped up.

This is one of the most punishing defensive configurations in the
game; an attacker needs 40+ extra drillers just to drain the shield
before the Driller phase begins.

## Implementation Reference

```python
def visible_subs(viewer, world):
    # Owned subs always
    visible = set(s for s in world.subs if s.owner == viewer)
    # Plus any sub in any of the viewer's sonar ranges
    for outpost in world.outposts.owned_by(viewer):
        for sub in world.subs:
            if dist(sub.pos, outpost.pos) <= sonar_range(outpost, viewer):
                visible.add(sub)
    return visible

def visible_outposts(viewer, world):
    # Every outpost is always in the view; sonar only governs
    # whether the *internal* fields (garrison, shield, specialists)
    # come through or are redacted.
    visible = {}
    for outpost in world.outposts:
        in_sonar = any(
            dist(outpost.pos, our.pos) <= sonar_range(our, viewer)
            for our in world.outposts.owned_by(viewer)
        )
        visible[outpost] = "full_info" if in_sonar else "fogged"
    return visible

def sonar_range(outpost, viewer):
    r = BASE_SONAR_RADIUS
    if has_princess(outpost): r *= 1.5
    if has_intel_officer_globally(viewer): r *= 1.25
    return r
```

## Common Pitfalls

- **Assuming outposts are hidden until discovered.** They aren't —
  position, kind, name, and owner are common knowledge from game
  start. Only the *internal* state (garrison, shield, specialists)
  is fogged outside sonar.
- **Assuming subs leave trails.** They don't. A sub that just left
  sonar is invisible.
- **Recharging during combat as a separate step.** Recharge happens
  continuously; combat just consumes charge mid-tick.
- **Granting attackers a combat preview from server omniscience.**
  Previews use only the defender's visible info.
