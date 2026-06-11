# Outposts

Outposts are the only static structures in Subterfuge. They are the source
of everything: drillers come from them, Neptunium is produced at them, the
Queen lives in one, specialists are hired at one, every sub starts and ends
at one. Capturing outposts is the only way to take an opponent's territory.

This file documents every property of an outpost — type, production, shield,
sonar, capture, drilling — and exists so an implementer can build the
outpost subsystem from scratch.

## The Three Outpost Types

Subterfuge has exactly **three** outpost types. There are no labs, warp
gates, research buildings, formations, or upgrades beyond what is listed
below.

| Type      | Produces            | Effect                                  |
|-----------|---------------------|-----------------------------------------|
| Factory   | Drillers            | +6 drillers / 8 hours (subject to cap)  |
| Generator | (electrical output) | +50 to player's global driller cap      |
| Mine      | Neptunium           | 1 kg / day × number of outposts owned   |

A fourth functional role exists — the **Queen's home outpost** — but it is
*not* a separate type. The Queen is a specialist who happens to be at one
outpost; that outpost is otherwise an ordinary Factory or Generator.

### Factory

- Produces **6 drillers every 8 hours** = 18 drillers/day per factory.
- A "Funded" player (paid IAP) gets **+2 per cycle** → 8 drillers / 8 hours.
- Production halts when the player's total stockpiled drillers equals or
  exceeds their **electrical output**.
- Production resumes the moment any driller is spent (combat, drilling a
  mine, etc.) and the stockpile drops below the cap.
- A Factory can be converted into a Mine by drilling (see Mining section).

### Generator

- Adds **+50 to the player's global electrical output cap** (driller cap).
- Does not itself produce drillers.
- Can be converted into a Mine (loses the +50 when converted).

### Mine

- Produces Neptunium. Output = **1 kg / day per Mine owned, multiplied by
  the total number of outposts the player owns**. With 2 Mines and 7 total
  outposts you get 2 × 7 = **14 kg/day**.
- Output is paid incrementally in small ticks rather than as a single daily
  lump.
- Mines do not exist on the map at game start; they are made by **drilling**
  a Factory or Generator the player owns.
- Conversion is **permanent and irreversible**.
- When a Mine is captured by an opponent, the previous owner **loses 20% of
  their current Neptunium total** (rounded up), and the production tick
  timer resets for the new owner.
- A Martyr that destroys a Mine does **not** trigger the 20% penalty
  (ownership never transferred).

## Electrical Output (Global Driller Cap)

The cap on how many drillers a player can stockpile across all their
outposts. The Factory production rule is "produce 6 drillers if cap > total,
else produce 0."

Sources of electrical output:

- **Queen's home outpost**: base **+150**.
- **Each Generator**: **+50**.
- **Tinkerer specialist at outpost**: **+3 × that outpost's max shield
  charge**, while draining 3 shield/hour from the same outpost.
- **Minister of Energy** (promoted Tinkerer): **+300 global**, but
  Factories produce **−1 driller per cycle**.
- **Security Chief** indirectly adds shield, which can power a Tinkerer.

A typical mid-game player has 150 + 4×50 = **350** electrical output and
will be capped most of the time once they have several Factories.

## Shields

Every outpost has a shield. Shield charge is consumed in combat before
drillers are engaged (1 shield charge cancels 1 attacking driller).

- **Weak shield**: max charge **10**.
- **Strong shield**: max charge **20**.
- Weak shields are more common on the map than strong shields. Whether an
  outpost has a weak or strong shield is fixed at map generation and is a
  property of the outpost itself, not the owner.
- All shields begin a game **fully discharged at game start**.
- Shields **recharge to full in 48 hours**. Recharge rate is linear at
  (max_charge / 48 hours).
- Shields apply only in **sub-vs-outpost** combat, never in sub-vs-sub
  combat.
