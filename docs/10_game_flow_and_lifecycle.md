# Game Flow and Lifecycle

This file covers the parts of Subterfuge that aren't a single
mechanic but are about how a game is structured from before it starts
to after it ends: map generation, starting positions, the rough arc of
play, elimination, victory, and end-of-game state.

## Match Configuration

A Subterfuge game is configured before it begins. The configurable
parameters:

- **Player count**: 2 to 10. Standard public games are 10-player.
- **Victory mode**:
  - **Standard (Neptunium)**: first to 200 kg wins.
  - **Domination**: first to control a target outpost count wins
    (mines disabled).
- **Public or private**: public games are listed in the hub and
  enforce the Code of Conduct; private games are invite-only and may
  ignore CoC restrictions (e.g., pre-arranged teams).
- **Map size**: auto-scaled to player count (see below).

There is **no game-speed multiplier** in standard public games — the
clock runs at one rate. Private games can vary if the host engine
permits.

## Map Generation

The map is a continuous 2D plane (not a grid, not hex). At
configuration the generator produces a candidate map by:

1. Placing **N points** (one per player) that **repel each other**,
   producing roughly evenly spread starting positions.
2. Placing **N × 10 outposts** on the map using a similar repulsion
   process — outposts repel both each other and the player points.
3. Running the algorithm for **500 iterations** of small random
   perturbations and scoring the result on balance metrics (each
   player has roughly equal access to nearby outposts).
4. Selecting the **most balanced** of the 500 candidates.

For 6–7 player games, starting outpost counts tend to be identical
across players; for 8–10 player games, the spread is at most ~2
outposts between the best and worst start.

The map **wraps** — there is no edge. Every player is surrounded by
opponents. This means there is no "safe corner" strategy.

Outpost names are drawn from a pool of ~100 ocean/water-themed names
(Atlantis, Mariana, Triton, Charybdis, etc.). Outpost positions are
real-valued (x, y) coordinates. Outpost types (Factory or Generator)
are assigned during generation; shield types (weak or strong) are
also fixed at generation.

## Starting Position

Each player begins with **5 outposts**:

- **4 standard outposts**, each pre-stocked with **40 drillers**. The
  mix of Factory and Generator is randomised.
- **1 Queen outpost** containing the player's Queen specialist.

The Queen sits at the outpost closest to the player's generated
starting point; the next four nearest outposts become the player's
40-driller starting outposts. Everything else on the map is
**dormant** — unowned, no garrison, no shield active.

## Early Game (Days 1–2)

The first phase is **expansion**:

- Every player has 5 outposts and 160 drillers across the four
  non-Queen outposts.
- The map has many dormant outposts — typically 5–10 per player worth
  of additional territory waiting to be claimed.
- Capturing a dormant requires no combat: send any non-zero number of
  drillers, claim the outpost.
- Players race to expand without overcommitting drillers (which need
  to defend against opportunistic enemies).
- Diplomacy begins. Neighbours often agree to non-aggression so they
  can both focus on expansion.

By the end of day 2, most dormants are claimed. The map is
**partitioned** into player territories; further expansion requires
combat.

## Mid Game (Days 2–5)

This phase is dominated by **positioning and diplomacy**:

- Coalitions form against perceived leaders.
- Players hire specialists each 18 hours and start building up
  shield, sonar, and offence stacks.
- First mines are drilled (typically days 2–3, costing 50 drillers
  each).
- Players probe each other with small attacks — testing shields,
  scouting specialists, baiting reactions.
- Funding starts flowing if any player is 20 kg ahead.

By the end of day 5, the strategic landscape is usually clear: there
is a leader, a coalition forming against them, and several smaller
side conflicts.

## Late Game (Days 5–7+)

The endgame is a **race against 200 kg**:

- The leader is mining hard, possibly with 3–4 mines and 21+ kg/day
  output.
- The coalition is trying to capture or destroy one of the leader's
  mines (each capture knocks 20% off the leader's Neptunium).
- Funded players are using their bonus to attack the leader's flanks.
- Time Machine queues are heavily loaded — players are scheduling
  precise multi-day plans.

A game typically ends some time on day 7–10. Faster games are
possible (a Queen capture can end a game in 3 days); slower games
drag past day 10 when no one has clear momentum.

## Elimination

A player is eliminated when **any** of the following occurs:

- Their **Queen is captured**. If the player has an active Princess
  on the map, the nearest Princess automatically promotes to Queen
  and the player continues. If they have no Princess, they are
  eliminated.
- They **voluntarily resign** through the game's UI.
- They are **inactive for 48 hours** (no orders, no chat) — the
  engine auto-resigns them.

On elimination:

- All the eliminated player's outposts become **dormant** (unowned,
  no garrison).
