# Diplomacy and Communication

Diplomacy is not a separate game system in Subterfuge — it is the game
system. The mechanical rules are intentionally small and transparent;
the *interesting* depth of every match comes from negotiating,
bluffing, allying, and betraying nine other human players.

This file documents the communication channels, the rules around
diplomacy, the code-of-conduct constraints, and the diplomatic
mechanics that *are* baked into the engine (gifts,
specialist sharing).

## Communication Channels

The only player-to-player communication channel in Subterfuge is
**in-game text chat**. The rules are deliberately restrictive:

- **Text only**. No voice, no video.
- **No image sharing**. Players cannot post screenshots of their map
  or the game state to others through the game. (The CoC also
  discourages out-of-game screenshot sharing in serious play.)
- Chat works both in **direct messages** (player-to-player) and in
  **multi-party rooms** (alliances, councils).
- Past messages persist; players can scroll back through their entire
  conversation history.

The restrictions are intentional. The design philosophy is that
visual proof — a screenshot of your fleet — would short-circuit the
trust dynamics. By forcing all communication into text, the game
guarantees you can never *know* what an ally claims to have; you can
only choose to believe them.

## What Diplomacy Actually Is

Subterfuge's "diplomacy" is not a separate menu. There are no
mechanical alliances, no signed treaties, no shared sonar links, no
combined fleets. Diplomacy is:

- Two or more players **agreeing in chat** to a course of action.
- Each player **choosing whether to honour** that agreement when the
  moment comes.
- Optionally, **exchanging gifts** (drillers, specialists, captured
  prisoners) to demonstrate goodwill or to enable a joint plan.
  boost.

The agreements are **never mechanically binding**. Any player can
betray any other player at any time. The only consequences are
reputational: betray too often and other players in your hub will
remember it.

## Mechanical Diplomatic Tools

A small set of in-game mechanics support diplomacy directly. These
are the only diplomatic mechanics the engine knows about.

### Gift Subs

Any sub a player launches can be flagged as a **gift** to another
specific player. A gift sub:

- Passes through other players' subs without combat (sub-vs-sub combat
  is skipped for gifts).
- On arrival at any outpost owned by the gift recipient, transfers all
  drillers and specialists aboard to that outpost.
- If the destination outpost is **not** owned by the recipient at
  arrival time, the gift sub reverts to a normal attacking sub and
  combat resolves as usual.

Gift subs are how alliances exchange resources. A player can:

- Gift a stack of drillers to support an ally's offensive.
- Gift a specialist (e.g., a Helmsman) to speed up an ally's fleet.
- Gift a captive specialist (one they captured from a third party) to
  an ally.

Even **the Queen** can be gifted, which is occasionally a desperate
play.

### Funding

When player A is **≥ 20 kg of Neptunium ahead** of player B, player A
> **Removed (June 2026):** the funding mechanic was deleted — it amplified leader coalitions instead of helping trailing players. See [docs/21](./21_contracts_and_drowned_queen_plan.md) for the replacement design (The Undertow).

### Specialist Sharing

Specialists move between players only by gift sub. There is no
specialist trade menu. Practical sharing examples:

- A player low on offence gifts their Lieutenant to a stronger ally.
- An ally captures a Hypnotist and gifts it back to the original
  owner.
- A coalition exchanges Diplomats and Hypnotists to free or convert
  captives.

### Captive Diplomacy

When a player loses a combat, their surviving specialists become
**captives** of the winner. Captives are inactive but can be:

- Released by a **Diplomat** (sent home on a 1× sub).
- Converted to the captor's side by a **Hypnotist**.
- Or simply held indefinitely as collateral.

A coalition can pressure a captor to release captives as a sign of
goodwill, or threaten to attack if they don't.

## What Diplomacy Cannot Do (Mechanically)

The engine does **not** support:

- A shared map view between allies (each player has their own sonar).
- A "joint sub" carrying mixed-owner drillers.
- A binding non-aggression pact that prevents combat.
- An automated victory split.
- A vote-based victory or surrender.
- Direct neptunium transfer (you cannot just hand over Neptunium;
  there is no formal resource-transfer relation beyond gift subs).

Anything beyond gift subs and captives must be enforced by
trust and reputation alone.

## Code of Conduct

