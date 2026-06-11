# 13. Subterfuge (2015) — Player Feedback & Postmortem

*Research compiled May 2026. Sources are primarily Ron Carmel / Noel Llopis dev posts on Game Developer (ex-Gamasutra), the official "Designing Subterfuge" blog, App Store reviews, the Subterfuge community forums, a couple of community-written Medium stats deep-dives, and press reviews (Pocket Gamer, TouchArcade, GameGrin, Hundstrasse, Cult of Mac, MCV/Develop).*

*r/subterfuge and direct Reddit fetches were blocked from this research session — claims that would normally come from Reddit are noted as `[limited evidence]` and substituted with the closest equivalent (forum threads, App Store reviews, community Medium posts). Discord and Twitter content was not accessible in this session.*

---

## 1. Executive summary — why Subterfuge never grew

In rough order of impact:

1. **The 7-day match length is the game.** It's also the largest single retention killer. Reviewers across the board (Pocket Gamer, TouchArcade, GameGrin, Hundstrasse, App Store reviewers, the only community stats post we found) say the same thing in different ways: a single game is a week-long psychological commitment, and after one game most players don't start another. The community-side data shows ~10 new users/day in year 2 but "users tend to play a few games then drop off" ([Freeman, Medium, 2017](https://medium.com/@alexjf12/subterfuge-by-the-numbers-8a8f2b907dc2)).
2. **A single disengaged player ruins everyone else's game.** This is the most frequently cited gameplay complaint in reviews. "A busy 12 hours or a player losing interest can totally ruin your game… one player maintaining an isolationist stance or refusing to negotiate creates a roadblock" ([Pocket Gamer](https://www.pocketgamer.com/articles/067942/subterfuge-a-beautifully-designed-life-ruiner/)).
3. **It damaged friendships and burned players out emotionally, not just temporally.** Reviewers warned readers off ("Maybe not", "prepare to irreparably damage those friendships forever" — Pocket Gamer). Carmel himself acknowledged: "the things that make them intense and interesting are also the things that make them infuriating" ([Game Developer, "Designing a strategy game that takes a week to play"](https://www.gamedeveloper.com/design/-i-subterfuge-i-designing-a-strategy-game-that-takes-a-week-to-play)).
4. **The genre doesn't make money and Carmel knew it going in.** "Games in this genre don't make a lot of money — at least, I don't know of one that has… whether it's a good business choice, that's questionable" ([MCV/Develop](https://mcvuk.com/development-news/we-wanted-to-minimise-the-number-of-times-per-day-a-player-has-to-check-in/)). After three weeks the game had 220k installs and $23k of revenue (Wikipedia). At ~$0.10 ARPU on a game that needed years of live-ops, dev investment dried up.
5. **King-stacking made high-level play feel one-dimensional.** Community complaints concentrated on the **King** specialist: "in a tournament final there were 8 kings in the game and the results of every battle hinged on how many kings one player had" ([forum thread: "please NERF the king"](http://forums.subterfuge-game.com/viewtopic.php?f=5&t=1463) — title and quote surfaced via search, the forum itself was intermittently down during this research).
6. **Multi-accounting / "wolf-packing" was a known unsolved problem.** Carmel publicly acknowledged this in 2015 ("known and being worked out", paraphrased from the Pocket Gamer "life ruiner" piece) and the forum had an active "Cheating" thread proposing IP/device flagging. There is no evidence it was ever fully solved.
7. **The game went into long-term maintenance and was effectively abandoned until 2023.** Wikipedia: "after a long period of inactivity from the developers, Subterfuge was acquired by the indie game development company Game Shovel" in 2023. App-store reviewers had been complaining about this for years before then — "Devs have seem to completely moved on… this game may be one of the best games I've played on Mobile only to be killed by its under development and lack of updates" ([App Store review, 2020](https://apps.apple.com/us/app/subterfuge/id702951905)).

---

## 2. Complaints by category

### 2.1 Time commitment / pacing

- "A game of Subterfuge lasts for seven to 10 days" by deliberate design ([Cult of Mac](https://www.cultofmac.com/news/subterfuge-mobile-game)).
- "The times take way too long. Each game is expected to last a week long, they should shorten it to 3-5 days." — App Store user Reyjr77, 2017 ([App Store](https://apps.apple.com/us/app/subterfuge/id702951905)).
- "Games take so long to have an outcome it becomes a chore to play the game rather than it being any fun." — App Store user magic00, 2020 ([App Store](https://apps.apple.com/us/app/subterfuge/id702951905)).
- "Even travelling short distances… takes many hours" ([Hundstrasse, 2016](https://hundstrasse.com/2016/03/24/subterfugesub-stantial-mobile-gaming/)).
- The TouchArcade play-diary describes powerlessness during the slow segments: "You can see failure coming from a mile off… exact moment you will lose" visible far in advance ([Game Developer, "10 days with the deep-sea bluffing game Subterfuge"](https://www.gamedeveloper.com/business/10-days-with-the-deep-sea-bluffing-game-i-subterfuge-i-)).
- Carmel himself: "Any less and we would get the potential for epic plot twists, and any more and the game would get too intense" — i.e. the 6–9 day length is a forced compromise, not a found optimum ([MCV/Develop](https://mcvuk.com/development-news/we-wanted-to-minimise-the-number-of-times-per-day-a-player-has-to-check-in/)).

### 2.2 The game is psychologically expensive

- "This game will ruin your life… I set an alarm for 2am" ([Pocket Gamer, "A beautifully designed life ruiner"](https://www.pocketgamer.com/articles/067942/subterfuge-a-beautifully-designed-life-ruiner/)).
- "A nervous nine hour blackout" during international travel; players at social events "desperately sending orders with their heads in their hands" (same).
- "Paranoia that everyone else in the game is gathering arms against you slowly seeping into daily life" (same).
- Despite a glowing tone, the reviewer answered "Maybe not" when asked if they'd recommend it.
- "Subterfuge accounts for 37 percent of my battery usage in the last 7 hours" ([Game Developer 10-day diary](https://www.gamedeveloper.com/business/10-days-with-the-deep-sea-bluffing-game-i-subterfuge-i-)).
- "The main problem of the game is that it's overwhelming, takes up a lot of your free time, and makes you want to check your phone and/or tablet at 3 am" ([Medium review](https://medium.com/@mareviews/game-review-subterfuge-ios-android-be09062c8d54)).

### 2.3 Dependency on other players being engaged

- "Subterfuge requires full buy in from those that play it — a busy 12 hours or a player losing interest can totally ruin your game" ([Pocket Gamer](https://www.pocketgamer.com/articles/067942/subterfuge-a-beautifully-designed-life-ruiner/)).
- "Two players holding back can force an entire game to fall apart" (same).
- "The game doesn't seem balanced for players that aren't playing to win" (same).
- The 10-day diary opens with another player ("Frosty") quitting within hours — and the rest of the game has to wear the hole that leaves ([Game Developer](https://www.gamedeveloper.com/business/10-days-with-the-deep-sea-bluffing-game-i-subterfuge-i-)).

### 2.4 Eliminations and inability to quit

- "Quitting would mess up the game for everyone else, forcing continued participation despite despair" ([Game Developer 10-day diary](https://www.gamedeveloper.com/business/10-days-with-the-deep-sea-bluffing-game-i-subterfuge-i-)). I.e. the social contract that prevents rage-quits also locks losing players in for days.
- Carmel's own framing of why specialists exist is that they were designed to **prevent** the game collapsing into a pure social-deduction elimination loop: specialists "break and change the rules" every 18 hours so individual play matters beyond social manipulation ([Game Developer, "A brawl and a race"](https://www.gamedeveloper.com/design/-a-brawl-and-a-race-designing-for-the-long-game-in-i-subterfuge-i-)). The fact that they had to engineer around it confirms the worry was real.
- `[limited evidence]` Direct first-person "I got eliminated on day 2 and had to watch for 5 days" testimony from Reddit was not retrievable in this session — but the App Store and reviewer accounts (Cult of Mac: reviewer "completely eliminated within a couple of days in each match", described as "frustrating and incredibly compelling") corroborate that early elimination was common and uncushioned.

### 2.5 Kingmaking, alliances, social engineering > tactics

- Carmel (the designer) explicitly: "Political games have a bunch of very difficult design problems inherent in their nature… social engineering tends to completely override tactics and strategy… king-making scenarios where certain players gain disproportionate influence… time-investment imbalance: Players gain unfair advantages simply by investing more hours" ([Game Developer, "Designing a strategy game that takes a week to play"](https://www.gamedeveloper.com/design/-i-subterfuge-i-designing-a-strategy-game-that-takes-a-week-to-play)).
- 10-day diary, Day 10: "Despite becoming one of the most powerful players, the author remained entirely powerless to stop him (Mythos), illustrating how social dynamics ultimately override raw resources" ([Game Developer](https://www.gamedeveloper.com/business/10-days-with-the-deep-sea-bluffing-game-i-subterfuge-i-)).
- App Store: "only 1 person may win at a time. This means you MUST break your diplomacy at some point" — magic00, 2020 ([App Store](https://apps.apple.com/us/app/subterfuge/id702951905)). The single-winner victory condition is identified as the root cause of forced betrayal.
- The same reviewer asked for "team battles and multi-winner options" — i.e. wanted teams/coalitions as a structural fix to forced betrayal.

### 2.6 Specialist balance — the King problem

- Forum thread "please NERF the king" — community consensus that the King specialist (which destroys 1 enemy driller per 4 of player's drillers in combat, globally) is overpowered, especially when stacked ([forums.subterfuge-game.com t=1463](http://forums.subterfuge-game.com/viewtopic.php?f=5&t=1463); intermittently reachable).
- Top-level argument from search excerpts: "in a tournament final there were 8 kings in the game and the results of every battle hinged on how many kings one player had."
- Proposed fixes from the community: diminishing returns on multiple Kings, a "Duke / Prince" local-effect alternative, weaker per-King ratio.
- This was a **balance** complaint that explicitly fed back into the **diversity** complaint: "the overpowered King is seen as discouraging the use of other specialists that could make for more interesting and innovative games."

### 2.7 Multi-accounting / wolf-packing / collusion

- Carmel publicly acknowledged "wolf-packing"/multiboxing as a known unresolved issue ([Pocket Gamer "life ruiner" recap](https://www.pocketgamer.com/articles/067942/subterfuge-a-beautifully-designed-life-ruiner/)).
- Forum thread "Cheating" ([forums.subterfuge-game.com f=10 t=354](http://forums.subterfuge-game.com/viewtopic.php?f=10&t=354)) — players proposed IP / device-ID flagging and gift-volume anomaly detection. Forum was down during this fetch; existence of the thread + search excerpt confirmed.
- October 2017 stats author flags a player ("tirtoiduchm1 finished 20 games … 212 rating points") with explicit skepticism about legitimacy ([Medium "State of the Sub October 2017"](https://medium.com/@alexjf12/state-of-the-sub-october-2017-553418eb57af)) — i.e. the community had visible suspected cheaters with no detection system.

### 2.8 Monetization complaints

- Original model: pay-per-game-pass. They pivoted to f2p with $10 unlock for unlimited concurrent games, ranked, private games, unlimited future orders, private notes ([TouchArcade monetization piece — accessible only via search excerpts](https://toucharcade.com/2015/07/07/subterfuge-monetization)).
- Free players capped at **4 scheduled future orders** — this matches the f2p limit you've already encoded in the rebuild's sim/docs.
- Negative Metacritic user review: "This is an average game definitely not a 10, and the micro transactions make the game less enjoyable" (Fad, 6/10) ([Metacritic](https://www.metacritic.com/game/subterfuge/)).
- GameGrin: "A USD $9.99 in-app purchase is required to unlock key features including the ability to play multiple games simultaneously, access ranked matches, create private games, and issue more than 4 commands per turn" ([GameGrin](https://www.gamegrin.com/reviews/subterfuge-review/)).
- Medium reviewer "felt compelled to purchase the full version for better gameplay experience" ([Hundstrasse](https://hundstrasse.com/2016/03/24/subterfugesub-stantial-mobile-gaming/)).
- Carmel's own assessment: the genre fundamentally doesn't monetize. "Games in this genre don't make a lot of money – at least, I don't know of one that has" ([MCV/Develop](https://mcvuk.com/development-news/we-wanted-to-minimise-the-number-of-times-per-day-a-player-has-to-check-in/)).

### 2.9 Player counts, retention, churn (the only hard numbers we have)

From [Alex Freeman, "Subterfuge by the Numbers" (Medium, 2017)](https://medium.com/@alexjf12/subterfuge-by-the-numbers-8a8f2b907dc2):

- 7,712 total registered players as of Jan 2017 (15 months post-launch).
- Acquisition: "around 10 users joining per day in the past year."
- "Users tend to play a few games then drop off."
- "After the initial boom of downloads, there hasn't been another sharp rise and users tend to not play multiple games."
- Skill plateau: "25 games appears optimal for rating improvement; minimal learning gains beyond this threshold" — i.e. competitive depth caps out early.

From [Alex Freeman, "State of the Sub: October 2017" (Medium)](https://medium.com/@alexjf12/state-of-the-sub-october-2017-553418eb57af):

- 9,100+ registered players by Oct 2017.
- **Only 620 players finished a game in October 2017.** That's roughly 6–7% monthly active relative to lifetime registrations, two years post-launch.
- 224 Masters (1500+ rating) at month start, 232 at month end — the competitive top ~2%.

From [Wikipedia](https://en.wikipedia.org/wiki/Subterfuge_(video_game)):

- Three-week launch: 113k Android installs + 107k iOS installs = ~220k installs, **$23k revenue.** ARPU ≈ $0.10.

From [Carmel's own retention post on Game Developer](https://www.gamedeveloper.com/business/player-retention-for-a-week-long-game-subterfuge-):

- Top engaged players: RickA (35 games), ShadowDragonz (33), EricAnderson (26).
- Carmel's stated stance: "Those who love it will happily stick around and those who don't are better off not playing" — i.e. he explicitly chose **not** to chase the leaky-bucket fixes.

### 2.10 Onboarding / learning curve

- "The learning curve can be tough, but the game has a robust tutorial system in form of puzzles, videos explaining the intricacies of the game and a manual" — but the same review notes the tutorial puzzles "function very well as a scaling guide to getting into and out of tricky situations, but not very well at all as an introduction to the game" ([Nevada Dru review](https://nevadadru.wordpress.com/2017/03/28/subterfuge-review/) via search excerpt).
- Cult of Mac reviewer "fail[ed] miserably" in first matches; "gets easier with each match" ([Cult of Mac](https://www.cultofmac.com/news/subterfuge-mobile-game)).
- The structural problem: in a 7-day game, "learn by playing" means a week of frustration per attempt.

### 2.11 Mobile UX / technical issues

- GameGrin specifically: "graphical glitches" and "the chatbox… goes beyond the screen's upper bounds and become uncloseable" ([GameGrin](https://www.gamegrin.com/reviews/subterfuge-review/)).
- Battery drain at the level of "37% of battery usage in the last 7 hours" while in active play ([Game Developer 10-day diary](https://www.gamedeveloper.com/business/10-days-with-the-deep-sea-bluffing-game-i-subterfuge-i-)).
- `[limited evidence]` Direct UX complaints (touch hit-areas, viewport, notification fatigue) were not surfaced in the sources we could fetch. The few accessible reviews praise the UI as "clean" and "slick" — UX appears to have been a relative strength.

### 2.12 Dead game / abandonment / sunset

- App Store, 2020 (magic00): "Devs have seem to completely moved on… none of my friends play it any more" ([App Store](https://apps.apple.com/us/app/subterfuge/id702951905)).
- Forum thread "The end of an era…" ([forums.subterfuge-game.com f=4 t=3050](http://forums.subterfuge-game.com/viewtopic.php?f=4&t=3050)) — title surfaced via search but the forum was down during this fetch attempt. Search excerpt confirms an October server shutdown / delisting announcement, prior to the 2023 Game Shovel acquisition.
- [Wikipedia](https://en.wikipedia.org/wiki/Subterfuge_(video_game)): "After prolonged inactivity, indie developer Game Shovel acquired the title in 2023 for continued support. They released an Android update to meet modern app standards, effectively reviving access for many players."
- Carmel's stated philosophy not to chase mass-market retention ([Game Developer](https://www.gamedeveloper.com/business/player-retention-for-a-week-long-game-subterfuge-)) is consistent with eventual ramp-down.

### 2.13 Communication primitives

- Text-only by deliberate design. Carmel rejected voice/video/screenshots: "The game is a lot more interesting when you can't do that… restricting communication to this relatively limited medium of text reinforces this feeling that things may not be as you think" ([Game Developer / Cult of Mac](https://www.cultofmac.com/news/subterfuge-mobile-game)).
- Some players "did request formalized alliances", which designers rejected to keep the game from collapsing into pure social deduction ([Game Developer, "A brawl and a race"](https://www.gamedeveloper.com/design/-a-brawl-and-a-race-designing-for-the-long-game-in-i-subterfuge-i-)).
- App Store: "formal alliance system with public/secret options for better coordination" — direct community request to overturn this design decision (Reyjr77, [App Store](https://apps.apple.com/us/app/subterfuge/id702951905)).

---

## 3. What worked — the cult-following half

Worth preserving in the rebuild:

- **The "respect the player's time" design pillar** — auto-completion of low-level analysis, predictive UI, advance orders (Time Machine). Praised universally. Carmel: "If a feature would result in players gaining an advantage by obsessively checking the game every five minutes, we cut it" (Noel Llopis, [Cult of Mac](https://www.cultofmac.com/news/subterfuge-mobile-game)).
- **Time Machine specifically** — every play diary calls it out as the standout mechanic. "Allowing players to see combat outcomes before they occurred" ([Game Developer 10-day diary](https://www.gamedeveloper.com/business/10-days-with-the-deep-sea-bluffing-game-i-subterfuge-i-)).
- **Visual / UI clarity** — "clean user interface and slick touch controls" (Pocket Gamer).
- **Emergent social play** — "I've spent the week messaging strangers, and in a weird way… I'm going to miss them" (Hundstrasse). Day-6 epiphany in the 10-day diary: "this is the day which I realized how to play Subterfuge" — the moment players "get it" is reportedly transcendent.
- **Mining-vs-military duality** — Carmel's blog explicitly designed multiple win paths ([Designing Subterfuge: Balancing Different Paths to Victory](https://blog.subterfuge-game.com/post/107423560776/balancing-different-paths-to-victory)). Reviewers report this duality works.
- **Specialists as rule-breakers** — "every 18 hours" pacing and specialists that "break and change the rules" were widely praised, even though the King in particular was over-tuned.
- **No alliances by design** — reviewers and Carmel both note that informal-only alliances kept the game from collapsing into pure social deduction; the community ask to add formal alliances was probably correctly rejected on those grounds.
- **Pocket Tactics Best Multiplayer Game of 2015.** TouchArcade 100/100. Metacritic critic score 81, user score 7.9.
- **The cult-following is genuine.** RickA played 35 games; 80+ accounts played 45+ games (Freeman 2017). For ~1% of installs, the game became a years-long ritual.

---

## 4. Dev decisions in hindsight (what Carmel said publicly)

- **He explicitly didn't believe the game would be commercially significant.** "Games in this genre don't make a lot of money — at least, I don't know of one that has… whether it's a good business choice, that's questionable" ([MCV/Develop](https://mcvuk.com/development-news/we-wanted-to-minimise-the-number-of-times-per-day-a-player-has-to-check-in/)).
- **He explicitly chose not to optimize the retention curve.** "Those who love it will happily stick around and those who don't are better off not playing… we're aiming to please those who love it" ([Game Developer retention post](https://www.gamedeveloper.com/business/player-retention-for-a-week-long-game-subterfuge-)).
- **Multiple monetization pivots.** Initial pay-per-pass → free-with-$10-unlock → exploration of video-ad time-machine boosts, "patron badges", paid tournaments ([TouchArcade monetization piece](https://toucharcade.com/2015/07/07/subterfuge-monetization)). Each pivot was framed as "reducing friction on new players" — i.e. the bottleneck was acquisition, not conversion.
- **Acknowledged the wolf-packing/multi-accounting problem early and never publicly solved it.**
- **Acknowledged the inherent infuriating-ness of political games.** "The things that make them intense and interesting are also the things that make them infuriating."
- **Effectively walked away after 2017–2018.** No major announcements; servers ran for years on autopilot until inactivity caught up and Google Play standards eventually required an update. Game Shovel acquired and revived in 2023.
- **Post-Subterfuge:** Carmel did not start another live-ops game. Indie-Fund commitments and (per LinkedIn / MobyGames listings) limited involvement in other projects. He never publicly framed Subterfuge as a failure — but he also never iterated on the formula.

---

## 5. Implications for a 2026 rebuild

What follows is my synthesis, not sourced — flagged as `[inference]`.

1. **The single-winner victory condition is the root cause of forced betrayal, which is the root cause of "this game ruined my friendships."** `[inference]` A rebuild should at minimum offer **co-victory / team-victory modes** as first-class. magic00's App Store review asking for this is the single most actionable piece of player feedback in the entire dataset. The "pure" single-winner mode can remain for ranked/competitive, but the default ("play with your friends") mode should not punish friendship.

2. **The 7-day match is sacred to the cult but is the #1 retention killer for everyone else.** `[inference]` A rebuild should support **multiple match-length presets** as first-class (e.g. 24-hour blitz, 3-day, 7-day classic). Carmel deliberately rejected this because he thought epic plot twists need a week. He was right about the plot twists — but the data says players completed a game and didn't come back. 24-hour matches give people a way to re-enter without committing a week of their psyche.

3. **A single AFK / disengaged player collapses everyone else's match.** `[inference]` This is structural. Mitigations: (a) AI takeover after N hours of inactivity that plays the player's stated policy, (b) "graceful surrender" / replacement-from-queue, (c) smaller default match sizes (4P over 10P) so one quitter is a smaller fraction.

4. **Eliminated players sit out 4+ days.** `[inference]` Give them something to do — spectator mode with chat, kingmaker role, betting/prediction mini-game, automatic enrollment in a fresh match. Carmel's specialist system was designed to *prevent* eliminations but couldn't prevent them entirely.

5. **King-stacking shows specialist balance is a perpetual live-ops cost.** `[inference]` A rebuild needs **server-side specialist tuning** without app updates, *and* an explicit principle that no specialist's effect scales linearly when multiple copies are stacked. The original Subterfuge had global-effect specialists that compounded — local-effect alternatives ("Duke / Prince" community proposal) are a safer default.

6. **Wolf-packing / multi-accounting is unsolvable with passive mechanics in a small-population diplomacy game.** `[inference]` Either accept it as a fact of life (ranked vs unranked split — ranked requires phone verification, payment, or social-graph anchor) or move toward private/league/club-based matchmaking where reputation accrues.

7. **The genre does not pay for years of live-ops via mobile microtransactions.** `[inference]` Subterfuge proved this at 220k installs / $23k. Plausible rebuilds: paid app + cosmetic micro, or subscription-based (Discord/community-backed), or league/tournament-fee model. Free-to-play with a $10 unlock didn't work and there is no reason to believe it will work in 2026.

8. **The Time Machine is the design crown jewel.** `[inference]` Keep it. Make it more powerful (longer projection horizon, more queued orders for free), since the free-tier cap of 4 future orders was identified as a friction point in multiple reviews.

9. **Onboarding has to assume players will not survive their first match.** `[inference]` 7-day matches mean "learn by playing" = "learn by losing for a week, then leaving". Need: bot-only practice matches that compress to 30 minutes; mid-match coaching ("you're about to be eliminated — here's what to do"); the puzzle-tutorials were good but didn't substitute for live mentorship.

10. **The cult exists and will return.** `[inference]` RickA, ShadowDragonz, EricAnderson and the 80 accounts with 45+ games are evidence that there's a real audience. They're a tiny audience. Build for them first and design discovery / matchmaking on the assumption that a 9PM EST match queue has 12 players in it, not 12,000.

---

## Source list (consolidated)

Primary dev sources:
- [Game Developer — "Player Retention for a Week Long Game (Subterfuge)" (Carmel)](https://www.gamedeveloper.com/business/player-retention-for-a-week-long-game-subterfuge-)
- [Game Developer — "Designing a strategy game that takes a week to play"](https://www.gamedeveloper.com/design/-i-subterfuge-i-designing-a-strategy-game-that-takes-a-week-to-play)
- [Game Developer — "A brawl and a race: Designing for the long game in Subterfuge"](https://www.gamedeveloper.com/design/-a-brawl-and-a-race-designing-for-the-long-game-in-i-subterfuge-i-)
- [Game Developer — "10 days with the deep-sea bluffing game Subterfuge"](https://www.gamedeveloper.com/business/10-days-with-the-deep-sea-bluffing-game-i-subterfuge-i-)
- [MCV/Develop — "We wanted to minimise the number of times per day a player has to check in"](https://mcvuk.com/development-news/we-wanted-to-minimise-the-number-of-times-per-day-a-player-has-to-check-in/)
- [TouchArcade — "How Will Subterfuge Monetize?"](https://toucharcade.com/2015/07/07/subterfuge-monetization) *(403 on direct fetch, content surfaced via search excerpts)*
- [Designing Subterfuge blog — index](https://blog.subterfuge-game.com/) *(403 on direct fetch)*
- [Cult of Mac — "Innovative mobile game will get you stabbing buddies in the back"](https://www.cultofmac.com/news/subterfuge-mobile-game)

Press reviews:
- [TouchArcade review](https://toucharcade.com/2015/10/15/subterfuge-review/) *(403 on direct fetch)*
- [Pocket Gamer review — "A beautifully designed life ruiner"](https://www.pocketgamer.com/articles/067942/subterfuge-a-beautifully-designed-life-ruiner/)
- [Pocket Gamer review (alternate URL)](https://www.pocketgamer.com/subterfuge/review/)
- [GameGrin review](https://www.gamegrin.com/reviews/subterfuge-review/)
- [Hundstrasse review](https://hundstrasse.com/2016/03/24/subterfugesub-stantial-mobile-gaming/)
- [Nevada Dru review](https://nevadadru.wordpress.com/2017/03/28/subterfuge-review/)
- [Medium / Micro App Reviews](https://medium.com/@mareviews/game-review-subterfuge-ios-android-be09062c8d54)
- [Metacritic page](https://www.metacritic.com/game/subterfuge/)
- [Wikipedia — Subterfuge (video game)](https://en.wikipedia.org/wiki/Subterfuge_(video_game))

Community data:
- [Alex Freeman — "Subterfuge by the Numbers" (Medium, 2017)](https://medium.com/@alexjf12/subterfuge-by-the-numbers-8a8f2b907dc2)
- [Alex Freeman — "State of the Sub: October 2017" (Medium)](https://medium.com/@alexjf12/state-of-the-sub-october-2017-553418eb57af)

User reviews:
- [App Store (US)](https://apps.apple.com/us/app/subterfuge/id702951905)

Forum threads (intermittently reachable; titles + excerpts via search):
- [Cheating — t=354](http://forums.subterfuge-game.com/viewtopic.php?f=10&t=354)
- [Please NERF the king — t=1463](http://forums.subterfuge-game.com/viewtopic.php?f=5&t=1463)
- [Ron Carmel and Noel Llopis AMA — t=1257](http://forums.subterfuge-game.com/viewtopic.php?f=5&t=1257)
- [The end of an era… (sunset announcement) — t=3050](http://forums.subterfuge-game.com/viewtopic.php?f=4&t=3050)

Sources we could not access in this session:
- r/subterfuge and Reddit search — fetcher blocked.
- Discord communities — not surfaced.
- Twitter/X — surfaced as links only, content not retrievable.
- Google Play reviews — page returned navigation chrome only.
- BoardGameGeek discussions for the *original* mobile game — only the 2023 board-game adaptation came up.
- The "Designing Subterfuge" Tumblr blog (`blog.subterfuge-game.com/post/...`) — all 403'd on direct fetch; only post titles and summaries via search.
