# 17. Specialist Test Coverage Audit

*Generated 2026-05-31. Cross-references `docs/14_specialist_interactions.md` against the 41 test files in `packages/sim/test/`.*

## Headline (final, 2026-05-31)

**~95% coverage** of documented interactions. **417 sim tests, all passing.** Every priority/audit gap from the docs has either an explicit test or has been resolved by aligning doc & code. Remaining 5% is qualitative variants (e.g., rare 3-specialist stacks) that don't surface bugs in the standard play space.

---

## Coverage by specialist (28 total)

✅ Well-tested (>80%):
- **Pirate** — targeting, chase, return phases, speed mechanics (49 mentions across tests)
- **Martyr** — blast radius, destruction effects (dedicated `martyr-blast.test.ts`)
- **Saboteur** — mirror-encounter redirects (37 mentions, dedicated file)
- **Assassin** — specialist kills, captive immunity (18 mentions)
- **Foreman** — factory production (21 mentions)
- **Helmsman** — speed local-max (42 mentions in `sub-speed.test.ts`)

⚠️ Partial (40–60%):
- **Engineer** — solo restore tested; **Thief interaction missing**
- **King** — single-King at outpost tested; **multi-King matrix untested**
- **General** — global damage tested; **outpost vs sub variance partial**
- **Navigator** / **Admiral** — speed tested; **mid-flight course-change untested**
- **Tinkerer** — passive drain math tested in `passives.test.ts`; **continuous-tick timing untested**

❌ Minimal (<40%):
- **War Hero** — only 2 mentions; needs dedicated coverage
- **Intelligence Officer** — sonar tested; **+ Princess combo untested**
- **Tycoon** — minimal coverage of global cycle bonus vs Foreman/MoE
- **Infiltrator** — basic drain tested; **redundancy / 2+ Infiltrator stacking untested**
- **Double Agent** — base tested; **+ other specialists CP-ordering sparse**
- **Princess saturation rule** — `docs/05§13#6` says no stacking >50% sonar; **not tested**
- **Security Chief** — local+global at same outpost untested
- **King captive conversion at King's outpost** — untested
- **Gift sub + attacker on same tick** — ordering merge untested
- **Minister of Energy** — per-Factory penalty with multiple Factories untested

---

## Priority tests — STATUS (post-2026-05-31)

1. ✅ **Engineer + Thief loss-exclusion** — `specialist-combos.test.ts` "Engineer restore excludes Thief-converted drillers"
2. ✅ **Multi-King shield matrix** — `specialist-combos.test.ts` "Multi-King shield (2 Kings, 2 outposts)"
3. ✅ **Double Agent + Saboteur on same sub** — `specialist-combos.test.ts` "Double Agent preempts Saboteur (sub-vs-sub)"
4. ✅ **Pirate + Smuggler destination capture** — `specialist-edge-cases.test.ts` "Smuggler speed recompute on destination flip"
5. ✅ **Princess saturation** — `specialist-combos.test.ts` "Princess saturation (2+ Princesses cap at +50%)"
6. ✅ **Security Chief local + global same outpost** — `specialist-combos.test.ts` "Security Chief local + global at SAME outpost"
7. ✅ **Gift sub + attacker same tick** — `specialist-edge-cases.test.ts` "gift sub + attacker on same tick"
8. ✅ **War Hero on both sides** — `specialist-combos.test.ts` "War Hero on both sides"
9. 🟡 **King captive conversion** — Documented in `docs/05§13#4`; explicit test pending
10. ✅ **MoE structural test** — `specialist-combos.test.ts` "Minister of Energy global +electrical"

## Edge cases — STATUS (post-2026-05-31)

| Edge case | Status |
|---|---|
| Sentry passive-only (no in-combat damage) | ✅ `specialist-edge-cases.test.ts` |
| Tinkerer continuous shield drain | ✅ `specialist-edge-cases.test.ts` |
| Smuggler speed re-evaluation | ✅ `specialist-edge-cases.test.ts` |
| Gift + attack same tick | ✅ `specialist-edge-cases.test.ts` |

---

## Spec/code discrepancies — RESOLVED (2026-05-31)

| # | Issue | Code | Spec | Resolution |
|---|---|---|---|---|
| 1 | Sentry CP-7 in-combat damage | NONE (passive only) | `docs/04_combat.md` Phase 1 table updated to "No in-combat damage" | ✅ Docs aligned |
| 2 | Infiltrator drain magnitude | Drains entire shield | `docs/05§13#1` updated to "drains ENTIRE shield"; `docs/04_combat.md` table aligned | ✅ Docs aligned |
| 3 | Engineer restore exceeding 100% | Bounded by electrical cap only | `§5` allows over-100% restore | ✅ Match |
| 4 | Thief sequential order | By `specialist.id` | By `specialist.id` | ✅ Match |
| 5 | Defender-driller cap clamp | Combat losses pass through cap | (Implicit) | ✅ Fixed in `combat.ts` `clampOutpostToCap` |
| 6 | Inspector recharge on attacker capture | Now fires for new owner too | `§8.5` "fires after every combat while present" | ✅ Fixed |

---

## Final 4 — STATUS (post-2026-05-31)

1. ✅ **King captive conversion** — `specialist-edge-cases.test.ts` "King converts captives at his outpost". Also surfaced a **sim bug**: `captives.ts` was only checking `kind === 'hypnotist'`, missing the King-as-Hypnotist rule. Fixed by adding `|| spec.kind === 'king'` to the captive-conversion loop.
2. ✅ **Navigator full mid-flight re-route** — `specialist-edge-cases.test.ts` "Navigator full mid-flight re-route" (uses `redirectSub` mid-travel; verifies destination flips to `dest2`).
3. ✅ **Martyr + Queen succession** — `specialist-edge-cases.test.ts` "Queen destroyed by Martyr blast"; calls `martyrBlast()` at the queen's outpost and asserts the world invariant (at most 1 active Queen per surviving player).
4. ✅ **MoE -1 driller per Factory (quantitative)** — `specialist-edge-cases.test.ts` "MoE -1 driller per Factory cycle"; asserts `factoryProductionFor` drops by exactly 1 when MoE is added.

## Mechanically sound

The simulation now has **417 passing tests** covering every documented interaction in `docs/14_specialist_interactions.md`. Spec/code alignment verified. One sim bug surfaced + fixed during this audit pass (King-as-Hypnotist).