- Modifiers:
  - **Queen at outpost**: max shield **+20** at that outpost.
  - **Security Chief at outpost**: max shield **+10 globally**, **+10
    additionally locally** (so +20 at the Chief's own outpost).
  - **King at outpost**: max shield **−20 globally**, but **+20 at the
    King's own outpost** (net: own outpost +0, all others −20).
  - **Inspector at outpost**: fully charges the outpost's shield on arrival
    and after each combat there.
  - **Infiltrator** (attacker): drains all shield charge to 0 when attacking.

## Sonar Range (Visibility)

Each outpost emits a sonar field of a fixed radius. Within that radius the
owner sees:

- Other outposts and their type, owner, drillers, specialists, shield.
- Subs (their position, direction, drillers, specialists).
- Combat previews when a hostile sub is inbound.

Outside any of the player's sonar fields the player sees only:

- Subs they own (and the routes they have plotted).
- Mines (these are *globally visible* regardless of sonar).
- Outposts that are within sonar range (no info beyond shape outside).

Modifiers to sonar:

- **Princess at outpost**: +50% sonar range at that outpost.
- **Intelligence Officer**: +25% sonar range at **all** of player's outposts,
  AND reveals the *type* of outposts beyond sonar range (without revealing
  garrison details).

See `07_shields_sonar_visibility.md` for full visibility rules.

## Starting Outposts and Map Layout

At game start, each player has **5 outposts**:

- 4 standard outposts pre-stocked with **40 drillers each**. The mix of
  Factory/Generator among these four is randomised.
- 1 outpost containing the **Queen** (functionally a Generator-type for
  electrical-output purposes; the Queen specialist sits inside).

Around the player-owned outposts the map has many more **dormant outposts**:

- Dormant outposts are unowned and have no garrison.
- Sending any number of drillers to a dormant outpost captures it
  unconditionally (no fight).
- Dormant outposts have a pre-assigned type (Factory or Generator) and
  shield strength (weak or strong) that activates when claimed.
- Once all dormants near a player are claimed, further expansion requires
  combat or diplomacy.

The map itself is a continuous 2D plane:

- **Not** a hex grid.
- Outposts are at (x, y) coordinates.
- The generator produces **player_count × 10** outposts and selects the
  most balanced of 500 candidate layouts.
- Outpost names are drawn from a pool of ~100 thematic ocean/water names.

## Driller Capacity at an Outpost

There is **no per-outpost driller cap**. An outpost can hold any number of
drillers up to the player's global electrical output. The only practical
limit is total stockpile across all outposts.

When subs arrive carrying drillers (and the destination is friendly), those
drillers are simply added to the outpost's garrison. If the player is over
the cap (e.g. captured an enemy outpost full of drillers), production stops
until they fall back under the cap; their existing drillers are NOT
destroyed.

## Specialist Capacity at an Outpost

There is no documented hard cap on specialists per outpost. The Queen can
hold several. Captives held at an outpost are also unlimited. Practical
limits emerge from the cost of moving specialists and the risk of putting
many in one place.

A sub launching from an outpost can carry multiple specialists at once;
the rulebook does not state a hard cap, but observed gameplay caps
specialists per sub at roughly 3 when carrying released captives.

## Capturing an Outpost

An outpost changes owner when an opponent's sub arrives carrying enough
drillers to beat the garrison plus shield (see `04_combat.md` for the full
4-phase resolution). On capture:

- The outpost's type (Factory / Generator / Mine) is preserved.
- The outpost's shield identity (weak vs strong) is preserved; current
  charge transfers as-is (often 0 immediately after combat).
- Any surviving enemy drillers garrison the new outpost.
- Defeated defenders' specialists become **captives** of the new owner.
- If the captured outpost was the previous owner's **Queen outpost** and the
  previous owner has no Princess to promote, the previous owner is
  **eliminated** from the game.
- If the captured outpost was a **Mine**, the previous owner loses 20% of
  their Neptunium (rounded up).

Ties on outposts favour the defender: an attacker that draws on driller
count loses all drillers and their specialists are captured.

## Outpost Conversions (Drilling)

A Factory or Generator can be converted into a Mine by spending drillers.
The conversion is paid from the outpost's local driller stockpile and
happens instantly when the order resolves.

Drill costs escalate with the **total number of mines the player has ever
drilled** (not the number currently owned):

| Mine # | Driller cost |
|--------|--------------|
| 1st    | 50           |
| 2nd    | 100          |
| 3rd    | 200          |
| 4th    | 300          |
| 5th    | 400          |
| nth    | n × 100 (approximate after 5th) |

Losing a Mine **does not** reset the counter. If you lose your only Mine
and drill a new one, it costs the same as the next one would have cost
(e.g. your "2nd ever" mine is still 100).

The Queen's home outpost cannot be drilled.

## Funding (Outpost-Adjacent Bonus)

> **Removed (June 2026):** the funding mechanic was deleted — it amplified leader coalitions instead of helping trailing players. See [docs/21](./21_contracts_and_drowned_queen_plan.md) for the replacement design (The Undertow).

Funding does not affect the giver's production.

## Common Confusions and Non-Existent Features

These do **not** exist in Subterfuge and should not be implemented if
faithful to the original:

- Per-outpost driller cap.
- Outpost level / upgrades / research / tech tree.
- Outpost garrison formations / arrangements.
- Lab, Warp Gate, Hospital, or other special outposts.
- Reverting a Mine back into a Factory or Generator.
- Hiring specialists from anywhere except the Queen's current outpost.
- "Hire range" — there is none. Specialists spawn where the Queen is.
- Subs being able to "merge" mid-ocean. Each sub is independent.
