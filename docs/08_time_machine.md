# The Time Machine

The Time Machine is Subterfuge's signature mechanic. It is what turns a
week-long real-time game from "a game you must check at random hours"
into "a game you can pre-program once a day." It is also what makes
Subterfuge's deterministic simulation visible to the player as a tool.

This file documents what the Time Machine does, how it works
mechanically, what it costs, what it can and cannot predict, and how it
interacts with the rest of the game.

## What the Time Machine Is

The Time Machine is a UI mode that lets the player **scrub the game's
clock forward** to any future moment and view a **deterministic
projection** of the world at that moment. Within that future-mode the
player can also issue orders that will execute when the real clock
reaches the scrubbed time.

The Time Machine is the only legitimate way to issue orders in advance.
Subterfuge has no separate "scheduled actions" system; it just uses the
Time Machine.

## What "Deterministic Projection" Means

Subterfuge's underlying simulation is fully deterministic. Given:

- the current world state,
- all currently in-flight subs,
- all known queued orders,
- all currently active timers (factory cycles, shield recharge, etc.),

… the simulation can compute the exact state of the world at any future
time `t` by stepping the simulation forward.

What it **cannot** predict:

- Orders other players haven't issued yet.
- Orders other players have issued but that the player can't see
  (queued in opponents' Time Machines).
- Combat outcomes if the player doesn't know all participants'
  specialists (because some are outside sonar).

The Time Machine works by running the deterministic simulation forward
using only **information visible to the player at the current real
moment**. It is therefore an honest "best-effort" prediction; it
becomes wrong only if other players take actions you couldn't see, or
if information about their forces was hidden by fog of war.

Implementation note (client projection on the filtered world): the
client ticks the *per-player filtered* view forward. Fogged enemy
outposts carry zeroed garrisons/specialists, so anything derived from
hidden enemy state (their production, their electrical cap, combat at
their fogged outposts) is knowingly wrong in projection — that IS the
fog, not a bug. The player's own assets are never fogged in their own
view (own outposts and subs are always visible to their owner, see
`visibility.ts`), so projections of the player's own economy, shields,
and arrivals are exact.

## How a Player Uses It

A player using the Time Machine:

1. Opens the Time Machine and **drags the timeline scrubber** forward
   to a specific future moment.
2. The UI redraws the map as it will look at that moment, including:
   - Sub positions along their flight paths.
   - Outpost ownership after all known arrivals and conflicts.
   - Driller counts after all known production cycles.
   - Shield charges after all known recharges.
   - Combat resolutions for any conflicts in the visible future.
3. The player issues orders **as if the present were that future
   moment** — e.g. "launch a sub from outpost A to outpost B with 30
   drillers and a Helmsman."
4. The Time Machine **queues the order** to fire at the chosen real
   moment.
5. The player can scrub back to the present to confirm and exit.

When real time reaches the scheduled moment, the queued order
executes automatically, with no player presence required.

## Order Queue Limits

There is no cap on queued orders. A queued order is one launch (or
one drill, or one specialist-related order). A multi-leg trip — e.g.
sub from A → B, then a follow-up sub from B → C — counts as two
orders.

(The original mobile game gated the order count behind a one-time
in-app "Founder" purchase: free players got 4, Founders got
unlimited. This reimplementation has no IAP / monetisation tier;
every player has the unlimited variant.)

## Past Mode

The Time Machine can also scrub **backward** to view past events. In
past mode the player can replay sub arrivals, combats, and ownership
changes. This is useful for diagnosing what happened while the player
was asleep (e.g. "who attacked my mine yesterday at 03:00?").

Past mode is read-only — orders cannot be issued in the past, and the
projection is the exact replay of what actually happened (not a
prediction).

## Why It Exists

In a real-time game lasting a week, players span timezones. Critical
events can occur in the middle of someone's night. Without the Time
Machine, the design would punish players for sleeping.

The designers cite this directly: they wanted to ensure that **no
player would lose a game because they were asleep at a particular
moment**. The Time Machine lets a player log in once or twice per day,
project the next 24 hours, and queue everything they want to happen.

## What It Doesn't Do

- It is **not a pause**. The world keeps running while you are in the
  Time Machine. If you sit in scrubbed-future mode for an hour, real
  time has advanced an hour.
- It does **not reveal hidden information**. Forecasts use only what
  the player can see now. Hidden enemy specialists, hidden subs
  outside sonar, and queued opponent orders are not factored in.
- It cannot **cancel an event that has already happened**. Past mode is
  read-only.
- It cannot **edit an order that is already mid-execution** (e.g. a
  sub already in its 10-minute launch window — that's edited on the
  outpost panel, not via the Time Machine).
- It cannot **modify other players' orders** in any way.

## Interactions With Specialists

A few specialists' effects make Time Machine projections especially
useful:

- **Navigator**: a sub with a Navigator can be re-targeted mid-flight.
  The Time Machine lets the owner plan that re-target ahead of time,
  by jumping to a future moment and issuing the re-target order then.
- **Smuggler / Helmsman / Admiral**: faster subs reach their targets
  in less wall-clock time, so the player can stack several legs of a
  journey into one day of real time and project them all forward.
- **Pirate**: a Pirate intercept requires a precise launch time so the
  Pirate sub crosses the target sub's path. The Time Machine projects
  the target's position over time, letting the player aim correctly.
- **Sentry-equipped outposts**: Sentry shots are predictable (every 2
  hours), so the Time Machine accurately projects driller attrition
  on subs approaching a Sentry.

For any specialist whose effect is time-based (Tinkerer's hourly
drain, Sentry's biennial fire), the Time Machine projects the effect
correctly.

## Interaction with the Time Machine of Other Players

Other players' Time Machines are private. Their queued orders are
invisible to you. From your projection's perspective, queued orders
you haven't yet seen do not exist.

This means projections can be **wrong** in predictable ways:

- An enemy sub launched at a moment that is "today" in your projection
  may surprise you.
- A queued drill order by an enemy can change their outpost type
  mid-projection.
- A queued specialist hire (the Queen choosing one of three offered)
  changes the enemy's specialist roster.

A skilled player uses the Time Machine to plan **conservatively**: the
projection is best-case from your perspective, and your actual play
should hedge against the moves you can't yet see.

## A Worked Example

It's day 3, 18:00 local time. You want to sleep through the night
(00:00–08:00) and wake to a beneficial position. You open the Time
Machine and scrub to 23:00 day 3:

- Your Factory at Atlantis ticks at 22:00 (you see its driller count
  go up).
- An enemy sub you've seen is projected to enter your sonar at 23:15.
- You scrub to 23:15 and confirm the combat preview: you'd lose 5
  drillers but defend the outpost.

You scrub to 06:00 day 4:

- Your shield has recharged to 14/20.
- Your Mine at Mariana has produced 1.2 kg overnight.

You queue 3 orders:

1. At 02:00, launch 25 drillers from Triton to Atlantis to
   reinforce.
2. At 04:00, drill a new mine at Charybdis (300 drillers — your
   3rd ever).
3. At 06:30, launch 60 drillers + a Helmsman from your Queen
   outpost on a counter-strike to the enemy's nearest outpost.

You scrub back to the present, log out, sleep. When you wake up,
all three orders have executed.

## Implementation Notes

For implementers building the Time Machine:

- The simulation must be **purely deterministic** given the world
  state and queued orders. No RNG anywhere.
- Maintain a per-player **queue** of `(execution_time, order)` pairs.
  No order-count cap — every player has unlimited slots in this
  reimplementation (see "Order Queue Limits").
- The "projection" function is `simulate(state, t) → state_at_t`
  using only the player's visible information at the current real
  time. Other players' orders are excluded.
- The UI scrubber should re-run the projection at every drag delta;
  for performance the projection can be cached and incrementally
  updated.
- Past mode replays from a stored event log, not a re-simulation —
  this guarantees past mode shows what actually happened (including
  events the player didn't see at the time but later gained visibility
  for? — design choice; the original game shows only events the player
  was entitled to see when they happened).
- Queued orders that become invalid (e.g. the source outpost was
  captured before the queued launch time) are silently dropped at
  execution time. The player is notified.

## Common Confusions

- **"The Time Machine pauses the game."** No — real time advances.
- **"The Time Machine is the only way to play."** No — present-mode
  orders work fine; the Time Machine is for advance scheduling.
- **"You can see the future with full accuracy."** No — only based on
  visible information; opponents' moves are unknown.