Public games on Subterfuge's hub run under a Code of Conduct enforced
by the community moderation. The key rules:

- **No multiboxing.** A player may not control multiple accounts in
  the same game.
- **No pre-made alliances.** Players who enter a public game cannot
  arrive with pre-agreed alliances; coalitions must form organically
  in-game.
- **No excessive gifting** between accounts that creates a de-facto
  two-headed player.
- **No derogatory or threatening language** in chat.
- **No external coordination** by chat clients outside the game
  (e.g., a Discord war-room with five of the ten players).

Private games among friends can ignore most of these (e.g., a
private game with pre-arranged teams is fine), but public competitive
games police them seriously.

## Diplomatic Dynamics

A typical game produces three diplomatic phases:

1. **Day 1–2: scouting and probing.** Players make first contact via
   chat, gauge personalities, look for natural allies (neighbours
   often ally early so they don't have to fight each other).
2. **Day 2–5: coalition formation.** Two- and three-player alliances
   form against perceived leaders. Promises of "I won't attack you"
   are exchanged. Gifts flow.
3. **Day 5–7+: betrayals.** As the Neptunium leader approaches 200,
   the math forces betrayals. An ally with 180 kg is days away from
   winning; their alliance must turn on them or lose. Conversely, the
   leader is buying support with gift subs to slow the betrayal.

Designers describe Subterfuge as **"a brawl and a race"** — a race
against the Neptunium clock and a brawl about who gets to win.
Diplomacy is the glue between those two pressures.

## Trust and Hidden Information

Because of the strict fog of war, players can lie about:

- The number of drillers at their outposts (an ally outside sonar
  cannot verify).
- The specialists they have hired (other players don't see your
  hire choices).
- Sub launches that haven't yet entered anyone's sonar.
- Queued Time Machine orders (private to the issuing player).

Lies cost reputation. A player who repeatedly betrays in a public hub
will find future hub games refusing to ally with them. Across a hub
of regulars, reputation becomes a meta-game resource.

## In-Game Notifications

The game generates push notifications for events the player **could
not have anticipated**, deliberately limited to:

- An enemy sub entering one of the player's sonar bubbles.
- An ally's chat message (optional, can be toggled).
- A captured outpost.
- A queued order failing to execute (e.g., source outpost was lost).

Notifications **never** fire for predictable events (e.g., "your
Factory just produced 6 drillers"), to avoid encouraging compulsive
phone-checking.

## Vacation / Inactivity

There is **no dedicated vacation mode**. A player can:

- Queue orders via the Time Machine (up to 4 free / unlimited paid).
- Hope the world doesn't change in ways their queue can't handle.

If a player goes **silent for 48 hours** (no orders, no chat) the
engine **auto-resigns** them. Their outposts become dormant; their
Queen "dies." This protects games from being held up by abandoned
players.

A player who knows they'll be away should:

- Tell their allies in advance.
- Queue defensive moves for the duration.
- Or accept they'll auto-resign if they're gone > 48 hours.

## Eliminated Players

When a player is eliminated (Queen captured, voluntary resignation,
or auto-resign):

- They **lose all assets** — outposts, drillers, specialists, queued
  orders.
- They retain **sonar visibility** of what they used to see (their
  former outposts continue to update on their map).
- They retain **chat access** and can continue to participate in
  diplomacy as a **kingmaker** — encouraging other players to attack
  the leader, sharing intel, etc.
- They cannot issue orders.

Eliminated players' kingmaker power is real. A player at 195 kg can
be undone by an eliminated player whispering critical timing
information to a coalition.

## Implementation Notes

For implementers building the diplomacy layer:

- Build a robust in-game **chat system** (direct messages and
  multi-party rooms) with persistent history.
- Implement **gift flag** on subs (a boolean) and the rule that gift
  subs skip sub-vs-sub combat. Gift behaviour on arrival depends on
  destination ownership.
  with a 20-kg-lead precondition and the +50/+2 bonuses. Allow
  revocation.
- Persist **captives** as a per-outpost list of inactive specialists.
- Track **reputation across games** at the hub level (this is a
  social layer outside the per-game engine but is critical to the
  meta-game).
- Auto-resign players after 48 hours of inactivity.
- Allow eliminated players to keep chat and view-only access.
