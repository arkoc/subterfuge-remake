# 18. Funding Replacement — Killing Funding, Patching Retention

*Draft, May 2026. Owner: design. Status: concept exploration; not committed to sim. Supersedes [docs/16](./16_funding_redesign.md) only on the **replacement** question — the four directions in doc 16 (Stagnation Tax, Coalition Bond, Shadow Market, Spite Fund) are off the table per design call; this doc proposes mechanically distinct alternatives.*

The brief: **remove funding entirely** and put something in its slot that simultaneously chips at the top-5 retention killers from [docs/13](./13_player_feedback_postmortem.md) §1. The earlier redesign (doc 16) tried to rehabilitate funding by making it expensive and public. This doc accepts that the funding *frame* — "leader passes a free buff to a trailing player" — is itself the problem and looks for a different mechanic in the same gameplay slot.

Sections: (1) why funding fails today, (2) design principles, (3) genre survey, (4) five distinct proposals, (5) recommendation, (6) open questions.

---

## 1. Why funding fails today

The current mechanic ([packages/sim/src/diplomacy.ts:76-132](../packages/sim/src/diplomacy.ts), [packages/sim/src/production.ts:33-116](../packages/sim/src/production.ts)) lets any player whose live Neptunium leads another by ≥ 20 kg flag the trailing player as "funded"; the recipient gains +50 electrical and +2 drillers/cycle until the lead drops back below 20 kg. The donor pays nothing. The relationship is private state on the recipient's record (no public HUD signal). Carmel's stated intent ([Designing Subterfuge — Gaming the Game](https://blog.subterfuge-game.com/post/112147930751/gaming-the-game), accessible via search excerpts only) was that the leader converts mining surplus into political influence — a feature, not a catch-up tool.

In practice the mechanic does the **opposite of catch-up**: it amplifies the existing coalition. The leader's incentive is to fund their ally, not their enemy; the relationship is invisible to everyone outside the pair, so the lobby has no information to act on; and funding costs the donor nothing, so it isn't a decision. The postmortem's "dominant 2-3 player coalition rolls the lobby" pattern ([docs/13 §2.5](./13_player_feedback_postmortem.md)) is *helped* by today's funding. The mechanic also addresses none of the top-5 retention killers — it does nothing about match length, AFK players, forced betrayal, king-stacking, or the eliminated-player dead-zone. It is a feature with negative payoff. Cut it.

---

## 2. Design principles for the replacement

The slot vacated by funding should be filled by something that:

1. **Targets at least 2 of the top-5 postmortem problems** — match length (#1), AFK collapse (#2), forced betrayal (#3), king-stacking (#4), eliminated-player dead-zone (#5).
2. **Creates non-zero-sum conflict** — gives players something to attack/cooperate-over that *isn't* another player, so coalitions have somewhere to spend energy besides dogpiling the leader or each other.
3. **Is public** — visible state that the whole lobby reads, so coalitions can't operate in the dark. ([Genre lesson: Civ World Congress, Catan Largest Army, EVE sov are public; private catch-up mechanics get gamed or ignored — doc 16 §3.])
4. **Composes with sub combat and the existing economy** — touches outposts, subs, neptunium, specialists, sonar. Does not require new entity classes the sim doesn't already model.
5. **Has a clean elimination story** — eliminated players either keep mattering or exit cleanly; never the current "sit in a chair for 5 days" state.
6. **Survives sim purity** — lives in `packages/sim/src/`, no clocks, no RNG outside `rng.ts`, integer math for compounding state, pure tick.
7. **Does not formalise alliances** (Carmel's anti-formal-alliance principle — [docs/13 §2.13](./13_player_feedback_postmortem.md); the genre lesson is that formalised alliances collapse the game into social deduction).

A successful replacement lets the design team tell a story like: "On day 4, the dominant coalition couldn't keep up with the world-event because they were fighting each other for the contract payout. By day 5, two eliminated players were running the third faction in the lobby as a mercenary navy. The match wrapped on day 6 because the victory threshold scaled with how many players had been eliminated."

---

## 3. Genre survey

Six games handling the same set of problems (kingmaking, forced betrayal, alliance dominance, dead-player engagement, long-game pacing). Brief cites; deeper treatment per proposal in §4.

| Game / system | Mechanic | What we borrow |
|---|---|---|
| **Twilight Imperium 4 — Public Objectives + Mecatol Rex** | Each round reveals a public objective worth 1 VP; first claimant takes it. Mecatol Rex is the center system that draws every faction's attention and produces VP-relevant agendas. ([Fantasy Flight TI4 rulebook](https://images-cdn.fantasyflightgames.com/filer_public/87/9b/879bd0fe-d495-460b-a4c6-c2d83b94f1f8/ti-k0_rulebook_web.pdf); [TI4 Wiki — Mecatol Rex](https://twilight-imperium.fandom.com/wiki/Mecatol_Rex)) | **Public shared objectives** create non-zero-sum competition where multiple players can score; the contested *center* gives the lobby a shared focal point. |
| **EVE Online — bounty system** | Any player can post ISK bounty on any other player; the bounty pays out to whoever delivers the killing blow on the marked player's ship. ([EVE Online — Bounty Hunting](https://wiki.eveuniversity.org/Bounty_hunting); [CCP devblog on bounty rework](https://www.eveonline.com/news/view/dynamic-bounties)) | **Player-posted bounties** convert leader-fear into a public price tag; outsiders are paid to do the dogpile work that today they have to volunteer. |
| **Sea of Thieves — Megalodon / Kraken / Skeleton Ships** | World-spawned neutral threats that disrupt PvP, drop loot, and create temporary alliances. ([Rare — Sea of Thieves Adventures](https://www.seaofthieves.com/news/sea-of-thieves-adventures); [Sea of Thieves Wiki — Megalodon](https://seaofthieves.fandom.com/wiki/Megalodon)) | **Neutral world-threats** force coalitions to spend resources on a non-player, breaking up the dogpile dynamic. |
| **Among Us — Ghost role** | Eliminated players retain a meaningful role (completing tasks; can vent and observe but cannot vote/talk to living). ([Innersloth — Among Us mechanics](https://www.innersloth.com/games/among-us/)) | **Ghost agency for eliminated players** — eliminated players keep doing something that affects living players' outcomes without being a kingmaker. |
| **Diplomacy — draw-size scoring (DSS)** | A draw is split equally among all surviving players regardless of supply-center count, replacing winner-take-all. ([BrotherBored — Why Players Prefer DSS](https://brotherbored.com/why-players-prefer-draw-size-scoring-in-diplomacy/); [DBN — DSS overview](https://www.diplom.org/Zine/W2000R/Cohen/dss.html)) | **Survival-as-victory** removes the forced-betrayal incentive from the alliance endgame. Players who survive together can both "win." |
| **Mario Kart — Item distribution** | Position-weighted item drops; the back of the pack gets Blue Shells and Bullet Bills, the front gets Bananas. ([Polygon — How Mario Kart's items are weighted](https://www.polygon.com/2017/4/27/15445346/mario-kart-blue-shell); [Andy Nguyen — Mario Kart RNG](https://andnguyen.com/blog/2020/mario-kart-rng/)) | **Position-weighted comeback tools** — a non-symmetric resource where the back of the pack gets sharper tools. |
| **Crusader Kings 3 — Factions** | When ≥80% of a liege's vassal power opposes them, an automatic faction war fires. Public threshold, no formal alliance system. ([Paradox Wiki — CK3 Factions](https://ck3.paradoxwikis.com/Factions)) | **Auto-fired anti-leader event** at a public threshold of relative power. |

Three cross-cutting takeaways:

- **Non-zero-sum content (TI4 objectives, SoT world threats) reliably breaks up coalitions** because the coalition has to choose between dogpiling and scoring. The dogpile becomes opportunity cost.
- **Eliminated-player roles work when they affect living players without controlling them** (Among Us ghosts complete tasks that help the crew win; they don't vote). Pure spectator modes don't retain.
- **Public bounties / public objectives outperform private buffs**. The signal is the mechanic.

---

## 4. Proposed mechanics

Five candidates, ordered from "smallest mechanical footprint" to "biggest structural change."

---

### 4A. **The Leviathan** — a server-driven neutral threat that eats the lobby's flanks

**Elevator pitch.** A neutral NPC fleet roams the map; it attacks any player whose Neptunium share is above the median, scales in size with the leader's lead, and drops a Neptunium-rich wreck for whoever kills it.

**Mechanic.**

- At game start, the engine spawns one **Leviathan sub** at a random outpost-free coordinate. Its garrison is `floor(median_neptunium_kg / 2)` drillers, refreshed every 4 in-game hours. (Blitz: every 30 min.)
- The Leviathan picks a target every 4h: the player with the *highest* current Neptunium total whose outposts the Leviathan is within 8h travel of. It launches a single sub at that player's nearest *unshielded* outpost. ([Inference] tunable.) The targeting is deterministic — a function of `world.time` and the players' Neptunium ranks, no RNG.
- Any player can attack the Leviathan. If it's destroyed in combat, the attacker who landed the killing blow's outpost gains a one-time **Wreck**: 8 kg Neptunium credited to their player total, and a single +6 driller-cycle bonus on the killing outpost for the next 24h.
- After a Wreck is paid out, a new Leviathan spawns 12h later (3h in blitz) at the lobby's geometric center of mass.
- The Leviathan's garrison grows with the Neptunium gap between #1 and #median: `garrison = floor(median_kg / 2) + 2 × (leader_kg - median_kg)`. A runaway leader fights a much bigger Leviathan; a tight lobby fights a wimpy one.
- The Leviathan never targets eliminated players, never targets a player with <10 kg Neptunium, and never enters a sonar-covered region of the *target* (so the leader can buy themselves out of being eaten by extending sonar — which also makes them more visible to other players).

**Addresses postmortem issues #1, #2, #4** (and arguably #6).

- **#1 (match length)** — the Leviathan accelerates leader attrition. A runaway leader who would have ground out a 7-day match in 5 days now bleeds drillers to the world-threat. *Indirectly* shortens match length by capping the lead's run-away velocity. [Inference]
- **#2 (one disengaged player)** — the Leviathan keeps the map alive. Even if 2 of 6 players go AFK, the remaining 4 have a shared opponent to coordinate against / race for the Wreck. The map is never static.
- **#4 (king-stacking)** — King's combat bonus is global and works against NPCs too. A King-stacked leader *can* burn King power on the Leviathan, which spends the King's combat math on an enemy that doesn't matter politically. [Inference]
- **#6 (dominant coalition)** — coalition can dogpile the leader OR race for the Wreck, but not both efficiently.

**Integration with existing systems.**

- New entity: `world.leviathan: { subId: SubId, garrison: number, targetId: PlayerId | null, nextTickAt: number }` — a single optional field on `World`.
- The Leviathan rides the existing sub plumbing in `subs.ts`/`combat.ts`. Add a sentinel `LEVIATHAN_OWNER_ID` (a reserved negative `PlayerId`) so combat/visibility code can branch cleanly.
- Targeting and respawn live in `tick.ts` as a deterministic function of `world.time` and current player Neptunium totals. No RNG.
- Sonar masking already in `visibility.ts` — Leviathan reads the same per-player sonar map.
- HUD: a kraken icon at the Leviathan's position; a popover shows current target, garrison, and ETA. Visible to all players (no fog for the Leviathan — it's a public threat).

**Worked example.**

> Day 3, 7-day match. Anna 65 kg, Bart 60 kg, Cleo 45 kg, Dev 40 kg, Eve 35 kg. Median = 45 kg. Leader-gap = 65-45 = 20 kg.
>
> Leviathan garrison = floor(45/2) + 2×20 = 22 + 40 = **62 drillers**. It launches at Anna's nearest unshielded outpost. Anna sees the incoming Leviathan sub in her sonar and has 6h to react: shield up, redirect drillers, or accept the loss. She shields, losing 80 drillers in the shield charge. Net: Anna spent 80 drillers, did not lose the outpost, but is now 80 drillers behind on her tempo.
>
> Bart, Cleo, Dev, Eve see the same Leviathan. Cleo (#3) realises that *if she kills it*, she gets 8 kg Neptunium and pulls within 5 kg of Bart. She launches an attack — 70 drillers from her central outpost. The Leviathan resolves combat: 70 vs 62, Cleo wins with 8 drillers landing. Cleo gets the Wreck. Now Cleo is at 53 kg, mid-pack instead of trailing.
>
> Twelve hours later, a new Leviathan spawns at the lobby's geometric center — closer to whoever has the most outposts (Anna and Bart). The cycle continues.
>
> **Coalition effect:** Bart and Anna were quietly allied. Cleo's Wreck capture broke that quiet — Bart is now in third place where Cleo was, and the next Leviathan is going to target Anna *or Bart*. Bart messages Anna: "I need you to fund the Leviathan attack next time so I can stay ahead of Cleo." But there is no funding. Bart has to gift drillers or capture an outpost — visible, expensive actions.

**Tradeoffs / new problems.**

- An NPC in a player-driven game is genre-controversial. Subterfuge has never had AI factions; some players will feel the sim has been polluted. [Inference]
- The Leviathan can be ignored if no one bids on it; then it just chews on the leader and turns into a passive anti-leader tax — which is basically Power Grid's reverse turn order in costume. Plausibly fine, but make sure the Wreck payoff is rich enough to be worth racing for.
- Determinism risk: garrison size as a function of player Neptunium ranks creates a feedback loop where killing the Leviathan jumps you up the ranks and changes the next garrison. Need to verify monotonic / stable behavior in playtest.
- Multi-account/wolf-pack interaction: a wolf-pack could farm Leviathans by having one alt take the killing blow on each Wreck. Counter: cap Wreck Neptunium gain at 5% of the receiver's current total per game-day.

---

### 4B. **Contract Board** — public objectives with multi-claimant payouts

**Elevator pitch.** Every game-day, the engine publishes 1-3 public *contracts* (capture this outpost, sink N enemy drillers in 24h, hold this sector). The first 2-3 players to complete each contract split a Neptunium pot.

**Mechanic.**

- The world contains a `world.contracts: Contract[]` list. Each contract has `{ id, kind, target, deadline, payoutKg, slots, claimants[] }`.
- Contracts are generated deterministically at fixed game-time intervals: every 24h in classic (7 contracts/match), every 90 min in blitz (16/match). Contract generation reads `world.seed`, `world.time`, and the current map state — no RNG outside `rng.ts`.
- Contract kinds (all derivable from existing sim state):
  - **Bounty Hunt** — be the player who lands the killing blow on player X's shielded outpost. (Target X is the current Neptunium leader.) Pays out to the killer only.
  - **Salt Harvest** — produce ≥ 3 kg Neptunium from a specific mine in the next 24h. Pays out to the first 2 players to hit the threshold.
  - **Sector Patrol** — have the most drillers in a 200-unit-radius sector at deadline. Pays out top 3.
  - **Specialist Hunt** — kill or capture an active enemy specialist of named type (e.g. "kill any King"). Pays out top 1.
- Pot sizes scale with elapsed match time: early contracts pay 1-2 kg; late contracts pay 4-8 kg. (Encourages mid-match aggression; rewards late chaos.)
- **Eliminated players keep contracts:** an eliminated player whose contracts pay out before deadline (e.g. a Bounty Hunt where someone else they "subscribed" to claims it) gets a posthumous Neptunium credit applied to a *Ghost Score* (see 4D for one use of this — or just leaderboard glory).
- HUD: a contract sheet visible to all players, with countdown timers and current claimant snapshot.

**Addresses postmortem issues #3, #5, #6** (with secondary #2 effect).

- **#3 (forced betrayal)** — players have something to do *other than* attack each other. The contract is a non-betrayal source of Neptunium. You can ally with someone and still both score on Salt Harvest (2 slots).
- **#5 (eliminated players)** — eliminated players retain a stake in posthumous contract resolution. Living players know their bounties continue. The Ghost Score gives the eliminated player a thing to watch and root for during the rest of the match.
- **#6 (dominant coalition)** — the multi-slot payouts (top-2, top-3) reward parallel competition, not coordinated domination. A 3-player coalition trying to sweep all 3 slots of a Sector Patrol contract has to send drillers to one sector — exposing their flanks.

**Integration with existing systems.**

- New file `packages/sim/src/contracts.ts` with the `Contract` type and pure-functional generation / claim / resolution. Tick calls `advanceContracts(world)`.
- Contract kinds map to existing sim queries: Salt Harvest reads `mining.ts`; Bounty Hunt reads `combat.ts` events; Sector Patrol reads outpost ownership in a sector; Specialist Hunt reads `specialists.ts` state changes.
- HUD lives in client; the server ships the contract list as part of per-player snapshots (no filtering — contracts are public).
- New events: `contract_published`, `contract_claimed`, `contract_expired`.

**Worked example.**

> Day 2, 7-day match. The engine publishes:
> - Contract A: Bounty Hunt — kill any of Anna's shielded outposts. Payout 3 kg to winner. Deadline: 48h.
> - Contract B: Salt Harvest — extract 3 kg from mine M-7 (currently neutral). Payout 2 kg each to first 2 players. Deadline: 24h.
> - Contract C: Sector Patrol — most drillers in sector NE-3 at deadline. Payout 4/2/1 kg to top 3. Deadline: 24h.
>
> Anna is the leader; Contract A puts a price on her head — visibly. She knows it. She can buy off the threat by gifting the contract payout pre-emptively, ally with a specific player to defend her shields, or just shield-up. Either way she's spending political capital on this contract.
>
> Bart and Cleo are quietly allied. Contract B (Salt Harvest) pays *both* of them if they each grab a slot — they don't have to compete with each other. They race together, both score, both gain 2 kg. *No betrayal needed.* This is the new alliance-positive endgame: cooperate on a multi-slot contract, share the win.
>
> Contract C (Sector Patrol) sits in the path between Dev's home and Eve's home — they have to commit drillers to a sector that puts them in attack range of each other. Either they race and fight (good content), or they truce and share top 2 slots (good content), or they both ignore it and Anna walks in (Anna's third major action this day — diluting her attention).
>
> Late game (day 6), pot sizes climb to 8 kg. A single contract is now a meaningful fraction of the 200 kg victory threshold. Endgame becomes "everyone races to claim the last 2-3 mega-contracts" — a Twilight Imperium-style round-based scoring sprint, not a slow grind.

**Tradeoffs / new problems.**

- Adds real new subsystem (contract generation, claim tracking, resolution). Medium-sized lift; estimate 5-8 days of sim work plus UI.
- Risk that contracts become the *only* content — the underlying outpost/sub game gets reduced to a contract-chasing minigame. Counter: cap contract Neptunium at ≤ 30% of total Neptunium velocity per match.
- Contract balance is a perpetual live-ops cost. (Compare TI4's strategy card rebalances across editions — [FFG TI4 rulebook changelog](https://images-cdn.fantasyflightgames.com/filer_public/87/9b/879bd0fe-d495-460b-a4c6-c2d83b94f1f8/ti-k0_rulebook_web.pdf).)
- Sonar visibility on contract progress: do players see each other's progress in real time, or only on completion? Real-time = dogpile risk; on-completion = surprise loss feels bad. Likely answer: real-time for Sector Patrol; on-claim for Bounty Hunt and Salt Harvest.

---

### 4C. **Bounty Market** — players post Neptunium prices on each other's heads

**Elevator pitch.** Funding goes; in its place, any player can post a public Neptunium bounty on any other player. Killing or capturing a marked player's outposts pays the bounty to the attacker — funded out of the poster's mining stream.

**Mechanic.**

- Any player A can post a bounty on player B: `postBounty(A, B, amount_kg)`. The amount is *escrowed* from A's live Neptunium total — A's number drops by `amount` immediately, the contract sits in `world.bounties[]`.
- Bounty payout triggers:
  - **Outpost capture** — when any player C (≠ B) captures one of B's outposts, C receives a fraction of the bounty: `payout = min(remaining, base_per_outpost)` where `base_per_outpost = 0.5 kg` per non-Mine and 1.5 kg per Mine.
  - **King kill** — if C kills B's King specialist, C receives 5 kg from the bounty.
  - **Elimination** — if any player eliminates B, the remaining bounty pays out 80% to the eliminator, 20% returned to the poster.
- Bounties are **public** — every player sees who has posted what amount on whom. The HUD shows a "wanted list" with current bounty values per player.
- Bounties cannot be self-posted. Posters can withdraw any *unspent* portion only after a 24h cool-down (4h in blitz) — so you can't post, scare your target, then refund. The fear has to cost you.
- Multiple players can post bounties on the same target; bounties pool. (The pool incentivises piling-on, which is the entire point.)
- **Eliminated players can post bounties.** Posthumous bounties draw from the eliminated player's residual Neptunium and pay out to whoever continues the work. This is one of the cleanest "give eliminated players agency without giving them combat control" hooks in the design space.

**Addresses postmortem issues #4, #5, #6** (and #2 secondary).

- **#4 (king-stacking)** — explicit King-kill bounty bonus prices the King's overpoweredness. A coalition with 8 Kings becomes a coalition with 8 × 5 kg = 40 kg of standing bounty for any non-coalition player who can pick off a King. Self-correcting.
- **#5 (eliminated players)** — posthumous bounties give eliminated players one of the most powerful actions in the game (assassinating the leader by proxy). Eliminated player keeps a HUD, keeps placing bounties, keeps watching them get cashed.
- **#6 (dominant coalition)** — the lobby can pool bounties against the leader. A 5-player lobby posting 5 kg each = 25 kg of standing bounty on player #1. Player #1's outposts become a *resource*, not a fortress. Today the coalition has no mechanical way to express collective threat; here, they have a price tag.
- **#2 (one disengaged player)** — even an AFK player's outposts become "free Neptunium" for whoever attacks them under a posted bounty. Lobby self-cleanses dead weight; the disengaged player's territory gets carved up faster, ending matches that would otherwise stall.

**Integration with existing systems.**

- New `world.bounties: Bounty[]` with `{ id, posterId, targetId, escrowKg, postedAt }`.
- New order: `PostBounty`. Order arrives, escrow is deducted from `liveNeptuniumThousandths`.
- Payout hooks in `combat.ts` (outpost capture, specialist kill) — they check `world.bounties` and credit the attacker's player record.
- Visibility: bounties are global, no per-player fog filtering.
- New events: `bounty_posted`, `bounty_paid`, `bounty_withdrawn`.

**Worked example.**

> Day 3. Anna leads at 70 kg. Bart 50, Cleo 45, Dev 40, Eve 30.
>
> Cleo posts 5 kg bounty on Anna. Cleo's total drops to 40 kg; the HUD now shows "Anna: 5 kg bounty (Cleo)". Anna sees it. Bart sees it.
>
> Dev sees that Cleo has signaled hostility to Anna and decides to pile on: posts 3 kg of his own. Anna now has 8 kg standing bounty. Even Bart, Anna's quiet ally, is now staring at the math: capturing a non-Mine outpost of Anna's would pay 0.5 kg from the pool. Bart's outposts are 5 hours away from Anna's nearest unshielded Generator. Bart does the calc: 0.5 kg + the political optics of "publicly turning on his ally for a small payout" — declines. But the temptation is now a *visible variable* on the HUD, not implicit. Anna knows Bart is being tempted.
>
> Day 5. Eve is eliminated. Before her last outpost falls, she posts her residual 22 kg Neptunium as a bounty on Anna. Now Anna has 30 kg of standing bounty on her. The endgame becomes a feeding frenzy where every outpost capture against Anna pays — and Eve is *spectating with vested interest*, messaging the survivors with intel from her former sector.
>
> The match ends a day earlier than it would have, because the bounty math accelerated the leader's collapse.

**Tradeoffs / new problems.**

- Risk of perpetual hate-train against whoever is currently #1, never letting a leader establish. Counter: bounty escrow caps at 20% of poster's current Neptunium per post; cooling-off period of 24h between posts on the same target.
- Risk of *coalition* posting massive bounties on outsiders, pricing them out of the game. Counter: bounty payouts are uncapped on *upward* targets (poster has less Nep than target) but capped at 1 kg on *downward* targets (poster has more Nep than target). Bounties flow uphill; can't be used as a downward bully tool.
- Pre-posting collusion risk: Anna and Bart could pre-arrange that Bart "captures" one of Anna's outposts to redirect bounty payout to Bart. Counter: bounty payout requires that the captured outpost have ≥ 10 drillers at time of capture (i.e. real combat). [Inference] this is fragile; needs playtest.
- The mechanic explicitly increases dogpile pressure on the leader. That's the goal, but it can over-correct and make leading feel hopeless. Tunable via the per-outpost payout floor.

---

### 4D. **The Council of the Sunken** — eliminated players run a shared faction

**Elevator pitch.** When a player is eliminated, their remaining outposts merge into a shared **Sunken Council** faction controlled collectively by *all* eliminated players. The Council can launch subs but cannot win the match; it earns its own Neptunium toward a *Spite Score* leaderboard.

**Mechanic.**

- When a player is eliminated (their last outpost captured), their remaining drillers/outposts/subs do **not** convert to the conqueror. Instead, they transfer ownership to a special player slot — `COUNCIL_PLAYER_ID` — that all eliminated players co-control.
- The Council is governed by a simple voting layer: any order on a Council outpost requires a majority of currently-eliminated players to ratify within a 2h voting window. (1 eliminated player = autocrat. 2 = both must agree. 3+ = majority vote.) Voting state lives in `world.councilProposals[]`.
- The Council cannot win the match by Neptunium — it has no victory condition. But the Council *accumulates a Spite Score* equal to total Neptunium produced + 2× total drillers killed in combat. End of match, the Spite Score leaderboard is posted alongside the winner.
- The Council's outposts decay if held too long uncontested — each Council outpost loses 1 driller per hour after 48h, simulating "the dead need help." This keeps the Council from becoming a static reserve army.
- The Council can **chat publicly** with all living players (no DMs) — this becomes the eliminated-player social space.
- An eliminated player can opt out of Council membership (e.g. they want to leave the match cleanly) — their vote share is removed.

**Addresses postmortem issues #2, #3, #5** (with secondary #4, #6).

- **#5 (eliminated players)** — this is the headline fix. Eliminated players keep playing, with real mechanical power, on a clear non-kingmaker track (Spite Score instead of victory).
- **#2 (one disengaged player)** — disengaged players who get eliminated *don't take their assets with them*. The Council inherits them. Even a player who quit on day 1 has their territory absorbed into a faction that the rest of the lobby has to interact with.
- **#3 (forced betrayal)** — when you eliminate an ally, they don't just disappear hurt — they join the Council and become an interesting opponent. The "I had to betray my friend and now I feel bad" experience is reframed as "I had to betray my friend and now they're plotting against me from beyond the grave, which is rad."
- **#4 (king-stacking)** — Kings absorbed into Council on elimination still count for combat math. A 4-King leader who eliminates a 4-King player now faces an 8-King Council. King-stacking through coalition cleansing self-corrects.
- **#6 (coalition)** — the coalition that eliminates outsiders is paradoxically *empowering the Council*, which becomes a third faction the coalition has to fight. Doubles as a partial counter.

**Integration with existing systems.**

- Reserve `COUNCIL_PLAYER_ID` as a negative `PlayerId` (or "0" if we want it to be the natural identity element). Sim treats it like a real player in `combat.ts`, `subs.ts`, `mining.ts`, etc. — only `victory.ts` excludes it.
- New `world.council: { members: PlayerId[], proposals: Proposal[] }`.
- Voting state machine in `packages/sim/src/council.ts`.
- HUD: eliminated players see a "Council" view alongside the regular map; living players see Council outposts as a fourth color.
- Chat: extend `appendMessage` to allow `COUNCIL_PLAYER_ID` as `to` — broadcasts to all Council members.

**Worked example.**

> Day 4. Bart is eliminated (Anna captured his last outpost). Bart's remaining 3 outposts and 80 drillers transfer to the Council. Bart is now the sole Council member; he autocrats.
>
> Bart immediately launches a 60-driller revenge sub at Anna's closest Mine. The sub takes 8h to arrive; Anna sees it (Council subs are not stealthed). Anna has to redirect.
>
> Day 5. Cleo is eliminated by Dev. Cleo joins Council; her 2 outposts + 50 drillers merge in. Bart and Cleo now jointly govern. They have to ratify orders within 2h. They negotiate in Council chat: "Cleo wants to hit Dev; Bart wants to hit Anna." They compromise — split the fleet, half to each. Spite Score climbs.
>
> Day 6. The Council holds 5 outposts and is producing ~1 kg/day of Neptunium. Anna, the leader, is now fighting on two fronts: Dev (who is still a victory threat) and the Council (who is a Spite Score threat that costs her drillers but can't win). The match's *content density* doubles.
>
> Endgame: Anna wins with 220 kg; Spite Score leaderboard shows Council with 18 kg + 240 kills = 258 Spite. Bart and Cleo "lost" the match but have a public record of how hard they fought after death. Post-game chat: Bart sends Cleo "good game", Cleo says "let's queue another." Both reactivate — which is the *actual* retention metric.

**Tradeoffs / new problems.**

- Largest sim footprint of any proposal here. Adds: voting system, faction with no victory, owner-id sentinel, decay rules, post-elimination chat. Estimate 10-15 days of sim+UI work.
- Voting collapses badly with absent members: if Bart is in the Council but goes AFK, his vote share blocks Cleo. Counter: votes auto-default to "abstain" after 4h.
- Risk of Council becoming the *most fun role* and players intentionally getting eliminated to join it. Counter: Spite Score caps at ~30% of the winning player's Neptunium total — never enough to feel like "winning."
- Doesn't solve match length (#1) directly; arguably extends matches by giving eliminated players a reason to want them to continue. Acceptable if (#5) is solved hard enough that long matches *feel* shorter.
- Specialist accounting needs care: eliminated player's Queen, Tinkerers etc. transfer to Council — and the King-stacking math means a Council with 8 Kings is genuinely terrifying. Probably needs a cap.

---

### 4E. **Pact Tokens** — formal co-victory with structural anti-coalition pressure

**Elevator pitch.** Replace the single-winner victory condition. Players can publicly form *Pacts* of 2-3 players; pacts win together if their *combined* Neptunium hits a scaled threshold. But pacts cost a tax, expire after 24h, and the more players in a pact the higher the per-player threshold.

**Mechanic.**

- New game-end victory condition. Existing single-winner remains (player Neptunium ≥ 200 kg) **and** new pact victory: a public pact's combined Neptunium ≥ `200 + 30 × (pact_size - 1)` kg (so a 2-player pact needs 230 combined, a 3-player pact needs 260). Pacts of 4+ are not allowed.
- A pact is formed by mutual public declaration: each prospective member submits a `JoinPact` order naming the others. When all members have submitted matching orders, the pact is active.
- Pacts are **public** — visible in HUD with combined Neptunium total, individual contributions, and expiration timer.
- Pacts **auto-expire after 24h** (4h in blitz). To continue, members must re-declare. (Forces continual reaffirmation; prevents pact = permanent alliance.)
- **Pact tax:** each pact member's mining rate is reduced by 10% per additional pact-mate (so a 2-pact = 10% tax, 3-pact = 20% tax). The tax models the "coordination cost" of formal alliance.
- A player can be in at most one pact at a time. Leaving early (`LeavePact` order) is allowed but forfeits 5 kg of personal Neptunium to the lobby pot (split among non-pact survivors).
- If a pact wins, the in-game leaderboard shows all members as winners; ranking within the pact uses individual Neptunium contribution.
- **Soft single-winner protection:** any single player can still hit 200 kg solo and win solo — the pact mechanic doesn't change solo play.

**Addresses postmortem issues #1, #3, #6** (with secondary #5).

- **#3 (forced betrayal)** — this is the headline. magic00's App Store review ([docs/13 §2.5](./13_player_feedback_postmortem.md)) explicitly asked for multi-winner. Players who want to win with their friend can; the friend doesn't have to die for them to win.
- **#1 (match length)** — pact victory thresholds are reachable faster than solo (230 combined > 200 solo, but 2 players reach 115 each rather than 1 player reaching 200). Pact games end 1-2 days earlier in expectation. [Inference]
- **#6 (dominant coalition)** — paradoxically, pacts *break up* coalitions because they're capped at 3 and taxed. A 4-player de-facto coalition has to choose which 3 members get the win; the fourth is excluded, has no Pact path, and is incentivised to attack the pact-mates before they win.
- **#5 (eliminated players)** — if an eliminated player was in a pact, the pact's threshold drops (pact_size-1) but contributions count toward the surviving members. Eliminated player gets a posthumous co-win if the pact succeeds. Their watch is rewarded.

**Integration with existing systems.**

- `world.pacts: Pact[]` with `{ id, members: PlayerId[], formedAt, expiresAt }`.
- New orders: `JoinPact`, `LeavePact`.
- `victory.ts` extended: checks pact totals in addition to per-player totals.
- `mining.ts` extended: tax multiplier applied per pact member.
- HUD: a "Pacts" panel showing active pacts, combined totals, expiration timers.

**Worked example.**

> Day 4. Anna 100 kg, Bart 80 kg, Cleo 60 kg, Dev 40 kg, Eve 30 kg. Solo victory threshold 200 kg.
>
> Anna realises she's the kingmaker but doesn't want to be — she wants out. She proposes a pact to Bart: combined 230 needed, currently 180. Both submit JoinPact. Pact active. Tax: 10% on mining rates.
>
> Cleo, Dev, Eve see the pact in HUD. They have a deadline: prevent (Anna+Bart) from hitting 230 within 24h (the pact expires; they'd have to re-declare). Three-vs-two becomes the natural counter.
>
> Cleo proposes a 3-pact with Dev and Eve: combined 260 needed, currently 130. Long way. They form anyway (per docs/16 §6: visible coalitions are healthier than invisible ones). Tax: 20% on mining for each.
>
> Now: (Anna+Bart) 180 → racing to 230 under 10% tax. (Cleo+Dev+Eve) 130 → racing to 260 under 20% tax.
>
> Day 5. Anna+Bart hit 220. Cleo+Dev+Eve at 170. Cleo realises 260 is unreachable but the *single* threshold of 200 is reachable for her if she breaks pact. She executes `LeavePact`, forfeits 5 kg. Cleo 55 kg, free to act solo. Dev and Eve are now a 2-pact at threshold 230, combined 110.
>
> Cleo immediately attacks Bart's Mine (a recent capture, lightly defended). She lands the blow, captures, Bart drops to 60 kg, Anna+Bart pact drops to 200 (below threshold). She has destabilised the leading pact at the cost of a 5 kg betrayal fee.
>
> Day 6. Cleo at 70 kg solo. Anna+Bart pact reforms at higher cost (24h cooldown? — playtest). The endgame is now genuinely contested.
>
> Outcome: Anna+Bart win together with 235 combined. The match ends day 6 instead of day 7, with two satisfied winners and no friendship-destroying betrayal between them. Cleo, Dev, Eve all played to the last hour; none of them felt like "I sat out for 5 days."

**Tradeoffs / new problems.**

- **Changes the win condition** — biggest design risk. Carmel rejected formal alliances. Counter-argument: pacts aren't alliances, they're explicit *co-victory contracts* with public terms, taxes, expiration, and the ability to betray.
- Pact tax balance is the whole game. 10%/20% is a starting guess; could easily need to be 20%/40% or 5%/10%. Hard to know without playtest.
- 3-cap forces the 4-coalition problem (4 quiet allies have to pick 3) but creates a *new* edge case: 4-player lobbies. A 4-player lobby could form a 3-pact + 1 outsider; the outsider is doomed. Probably needs the cap to scale with lobby size (cap = floor(N/2) for N ≥ 6, hardcap 3 for N=4-5).
- Pact victory thresholds are guesses. 230 / 260 are picked from intuition; might need to be 250 / 300 to keep pact wins genuinely hard.
- Multi-account interaction is severe: a player with 2 alts can self-pact for the lowest possible threshold. Hard counter needed — pact members must have non-trivial mutual combat history (>20 driller kills between them in the match) before pact is valid. [Inference]; needs ironing.

---

## 5. Recommendation

**Ship 4D (Council of the Sunken) as the primary funding-slot replacement, layered with 4B (Contract Board) at a smaller scope.** Reasoning:

1. **Council attacks the #1 and #5 problems together.** The eliminated-player dead-zone (#5) is the most actionable problem in the postmortem — direct testimony, no inference. AFK-collapse (#2) is partially addressed by absorbing AFK assets into the Council. Forced betrayal (#3) is reframed because the eliminated friend isn't gone, they're an antagonist. Three of the top five with one mechanic.
2. **Council scales naturally to all lobby sizes.** Where Pact Tokens (4E) breaks at 4-player lobbies and the Leviathan (4A) needs garrison tuning per size, the Council is "more eliminated players = more Council power" with no special-casing.
3. **Council is the most Subterfuge-in-spirit option.** A persistent third faction governed by a small group of players is exactly the kind of social-strategic content the original community-loved (compare Carmel's "specialists break the rules" pacing — [docs/13 §2.4](./13_player_feedback_postmortem.md)). It's the *only* proposal here that explicitly preserves the game's social-deduction core while adding new content.
4. **Council requires no victory-condition change.** Unlike 4E (which redefines what winning means), Council leaves the existing single-winner condition intact while giving eliminated players a parallel score. Lower risk of community whiplash.
5. **Contract Board (4B) complements Council perfectly.** Contracts that pay out posthumously give Council members concrete things to optimise for; Council's voting structure becomes "which contract do we chase this cycle?" — a natural play loop. The two systems compose cleanly.

**Implementation path.**

Phase 1 (sim, ~6 days):
- Add `COUNCIL_PLAYER_ID` sentinel to `packages/sim/src/types.ts`.
- New file `packages/sim/src/council.ts` — proposal/voting state machine, ownership transfer on elimination, decay rules.
- Modify `packages/sim/src/victory.ts` to exclude Council from victory; add Spite Score calculation.
- Modify `packages/sim/src/combat.ts` and `subs.ts` to handle `COUNCIL_PLAYER_ID` ownership.
- Modify `packages/sim/src/diplomacy.ts` to support Council chat scope; delete `startFunding`/`stopFunding`/`autostopFundingIfBelowThreshold`.
- Modify `packages/sim/src/production.ts` to remove `FUNDING_*` constants and bonuses.
- Add events: `council_formed`, `council_member_joined`, `council_proposal`, `council_vote`, `council_decay`.

Phase 2 (server, ~2 days):
- Snapshot filter changes — Council members see Council state plus their old player view; living players see Council outposts as a fourth color.
- Order routing: Council orders require a proposal+ratification flow.

Phase 3 (client, ~3 days):
- Council HUD panel for eliminated players (proposal list, vote buttons, chat).
- Map renderer adds Council faction color.
- Post-elimination flow: "You're eliminated — join the Council?" modal.

Phase 4 (Contract Board overlay, ~5 days):
- Defer to a separate doc/phase once Council is shipped and tuned.

Phase 5 (balance + playtest, ongoing):
- Spite Score cap tuning.
- Decay timer tuning.
- Vote timeout tuning.
- Multi-account interaction (a player with one alt can join the Council and dominate voting — needs at minimum a 24h "you must have been eliminated for ≥ 2h" cooldown before vote eligibility).

**Why not the others.**

- **4A (Leviathan)** is the second-best option and may be worth shipping as a *complementary* world-event system later. It addresses #1 directly (caps lead velocity) and creates non-zero-sum content, but introduces NPC behavior to a player-only sim — a controversial precedent.
- **4B (Contract Board)** is excellent but heavy as a standalone. Recommended as a Council overlay (above), not as the primary replacement.
- **4C (Bounty Market)** is the cleanest 1:1 replacement for funding (same slot, same UX shape: "post something on another player") and would be a strong default pick. The reason to prefer Council is that Bounty Market does nothing for the eliminated-player problem, which is the most fixable retention issue.
- **4E (Pact Tokens)** is the highest-upside / highest-risk option. It directly addresses #3 (forced betrayal) — the deepest emotional complaint in the postmortem. But it changes the victory condition, which is sacred-cow territory. Recommend revisiting after Council ships and we have data on whether multi-winner pressure actually appears in player chat.

---

## 6. Open questions for playtesting

1. **Does Council voting deadlock badly?** Two eliminated players who disagree on every order will produce a Council that does nothing. Needs a tie-breaker (oldest member? most contributions? RNG via seed?). [Inference] — pick one and playtest.
2. **What's the right Council decay rate?** 1 driller/hour after 48h is a guess. If too slow, Council becomes a static threat; too fast, eliminated players have nothing to play with. Likely needs scaling with lobby size.
3. **Does Spite Score actually retain eliminated players?** The bet is that "I'm fighting for posthumous glory" is more motivating than "I'm watching." Could be wrong; the eliminated player might just leave anyway. Measurable via session length post-elimination.
4. **Does the Council create a kingmaker?** If the Council is too powerful, it picks the winner among living players by directing attacks. Cap on Council total power (e.g. Council Neptunium can never exceed 70% of leading living player's) might be needed.
5. **King-stacking absorbed into Council.** A Council with 12 Kings (from 3 eliminated players) is going to feel brutal in combat. Likely needs a per-faction King cap (e.g. effective King count capped at 4 globally per faction).
6. **Does the Council's existence shorten matches or extend them?** Hypothesis: shortens because it adds a faction that erodes the leader. Counter-hypothesis: extends because every eliminated player adds Council power, prolonging stalemates. Measurable.
7. **Multi-account interaction.** A player with two accounts who deliberately gets one account eliminated to gain Council voting power could shift Council orders. The 24h cooldown helps; payment-/device-fingerprint matchmaking helps more (cf. [docs/13 §2.7](./13_player_feedback_postmortem.md)). Funding-replacement cannot fully solve multi-accounting; should not make it worse.
8. **What happens in a 4-player game?** First elimination = 1-member Council (autocrat). Council can quickly become decisive in a small lobby. Possibly Council should be disabled below 5 players, with eliminated-player content handled via a smaller spectator/bet UI.
9. **Should Council members continue to gain personal Neptunium?** Or is the Spite Score the only number? Cleaner: only Spite Score, since personal Neptunium implies a victory path that doesn't exist.
10. **Interaction with Time Machine.** The client's future-projection re-runs the sim; Council voting introduces choice that the client can't predict. Future projection of Council orders should pessimistically assume "no order arrives" until ratified. This needs verification against `packages/client/src/projection.ts` and `packages/sim/src/queued-orders.ts`.

---

## Source list

Subterfuge-specific:

- [docs/13 — Player feedback postmortem](./13_player_feedback_postmortem.md)
- [docs/16 — Funding redesign (rejected directions)](./16_funding_redesign.md)
- [packages/sim/src/diplomacy.ts (current funding code)](../packages/sim/src/diplomacy.ts)
- [packages/sim/src/production.ts (funding bonuses)](../packages/sim/src/production.ts)
- [Designing Subterfuge — Gaming the Game](https://blog.subterfuge-game.com/post/112147930751/gaming-the-game) (search-excerpt access)
- [Subterfuge fandom wiki — Funding](https://subterfuge.fandom.com/wiki/Funding)

Genre / mechanic references:

- [Fantasy Flight Games — Twilight Imperium 4 rulebook (PDF)](https://images-cdn.fantasyflightgames.com/filer_public/87/9b/879bd0fe-d495-460b-a4c6-c2d83b94f1f8/ti-k0_rulebook_web.pdf)
- [TI4 Wiki — Mecatol Rex](https://twilight-imperium.fandom.com/wiki/Mecatol_Rex)
- [EVE University — Bounty hunting](https://wiki.eveuniversity.org/Bounty_hunting)
- [CCP — Dynamic Bounties devblog](https://www.eveonline.com/news/view/dynamic-bounties)
- [Rare — Sea of Thieves Adventures](https://www.seaofthieves.com/news/sea-of-thieves-adventures)
- [Sea of Thieves Wiki — Megalodon](https://seaofthieves.fandom.com/wiki/Megalodon)
- [Innersloth — Among Us mechanics](https://www.innersloth.com/games/among-us/)
- [BrotherBored — Why Players Prefer Draw-Size Scoring in Diplomacy](https://brotherbored.com/why-players-prefer-draw-size-scoring-in-diplomacy/)
- [Diplomatic Pouch — DSS overview](https://www.diplom.org/Zine/W2000R/Cohen/dss.html)
- [Polygon — How Mario Kart's items are weighted](https://www.polygon.com/2017/4/27/15445346/mario-kart-blue-shell)
- [Paradox Wiki — CK3 Factions](https://ck3.paradoxwikis.com/Factions)

Design theory (cross-references with doc 16):

- [Wikipedia — Kingmaker scenario](https://en.wikipedia.org/wiki/Kingmaker_scenario)
- [Skeleton Code Machine — Is kingmaking a problem to be solved?](https://www.skeletoncodemachine.com/p/kingmaking)
- [Thoughtful Gamer — Catch-Up Mechanisms](https://thethoughtfulgamer.com/2017/03/28/catch-up-mechanisms/)
- [Games Precipice — Positional Balance](https://www.gamesprecipice.com/positional-balance/)