- All their in-flight subs are **destroyed**.
- Their Neptunium total is **discarded** (not transferred to anyone).
- Queued Time Machine orders are discarded.
- Specialists they owned are destroyed (including captives they
  held — those captives are not released, they cease to exist).

The eliminated player keeps:

- **Visibility** of the map (locked at last seen).
- **Chat access**, including the ability to direct-message any
  remaining player.

This makes eliminated players potent **kingmakers**. They have full
in-game communication and historical intel and no remaining stake in
the outcome.

## Victory Conditions

The game ends when:

1. **Standard mode**: a player reaches **200 kg of Neptunium**.
2. **Domination mode**: a player controls the **threshold number of
   outposts** (scaled to player count).
3. **Last player standing**: only one player remains un-eliminated.

The game emits a winner declaration; the world is frozen; players can
review the final map and chat log. There is no "shared victory" — a
single player wins.

## Notifications During Play

Push notifications fire only for events the player could not have
anticipated:

- An enemy sub enters one of the player's sonar bubbles.
- A combat resolves (with the player's involvement).
- An outpost the player owns is captured.
- A queued Time Machine order fails (e.g., source outpost lost
  before launch time).
- Chat messages (optionally).

Predictable, repetitive events — Factory production ticks, shield
recharges, Neptunium ticks — never produce notifications. The design
goal is **don't make people check their phone**.

## End-of-Game Review

After the game ends:

- The map is frozen and viewable.
- Past mode (Time Machine scrubbing into the past) replays the entire
  match.
- The chat log is accessible.
- Statistics are typically shown: total drillers produced, mines
  drilled, outposts captured, Neptunium peak, etc.

Players are then returned to the hub to find a new game.

## The Hub (Lobby System)

Outside an active game, players spend time in the **hub**:

- Browse and join open public games.
- Create private games.
- Chat with friends across games.
- View their match history and reputation.

Joining a public game enters a queue until the configured player
count is met, at which point the game launches and the
map-generation algorithm runs.

## A Sample Game Calendar

Day 0 (game launch):
- Map generated, players placed.
- All players have 5 outposts, 160 drillers (4 outposts × 40),
  Queens placed.
- Queen will hire her first specialist at +4 hours.

Day 0 + 4h:
- First specialist hire window opens for every player.

Day 1:
- Most players have claimed 3–5 dormant outposts.
- First-contact chat with neighbours.

Day 2:
- Most dormants are claimed.
- First mines drilled (50 drillers each).
- First coalition discussions.

Day 3:
- 1 kg of Neptunium per outpost-owned per mine per day starts paying
  out.
- Probing attacks begin.

Day 4:
- Second mines drilled (100 drillers).
- Leaders are visible. Coalitions form.

Day 5:
- Heavy combat. Funding becomes available (any player at +20 over
  trailing players).
- Third mines (200 drillers).

Day 6:
- Endgame race. Mines being captured to inflict 20% Neptunium loss
  on the leader.

Day 7:
- A player typically wins by reaching 200 kg.

## Auto-Resign Considerations

Engineers building the lifecycle subsystem need to:

- Track `last_action_time` for each player.
- On every tick, check `now - last_action_time > 48h`; if so,
  auto-resign.
- Account for **all** activity (chat, queueing an order, scrubbing
  the Time Machine) as updating `last_action_time`, not only
  active mechanical orders.
- Send the player notifications well before 48 h to warn them
  (typically at 24 h and 40 h of inactivity).

## Implementation Notes

- Map generation should be **seeded and reproducible** — the same
  player list and seed should produce the same map. This makes
  debugging and replays sane.
- Determinism of the simulation is mandatory for the Time Machine
  to work. No `random()` calls anywhere in production code outside
  map generation.
- Eliminated players are still "in" the game logically (they have
  chat, view) — don't remove them from the player list, just mark
  them eliminated.
- End-of-game state should be **frozen and immutable**, with a
  separate read-only view.

## Common Game-Flow Pitfalls

- **Treating the game as turn-based.** It isn't — time runs
  continuously.
- **Assuming all players see the same world.** They don't — fog of
  war is strict.
- **Assuming alliances are mechanical.** They aren't — they're
  social.
- **Forgetting the 20% Neptunium loss on Mine capture.** This is the
  single most important late-game lever and must be implemented
  exactly.
- **Letting eliminated players go silent.** They retain chat and
  view — leaving them as part of the meta-game is intentional.
