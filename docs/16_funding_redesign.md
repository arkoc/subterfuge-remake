# 16. Funding Redesign — A Structural Counter to Dominant Alliances

*Draft, May 2026. Owner: design. Status: concept exploration; not committed to sim.*

This doc proposes a redesign of Subterfuge's **funding** mechanic with one
explicit goal: turn funding into a structural counter to the
dominant-alliance / kingmaking pattern that the postmortem
([docs/13](./13_player_feedback_postmortem.md) §2.5, §5.1) identifies
as one of the top-three retention killers. Today's funding does the
opposite — it amplifies the leader's social leverage. We can do
better.

The doc is structured in seven parts: (1) what we ship today, (2)
design principles for a replacement, (3) what other games do that we
can borrow from, (4) 4 candidate directions with detailed mechanics,
(5) a recommendation, (6) lightweight overlays that work alongside
any of them, (7) open questions for playtest.

---

## 1. Current state — what funding does, why it's shallow

**Mechanic, as implemented.** When player A's live Neptunium total
leads player B by ≥ 20 kg, A may flag B as "funded." The recipient
gains a flat **+50 electrical output** (one free Generator's worth)
and **+2 drillers per factory cycle** while the relationship is
active. Funding can be revoked by A at any time, and is auto-revoked
when the lead drops back below 20 kg
([packages/sim/src/diplomacy.ts:76-132](../packages/sim/src/diplomacy.ts);
[packages/sim/src/production.ts:33-116](../packages/sim/src/production.ts);
constants in [types.ts:171-173](../packages/sim/src/types.ts)). The
donor pays nothing.

**Designer intent.** Carmel and Llopis built funding as a
leader-side **catch-up lever**: the leader is given a cheap tool to
prop up a weaker player and convert mining surplus into political
influence ([Designing Subterfuge — Gaming the Game](https://blog.subterfuge-game.com/post/112147930751/gaming-the-game),
surfaced via search excerpt;
[Subterfuge fandom wiki — Funding](https://subterfuge.fandom.com/wiki/Funding)).
The same blog post explicitly defends kingmaker-shaped tools on the
grounds that "the upside of those actions is bigger than the
potential downside" — i.e. the designers wanted gifting and funding
to exist *as* social levers, not despite their kingmaker potential.

**Why it falls short.** Three structural problems:

1. **Funding amplifies coalitions instead of countering them.** The
   only player who can fund is the leader. The leader's natural
   incentive is to fund their *ally*, not their enemy. So funding's
   first-order effect is to entrench the existing alliance, not
   redistribute power. The postmortem's "dominant 2-3 player
   coalition rolls the lobby" pattern is *helped*, not hurt, by
   today's funding.
2. **It costs nothing.** Free help isn't a strategic decision — it's
   a tax-free gift the leader has no reason to refuse. The auto-stop
   at 20 kg is the only friction, and it triggers far too late.
3. **It's invisible to non-participants.** A funded relationship is
   private state on the recipient's player record; other players can
   only infer it from production rate. There's no public signal that
   would let a coalition target a "funded enemy" or that would let
   the funded player credibly claim independence. As an information
   game piece, today's funding is dead weight.

In short, today's funding is a free *alliance amplifier* wearing
catch-up clothing. The redesign goal is to invert that.

---

## 2. Design principles for a redesign

A new funding mechanic should hit as many of these as possible:

1. **Funding should be expensive for the funder.** A free tool is a
   no-decision tool. The donor must give up something they would
   otherwise use to win.
2. **Funding should preferentially flow to outsiders, not allies.**
   The mechanic should structurally favour outside-the-coalition
   recipients — either through eligibility rules, payoff math, or
   public-information consequences.
3. **Funding should be public.** Funded relationships should be
   visible (or at least leak signal) to non-participants. Public
   funding becomes a coalition target. Private funding is a no-op
   politically.
4. **Funding should have a half-life.** The mechanic should *force*
   the leader to refresh, switch, or escalate — never settle.
   Open-ended funding becomes part of the coalition's
   infrastructure.
5. **Funding should compose with sub combat, not bypass it.** The
   sim is already good at sub combat. A funding mechanic that
   creates new sub flows (taxed cargo, tribute subs, bounty subs) is
   more in-genre than one that just changes per-tick numbers.
6. **24-hour blitz vs 7-day classic must both work.** Whatever we
   build needs sensible thresholds at both pacings — the postmortem
   §5.2 commits us to first-class blitz support.
7. **Determinism / sim purity preserved.** Whatever we ship lives in
   `packages/sim` and survives the lint rules in `eslint.config.js`:
   no clocks, no RNG outside `rng.ts`, integers for compounding
   state, pure functions.

A *successful* redesign would let us tell a story like: "On day 4,
the obvious leader was 30 kg ahead with two allies. By day 5 the two
allies were arguing about which of them got to defect, because
funding flow had publicly marked them as a bloc and the rest of the
lobby was visibly rewarded for breaking that bloc." Today, that
story can't be told because the only mechanical lever is private and
costless.

---

## 3. Genre survey — what other games do

Compressed reference. Cites are inline; broader treatment is in
section 4 of each candidate below.

| Game / system | Mechanic | What we can borrow |
|---|---|---|
| **Diplomacy (draw-size scoring)** | Surviving players in a draw split equally regardless of supply-center count ([BrotherBored](https://brotherbored.com/why-players-prefer-draw-size-scoring-in-diplomacy/)) | A scoring tail that **rewards survival**, not territorial maximalism. Reduces "I have to dot my ally" incentive. |
| **Civilization VI World Congress** | Once a player approaches Diplomatic Victory, every other civ gets a public vote to **remove 2 Diplo Points** from the leader; once they cross 14, the AI refuses to vote for them ([Civ Wiki — World Congress](https://civilization.fandom.com/wiki/World_Congress_(Civ6))) | A public **anti-leader vote** that triggers automatically at a threshold. The leader can see it coming. |
| **Catan — Largest Army / Longest Road** | 2 VP tokens that change hands as players overtake each other ([Catan FAQ](https://www.catan.com/faq/basegame)); community consensus that grabbing them early makes you a target ([alexcates breakdown](https://www.alexcates.com/post/catan-breakdown-longest-road-and-largest-army)) | **Public bounties** that move between players, paint a target, and reward chasing. |
| **Power Grid** | Reverse turn order: leaders bid first, buy resources last ([Power Grid wiki](https://boardgamegeek.com/wiki/page/Power_Grid_FAQ); [Games Precipice](https://www.gamesprecipice.com/powergrid/)) | A structural **leader-tax** baked into action ordering: leaders pay first and pay more. |
| **EVE Online sovereignty** | Holding sov requires ongoing fuel / workforce / reagents; lapsed upkeep remaps ownership ([EVE Online — Equinox](https://www.eveonline.com/news/view/sovereignty-structures-and-transition); [Lapsed Upkeep](https://www.eveonline.com/news/view/lapsed-upkeep-payments-remap-null-sec-sovereignty)) | An **upkeep cost** that scales with empire size. Leaders pay an ongoing tax even if they do nothing. |
| **Crusader Kings — factions** | Vassals with negative opinion auto-form factions; once military power crosses 80% of the liege's, they declare war ([gamerant](https://gamerant.com/crusader-kings-3-how-to-handle-factions-guide/)) | An automatic **opposing coalition** that forms at a public threshold of relative power. |
| **Twilight Imperium / general "the AI dogpiles the leader"** | The threat of dogpile is the catch-up mechanic ([thoughtfulgamer Cat. 4](https://thethoughtfulgamer.com/2017/03/28/catch-up-mechanisms/)) | We're already in this category. The question is what *tool* the dogpile gets. |
| **Junta** | Tax revenue is auctioned by El Presidente to coalitions, who then attempt assassination + coup; any coalition can flip mid-battle ([Junta rulebook PDF](https://www.alderac.com/wp-content/uploads/2015/04/Junta_rulebook-1.pdf); [TVTropes](https://tvtropes.org/pmwiki/pmwiki.php/TabletopGame/Junta)) | A **public-pot redistribution** event where the leader pays out, the recipients are visible, and "who gets the kickback" is a negotiation. |

Two cross-cutting findings:

- **The most successful anti-leader mechanics are public** ([Civ
  World Congress, Catan tokens, EVE sov, CK3 factions all
  publicly-known states). Private catch-up mechanics either get
  ignored by the community or get gamed by the leader.
- **Catch-up mechanics that cost the leader something concrete out-perform mechanics that give the trailing player something for free.**
  Carmel's own writing on mine cost escalation
  ([Subterfuge blog — Gaming the Game](https://blog.subterfuge-game.com/post/112147930751/gaming-the-game))
  arrives at the same conclusion: the second mine costs the *same
  player* more, not their opponents less.

---

## 4. Proposed directions

Four candidate redesigns, presented in increasing order of
mechanical ambition. Each could ship; each has different
playtest risk.

---

### 4A. **Stagnation Tax** — funding becomes a debit, not a gift

**Elevator pitch.** Funding is a tax the leader *must* pay if they
hold the Neptunium lead too long, and the receivers are the lobby's
*non-allied* trailing players — chosen by an open auction the leader
runs.

**Mechanic.**

- Every 4 in-game hours (24h-blitz: every 30 min — i.e. 8 ticks/day
  in both modes), any player whose Neptunium leads the **median**
  by ≥ a *stagnation threshold* (start with 25 kg in classic, 4 kg
  in blitz) becomes "Stagnation Taxed."
- The taxed player **must** declare a recipient before the next tax
  tick or lose **0.5 kg of Neptunium total** to the lobby pot (which
  is then split by surviving non-leaders proportionally to inverse
  Neptunium rank — bottom player gets the biggest share).
- The declared recipient gets today's +50 elec / +2 drillers per
  factory cycle bonus, *but only for the 4-hour window* until the
  next tax. The leader chooses again.
- **Eligibility filter: the recipient must not have gifted a sub to
  the donor in the last 12 hours, and must not have been a gift
  recipient from the donor in the last 12 hours.** This makes
  funding flow structurally *outside* an existing alliance.
- Funding flow is **publicly visible** in the HUD ("Player B funded
  by Player A — expires in 1h 23m").

**How it counters dominant alliances.**

- Math: the leader can no longer keep mining surplus to themselves
  *and* keep their ally happy. They either (a) pay a real Neptunium
  cost to no recipient, (b) fund their ally — but the
  no-gifts-12h-window rule makes that diplomatically expensive
  because they have to publicly *not gift* their ally for half a day
  to qualify, or (c) fund a non-allied player, who is now visibly
  empowered against the coalition.
- All three options are bad for the coalition. Today, the leader has
  no bad options.

**Cost of being wrong.**

- The lobby-pot split is hard to balance. Too generous and trailing
  players coast; too stingy and Stagnation Tax decays into a flavor
  text. Probably need to set the pot at exactly 1 kg / window
  (split among 3-4 non-leaders) so it materially helps but never
  comprises >5% of total Neptunium velocity.
- The 12h-gift filter is exploitable: two allies just stop gifting
  for 12 hours and continue funding each other. Plausible
  counter: also disqualify recipients whose **sonar overlap** with
  the donor exceeds a threshold, since coordinated allies build
  overlapping sonar.

**24h vs 7-day implications.**

- 24h blitz: 4 h becomes 30 min, threshold 4 kg, pot 0.1 kg / window.
- 7-day classic: as stated. Roughly 36 tax windows over a match.
- Both pacings scale by the same ratio of game-length / window —
  always 36 windows in a match. This means the long-term *number of
  funding decisions* is invariant across modes.

**Integration with existing systems.**

- `Player.fundedBy` becomes `Player.fundedBy: { donorId, expiresAt }`
  with `expiresAt` set at declaration time.
- New event `stagnation_tax_due` emitted to the leader; UI presents
  recipient picker with eligible candidates pre-filtered.
- Lobby pot redistribution is an integer Neptunium-thousandths flow
  using existing `liveNeptuniumThousandths` plumbing.
- No new specialist needed; existing diplomats / hypnotists
  unaffected.

**Concrete example.**

> Hour 96 of a 7-day. Anna leads at 88 kg; Bart 65 kg; Cleo 60 kg
> (Bart+Cleo coalition); Dev 45 kg; Eve 30 kg. Median = 60 kg, so
> Anna (+28) is taxed.
>
> Anna gifted Bart 20 drillers 3 hours ago, so Bart is *ineligible*.
> Anna can fund Cleo (also in the coalition, also recently a
> reciprocal sub recipient — ineligible by overlap), Dev (no gifts,
> low sonar overlap — eligible), or Eve (eligible). Or pay 0.5 kg
> into the pot.
>
> Anna funds Dev. Dev now has +50 elec and +2 drillers/cycle for the
> next 4 hours, and the HUD shows "Dev funded by Anna" to everyone.
> Bart and Cleo see this and now have a math problem: Anna is
> visibly arming the player most likely to attack their flank, and
> their existing alliance with Anna is publicly broken-looking. Bart
> messages Anna: "Why are you funding Dev?" Cleo messages Dev: "What
> did Anna want from you?" The information that *previously didn't
> exist* now actively destabilises the coalition.

---

### 4B. **Coalition Bond** — make alliance membership a public, taxable state

**Elevator pitch.** When two players exchange more than N gift
drillers in a sliding window, the engine declares them a "Bonded
Pair." Bonded pairs pay a passive Neptunium tax to the lobby pot.
The tax is the *only* mechanical alliance marker — players can opt
in or stay informal.

**Mechanic.**

- The engine tracks rolling 24h gift-driller volume between every
  pair of players (cheap, O(player²) state).
- Once `volume(A,B) ≥ 100 drillers` AND `volume(B,A) ≥ 100
  drillers` in the trailing window, the pair is **Bonded**. (One-way
  gift floods do not bond — bonding requires reciprocity.)
- Bonded pairs each pay **0.2 kg/day** in Neptunium to the lobby pot
  per bond. (A player in two simultaneous bonds pays 0.4 kg/day,
  etc.)
- Bonded pairs gain **+10% sub speed on subs between them** and
  **shared sonar over their bonded outposts** — i.e. the bond is a
  real alliance with real upside; the tax is the cost of declaring.
- A bond **dissolves** automatically when reciprocal volume drops
  below 100 in either direction; once dissolved, the bond cannot
  reform for 12 hours.

**How it counters dominant alliances.**

- Alliances are no longer free. The de-facto coalition pays a
  visible Neptunium tax that funds everyone else. The 200-kg victory
  threshold means a 0.2 kg/day tax over 5 days = 1 kg of margin
  given up — small at first but enough to swing tight finishes.
- The 12-hour reformation cooldown means coalitions can't repeatedly
  dissolve to dodge tax. They either pay the tax or genuinely
  separate.
- Crucially, players who *want* to ally still can — they just have
  to publicly declare. Players who pretend to ally but don't gift
  pay nothing but also don't get the speed/sonar perks.

**Cost of being wrong.**

- Risk of soft-formalising alliances, which Carmel explicitly
  rejected ([docs/13 §2.13](./13_player_feedback_postmortem.md)).
  Counter: bonds are not "alliances"; they confer speed/sonar perks
  but no chat protection, no combat protection, no victory share.
  Players can betray a bonded partner just like today.
- Risk of "loud" alliances getting bullied harder than "quiet" ones,
  re-creating the dominant-coalition problem with extra steps.
  Counter: the *tax* is part of the bargain. A coalition that pays
  is also publicly funding the rest of the lobby.

**24h vs 7-day implications.**

- Sliding window shrinks to 4 hours in blitz; gift-volume threshold
  scales to 20 drillers (matches the lower gift cadence in blitz).
- Tax rate: 0.05 kg/day in blitz (which lasts ~24h, so ~0.05 kg
  total). Lower nominal but proportionally same.

**Integration.**

- Add `world.bonds: Bond[]` with `{ a, b, totalAB, totalBA,
  formedAt }`.
- Recompute volume on every gift arrival (already a hot path).
- Sub-speed bonus lives in `subs.ts` velocity calc.
- Shared sonar lives in `visibility.ts` — bonded players' outposts
  contribute sonar to each other.

**Concrete example.**

> Day 3. Anna and Bart have been gifting back and forth — they've
> hit 200 drillers each direction in the last 24h. The HUD now shows
> a bond icon between them. Both pay 0.2 kg/day into the lobby pot,
> shared evenly with non-bonded players. Cleo, Dev, Eve each receive
> 0.13 kg/day. Anna and Bart's subs between each other move 10%
> faster, and Anna sees Bart's outposts as if they were her own
> sonar.
>
> Day 5. Anna realises she can break the bond by skipping gifts for
> a day. She does — and immediately loses sonar coverage of half her
> flank, AND can't re-form the bond for 12 hours. Bart sees the bond
> dissolve in the HUD and recognises the betrayal *before* a sub
> arrives. Now Bart can pre-empt. Today, Anna could betray cleanly
> with zero notice; here, breaking the bond is the visible alarm
> bell.

---

### 4C. **Shadow Market** — gift the leader's surplus to a public auction

**Elevator pitch.** Once per day, every Neptunium leader's mining
surplus above a "share line" is publicly auctioned. Players bid
**information** (truthful sonar feed) or **subs** for that share.
The leader has no opt-out.

**Mechanic.**

- Every 24h game-day (45 min in blitz), the leader's surplus is
  computed: `surplus = mining_yield_today - (median_yield × 1.5)`.
  If positive, this much Neptunium goes into the **Shadow Market**.
- All players except the leader may bid:
  - **Sub cargo** (drillers from their own outposts, sent to a
    designated neutral "market" outpost — picked at world-gen as a
    fixed central outpost, owner-less).
  - **Sonar grants** (an offer to share sonar of a chosen sector
    with the leader for the next 24h).
- The market closes after 4h of bidding. Winner takes the surplus
  Neptunium *into their personal Neptunium total*. The drillers/sonar
  go to the **leader**, not the lobby — so the leader receives
  *something*, just not their full surplus.
- If no one bids, the surplus stays with the leader (no penalty for
  ignored markets).

**How it counters dominant alliances.**

- The leader's Neptunium surplus is publicly redistributable. A
  coalition's leader can no longer cleanly hoard.
- More interestingly: the *coalition's other members* are now
  bidding against everyone else for the surplus. If Anna is leading
  and Bart is her ally, Bart has to either (a) bid hard (paying
  Anna in drillers/sonar) which signals the alliance and weakens
  Bart's economy, or (b) let an outsider win — which directly funds
  Anna's enemies.
- The information bid (sonar grants) is the most interesting
  vector: trailing players can pay the leader in fog-of-war
  intelligence, which costs them privacy but doesn't drain their
  economy.

**Cost of being wrong.**

- Adds a real new subsystem (market outpost, bid state machine,
  daily resolution). Heaviest of the four to ship.
- The "neutral market outpost" violates the current world-gen
  invariant that all outposts have an owner or are dormant. Either
  add a fourth ownership kind ("neutral") or use the lobby itself as
  the auctioneer with no on-map representation. Probably the latter.
- Risk that the surplus is too small to matter and the market
  becomes flavor text. Tunable by lowering the median multiplier
  (1.5× → 1.2×).

**24h vs 7-day implications.**

- 7-day: 7 auctions per match. Median surplus probably ~5-15 kg per
  auction in late game.
- 24h blitz: 32 auctions per match (45min cycles). Surplus per
  auction ~0.2-0.5 kg. Same role, faster cadence.
- Both work but blitz feels more like a constant background hum.

**Integration.**

- New `world.market: MarketState` (current surplus, bid list, closes
  at).
- New order types: `MarketBidSub`, `MarketBidSonar`.
- Resolves in `tick.ts` on a 24h boundary (use `world.time` modulo
  day-length).
- Touches `mining.ts` (compute surplus) and `visibility.ts`
  (temporary sonar grants).
- New event `shadow_market_resolved` visible to all.

**Concrete example.**

> Day 4 close. Anna mined 12 kg today, lobby median yield is 6 kg,
> share line is 9 kg. 3 kg of Anna's daily yield enters the Shadow
> Market.
>
> Cleo (trailing) bids 80 drillers shipped to the market outpost.
> Dev bids "24h sonar feed on my Sector 4." Eve bids 60 drillers.
> The bid system ranks them by a fixed exchange (1 driller = 1 unit;
> sonar grant of N outposts for 24h = N×3 units). Cleo wins with
> 80; Dev's 5-outpost-sonar bid would have been 75. The 3 kg
> Neptunium moves from Anna's total to Cleo's. The 80 drillers move
> from Cleo's outpost to Anna's nearest factory.
>
> Anna got drillers (useful but doesn't move her toward victory).
> Cleo got Neptunium (directly toward victory). Cleo's bid was
> *visible* — Anna's other ally Bart now knows Cleo is closer to
> winning than expected, and is incentivised to redirect against
> Cleo, fracturing the would-be Anna-Bart vs everyone alliance.

---

### 4D. **Spite Fund** — every player gets a daily anti-leader budget

**Elevator pitch.** Every non-leader gets a daily "spite credit" they
must spend on someone other than themselves. Unspent credits expire.
The credit can boost any non-leader's economy *or* sabotage the
leader.

**Mechanic.**

- Every 24h game-day, every player whose current Neptunium is
  *below* the leader's by ≥ 15 kg receives **3 Spite Credits**.
- A Spite Credit can be spent as one of:
  - **Boost**: target a non-leader player; they gain +1 driller per
    factory cycle for 24h. (Multiple boosts on the same target
    stack additively — 3 credits = +3 drillers/cycle.)
  - **Drag**: target the leader; they lose −2 drillers per factory
    cycle for 24h on one factory of the spender's choice (visible:
    the leader sees which factory and who).
  - **Reveal**: target the leader; you see the leader's outpost
    garrisons for 6h (one-way fog break).
- Spite Credits expire at end-of-day. They cannot be hoarded.
- Spite Credits **cannot** be spent on a player who is a bonded
  partner (cross-references 4B) or, if 4B isn't shipping, on a
  player you've gifted in the last 12h.

**How it counters dominant alliances.**

- Everyone outside the lead is *paid daily* to take a public stance.
  Not spending is a loss.
- The Boost target list publicly outs who you back. Coalition
  members must Boost each other (or not, signaling defection); the
  coalition becomes self-illuminating.
- Drag and Reveal are direct anti-leader. Coalition allies of the
  leader can choose not to Drag — but then their Boost is
  highly visible.
- Critically, this is **the only direction here that helps the
  trailing player do something concrete RIGHT NOW.** The other
  three directions are leader-side levers. Spite Fund is a
  trailing-side lever.

**Cost of being wrong.**

- Risk of dogpile by default: 5 non-leaders each spending 3 Drags →
  the leader loses 30 drillers/cycle across factories per day. May
  be too punishing.
  - Counter: cap Drag stack at 1 per player per factory, or scale
    Drag with the Neptunium gap (small gap → small drag).
- Risk of trivial pick-the-friend behavior: I just Boost my ally
  every day. Mitigation: the 12-hour gift cooldown excludes Boost
  on a current ally, forcing players to spread credits.
- Information cost: the Reveal credit is strong; one Reveal per
  trailing player per day is 4-5 reveals/day in a 6-player game.
  Probably needs to cost 2 credits not 1.

**24h vs 7-day implications.**

- Blitz: credits regenerate every 90 min instead of every 24h. Gap
  threshold drops to 3 kg.
- 7-day: credits regenerate every 24h. Gap threshold 15 kg.
- Spite Fund is *the* most direct catch-up tool of the four;
  in blitz it would dominate the game. Maybe blitz uses only 1
  credit per cycle, while classic uses 3.

**Integration.**

- New `world.spite: { playerId: PlayerId, credits: number,
  resetAt: number }[]`.
- New order types: `SpiteBoost`, `SpiteDrag`, `SpiteReveal`.
- Drag interacts with `factoryProductionFor` (subtract).
- Reveal interacts with `visibility.ts` (temporary fog lift on
  specific outposts).
- Boost interacts with `factoryProductionFor` (add).

**Concrete example.**

> Day 3. Anna leads at 70 kg; Bart 55 kg, Cleo 40 kg (allied with
> Bart vs Anna and Anna's ally Dev). Dev 35 kg, Eve 25 kg.
>
> Bart, Cleo, Eve all qualify for credits (Anna > +15 over them).
> Dev does not (gap < 15). This is already informative: Bart and Dev
> were both seen as "Anna's allies" but Bart still qualifies because
> Anna is far enough ahead — so Bart is *not in fact* coalesced with
> Anna economically.
>
> Cleo spends 2 credits Boosting Bart and 1 Dragging Anna. Eve
> spends 3 credits Reveal-ing Anna's eastern factory (a sector Eve
> can't otherwise see). Bart spends his 3 credits Boosting himself —
> *wait, he can't, you can't Boost yourself.* Bart spends them on
> Cleo. Now Bart and Cleo are publicly boost-pairing each other,
> Anna is publicly being dragged, Eve has new intel. The information
> the lobby now has — *and the leader has* — is materially richer
> than today's Subterfuge, where none of these signals exist.

---

## 5. Recommendation

**Ship 4A (Stagnation Tax) as the funding redesign, layered with the
small overlays from §6.** Reasoning:

1. **Smallest change to player mental model.** Funding already
   exists, players already understand it as a leader → trailing
   transfer. Redesigning it to *force* the transfer (rather than
   permit it) is one step from the status quo, not three.
2. **Highest design-principle score.** Stagnation Tax pays principles
   1 (expensive), 2 (anti-ally filter), 3 (public funding state), 4
   (4-hour half-life), 6 (scales cleanly), 7 (deterministic).
   Coalition Bond (4B) and Spite Fund (4D) tie on 2-3 of these but
   add more new surface area. Shadow Market (4C) is the most
   interesting but the heaviest lift, and most exposes us to the
   "neutral market outpost" world-gen change.
3. **Composes with overlays.** Stagnation Tax is leader-side; the
   small overlays in §6 are trailing-side. Together they're the
   leader-tax + trailing-bonus pair that catch-up theory recommends
   ([Joseph Z Chen — Catch Me If You Can](https://medium.com/@fantastic.factories/catch-me-if-you-can-the-runaway-leader-and-catch-up-mechanics-53f0356c440d);
   [Thoughtful Gamer Cat. 1 + 3](https://thethoughtfulgamer.com/2017/03/28/catch-up-mechanisms/)).
4. **Failure mode is "funding is unused" not "funding breaks the
   game."** If Stagnation Tax doesn't fire often, we lose the
   feature but keep the rest of the sim. If Spite Fund or Coalition
   Bond mis-tune, the leader either gets dogpiled into uselessness
   or the alliance becomes a permanent tax shelter. Reversibility
   matters when the rule lives in a multiplayer rule set.

If we have appetite for two systems, **layer Coalition Bond (4B) on
top** at a later phase — the two compose well (Bond defines who's
allied; Stagnation Tax decides where surplus flows; the
12h-gift-filter in 4A becomes the bond filter from 4B).

**Don't ship Shadow Market.** Too heavy for the value. Revisit if
the auction mechanic finds a home elsewhere in the sim (e.g. as a
specialist hire market).

**Don't ship Spite Fund as the primary funding redesign.** It's
interesting but it changes *what funding is* too completely — it's
no longer funding, it's spite. Possibly worth shipping as a small
isolated subsystem (`docs/16b_spite_credits.md`) at a later phase,
but not as the answer to the funding-redesign question.

---

## 6. Small additive overlays (independent of 4A choice)

Five lightweight mechanics that should ship alongside whatever
direction we choose. Each is one-day-of-work and reversible.

1. **Most-Attacked Bounty.** The player who has lost the most
   drillers to incoming combat over the last 24h is publicly marked
   "Besieged." Besieged players' factories produce +1 driller/cycle
   for 24h. Auto-resolves in `tick.ts`. *Counters*: gang-up on a
   single player no longer pays off as cleanly. *Source-of-truth*:
   tracks combat outcomes already in `combat.ts`.
2. **Reputation Trail.** Every betrayal of a gift / funding promise
   (defined narrowly: receiving N gift drillers from X and then
   capturing X's outpost within 24h) leaves a *public* notation on
   the player record visible across matches in the same hub. Modeled
   on Carmel's reputational-cost framing
   ([docs/13 §2.5](./13_player_feedback_postmortem.md);
   [Game Developer — designing a week-long game](https://www.gamedeveloper.com/design/-i-subterfuge-i-designing-a-strategy-game-that-takes-a-week-to-play)).
   *Counters*: makes alliance betrayal cheaper to detect, expensive
   to repeat. *Risk*: needs a hub-level data store outside the per-
   game sim. `[inference]`
3. **Diplomatic Pulse.** Once per game-day, every player can submit
   one "Pulse Vote" — a public, signed expression of which player
   they think most threatens lobby balance. The current top-voted
   player loses 2 sub-cargo capacity (their next sub from each
   outpost carries 2 fewer drillers) for 24h. Borrows from Civ VI
   World Congress ([Civ Wiki](https://civilization.fandom.com/wiki/World_Congress_(Civ6)))
   and Catan's Largest Army "you're a target" social mechanic
   ([Catan FAQ](https://www.catan.com/faq/basegame)). *Counters*:
   provides a structured way for the lobby to act collectively
   without forming a formal alliance.
4. **Leader-Tax Mining Cycle.** The Neptunium leader's mines
   produce 5% less per tick *while* they hold the lead. Self-
   cancels once they're overtaken. Borrows from Power Grid's
   reverse turn order ([Games Precipice — Power Grid](https://www.gamesprecipice.com/powergrid/)).
   *Counters*: the lead is harder to extend than to defend.
   *Tradeoff*: feels punitive to good play. Could limit to "≥ 20kg
   ahead of #2."
5. **Eliminated-Player Bounty.** When a player is eliminated, their
   remaining Neptunium total is split as a one-time pot to all
   *non-leader* survivors. Borrows from Diplomacy's draw-size
   scoring philosophy of rewarding survival over maximalism
   ([BrotherBored](https://brotherbored.com/why-players-prefer-draw-size-scoring-in-diplomacy/)).
   *Counters*: eliminating a coalition partner is no longer a clean
   win for the leader who eliminated them. *Risk*: encourages the
   trailing players to *survive* rather than press attacks, which
   could deaden the endgame. Probably wants to cap the pot at 10 kg
   total.

These overlays are independent: shipping any 2-3 should be safe.
Shipping all 5 *and* a funding redesign is probably too much load on
the player.

---

## 7. Open questions for playtest

Things we cannot answer from theory. Each requires real games.

1. **Does Stagnation Tax actually force defection?** Plausibility
   ranges from "yes, completely" to "leaders just always fund their
   ally, eat the 12h-cooldown, and we've added a chore." We don't
   know until we see human play.
2. **Is the 4-hour window too long or too short?** 4h means players
   pick recipients while sober/awake; 30min would force decisions
   while AFK or rushed. Probably 4h is right but the only
   evidence is intuition.
3. **What is the "right" target gini coefficient of Neptunium
   distribution at end-of-game?** Today: very unequal (winner has
   200+, loser often has 0). With Stagnation Tax: less unequal. Is
   that a feature or a bug? Carmel's writing suggests the *game*
   should still have a clean winner; the *experience* of trailing
   players should be that they had agency. These pull in different
   directions.
4. **Does the public-visibility part actually destabilise
   coalitions, or do players just accept the funding flow as part of
   the bargain ("yeah Anna's gonna fund Dev, whatever, we agreed")?**
   The whole premise depends on funding flow being socially
   embarrassing. If the meta-game absorbs it, the mechanic is
   inert. `[inference]` — this is the highest-risk hypothesis in the
   doc.
5. **24h blitz threshold tuning is mostly guesswork.** Blitz hasn't
   been built yet (Phase 5+); the 4 kg gap threshold in §4A.B and
   the 3 kg gap in §4D are placeholders.
6. **Interaction with the King specialist
   ([docs/13 §2.6](./13_player_feedback_postmortem.md), [docs/05
   §King](./05_specialists.md)).** The King's combat-modifier
   compounding is already a coalition-amplifier. Any funding
   redesign should be tested *with and without King* — possibly
   gated by the King rebalance the postmortem already commits us to.
7. **Multi-accounting interaction.** Stagnation Tax routes Neptunium
   to non-allied recipients. A multi-account player has at minimum
   one "non-ally" who is themselves. The 12h-gift filter catches
   simple cases but a sophisticated cheater rotates accounts.
   `[inference]` — funding-redesign cannot solve multi-accounting,
   but should not make it strictly worse.

---

## Source list

Subterfuge-specific:

- [Designing Subterfuge — Gaming the Game](https://blog.subterfuge-game.com/post/112147930751/gaming-the-game) (search-excerpt access; 403 on direct fetch)
- [Subterfuge fandom wiki — Funding](https://subterfuge.fandom.com/wiki/Funding)
- [Subterfuge fandom wiki — Rulebook](https://play.subterfuge-game.com/docs/Rulebook/)
- [Game Developer — Designing a strategy game that takes a week to play (Carmel)](https://www.gamedeveloper.com/design/-i-subterfuge-i-designing-a-strategy-game-that-takes-a-week-to-play)
- [Game Developer — A brawl and a race](https://www.gamedeveloper.com/design/-a-brawl-and-a-race-designing-for-the-long-game-in-i-subterfuge-i-)
- [docs/13 — Player feedback postmortem](./13_player_feedback_postmortem.md)

Genre and design theory:

- [Wikipedia — Kingmaker scenario](https://en.wikipedia.org/wiki/Kingmaker_scenario)
- [Skeleton Code Machine — Is kingmaking a problem to be solved?](https://www.skeletoncodemachine.com/p/kingmaking)
- [Thoughtful Gamer — Catch-Up Mechanisms](https://thethoughtfulgamer.com/2017/03/28/catch-up-mechanisms/)
- [Joseph Z Chen — Catch Me If You Can](https://medium.com/@fantastic.factories/catch-me-if-you-can-the-runaway-leader-and-catch-up-mechanics-53f0356c440d)
- [Games Precipice — Positional Balance](https://www.gamesprecipice.com/positional-balance/)
- [Games Precipice — Power Grid analysis](https://www.gamesprecipice.com/powergrid/)
- [BrotherBored — Draw-Size Scoring in Diplomacy](https://brotherbored.com/why-players-prefer-draw-size-scoring-in-diplomacy/)
- [Civ Wiki — World Congress (Civ6)](https://civilization.fandom.com/wiki/World_Congress_(Civ6))
- [Catan FAQ](https://www.catan.com/faq/basegame); [Alex Cates — Largest Army / Longest Road](https://www.alexcates.com/post/catan-breakdown-longest-road-and-largest-army)
- [EVE Online — Equinox Sovereignty Transition](https://www.eveonline.com/news/view/sovereignty-structures-and-transition); [Lapsed Upkeep Payments Remap Sovereignty](https://www.eveonline.com/news/view/lapsed-upkeep-payments-remap-null-sec-sovereignty)
- [CK3 — Faction guide (gamerant)](https://gamerant.com/crusader-kings-3-how-to-handle-factions-guide/)
- [Junta rulebook PDF](https://www.alderac.com/wp-content/uploads/2015/04/Junta_rulebook-1.pdf); [Junta — TVTropes](https://tvtropes.org/pmwiki/pmwiki.php/TabletopGame/Junta)
- [BGDF — Kingmaking common problem](https://www.bgdf.com/forum/archive/archive-game-creation/topics-game-design/tigd-kingmaking-common-problem-2)
- [3DTotal Games — Paradox of Catch Up Mechanics](https://www.3dtotalgames.com/the-paradox-of-catch-up-mechanics/)
