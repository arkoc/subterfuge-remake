import type { SpecialistKind } from '@subterfuge/sim';

export interface SpecialistInfo {
  /** Single Unicode glyph that prefixes the specialist name everywhere. */
  glyph: string;
  /** One-line summary that always shows under the name in the chip.
   *  Convention: starts with the combat-priority indicator
   *  (`CP X` / `post-driller` / `post-spec` / `no CP`) so the player
   *  can see at a glance when the specialist fires. */
  short: string;
  /** Multi-line full effect for the expanded view. Plain text — newlines
   *  render as line breaks. Kept concise. */
  long: string;
}

/**
 * Display registry for every specialist kind. Source of truth for icon
 * glyph + tap-to-expand description copy. Effects pulled from
 * `docs/05_specialists.md` so the in-game text matches the spec doc.
 *
 * CP convention used in every entry:
 *   • `CP N` — fires at combat priority N (lower goes first).
 *   • `post-spec` — fires after CP 7 but before the shield phase.
 *   • `post-driller` — fires after the driller phase but before capture.
 *   • `no CP` — does not participate in combat phases at all.
 */
export const SPECIALISTS: Record<SpecialistKind, SpecialistInfo> = {
  queen: {
    glyph: '♛',
    short: 'no CP — royal core. +20 max shield at her outpost. hires periodically.',
    long: "Combat: no CP — does not fire in the specialist phase.\n\nyour founding specialist. +20 max shield charge at her current outpost (electrical-funded). She can ride a sub and the bonus moves with her. Hires a new specialist on a per-player timer (4h base).\n\nIf the Queen dies and you have no Princess, you're eliminated.",
  },
  princess: {
    glyph: '♕',
    short: 'no CP — +50% sonar at her outpost. succeeds queen on death.',
    long: 'Combat: no CP — passive only.\n\n+50% sonar range at her current outpost (no stacking with other Princesses). On the Queen\'s death the nearest Princess promotes to Queen and assumes the +20-shield duty.',
  },

  // --- Combat Phase 1 (CP-prioritised) ---
  martyr: {
    glyph: '✸',
    short: 'CP 1 — detonates, destroying everything in a 0.20-sonar radius.',
    long: 'Combat: CP 1 (first to fire).\n\nWhen in combat, detonates a blast at the encounter centre: every sub and outpost within 20% of standard sonar range is destroyed, friend and foe alike. Specialists inside the radius die outright (no capture). The only counter is "don\'t engage" or another Martyr.',
  },
  revered_elder: {
    glyph: '☥︎',
    short: 'CP 2 — silences all other specialists in this combat.',
    long: "Combat: CP 2.\n\nIf exactly one side has an RE, no other specialist on either side participates in this combat — they're all silenced (Saboteur, Engineer, General, King, etc.). Both sides having an RE cancels the veto. Martyr (CP 1) fires before the RE and is the canonical counter.",
  },
  saboteur: {
    glyph: '↩︎',
    short: 'CP 3 announce / post-driller — sends winning enemy sub home.',
    long: "Combat: CP 3 for priority-of-announcement, but the effect resolves *post-driller*. Sub-vs-sub only.\n\nIf your sub loses (or both die) and the opposing sub survives, that surviving enemy is redirected to its own owner's nearest outpost — sent home, attack neutralised. If your saboteur side wins the drillers it does nothing (no surviving enemy to redirect).",
  },
  thief: {
    glyph: '$',
    short: 'CP 4 — converts 15% of enemy drillers to your side.',
    long: 'Combat: CP 4 (simultaneous with Infiltrator).\n\nSteals ceil(15% × enemy drillers) to your side. Stacked Thieves apply sequentially on the diminishing remainder. Works in outpost combat and sub-vs-sub.',
  },
  infiltrator: {
    glyph: '⊘',
    short: 'CP 4 — drains the entire outpost shield to 0.',
    long: "Combat: CP 4 (simultaneous with Thief).\n\nWhen attacking an outpost, drains the *entire* live shield charge to zero. One Infiltrator is enough; extras are redundant for the drain. Doesn't apply in sub-vs-sub.",
  },
  double_agent: {
    glyph: '⇆',
    short: 'CP 5 — both subs lose all drillers, swap ownership, combat ends.',
    long: "Combat: CP 5. Sub-vs-sub only.\n\nBoth subs' drillers are destroyed; the two subs swap ownership (including all specialists aboard, including the Double Agent). Both subs continue toward their original destinations under the new ownership. Combat ends — no further phases run.",
  },
  assassin: {
    glyph: '†',
    short: 'CP 6 — kills every enemy specialist outright (no capture).',
    long: 'Combat: CP 6.\n\nKills every active specialist on the opposing side outright — no capture, no Princess save. Two Assassins on the same side is redundant. Beats: most specialists with higher CP (e.g. Lieutenant CP 7). Countered by: Revered Elder (silences), Martyr (CP 1 fires first), Double Agent (ends combat at CP 5).',
  },
  lieutenant: {
    glyph: '★',
    short: 'CP 7 — destroys 5 enemy drillers. 1.5× sub speed.',
    long: 'Combat: CP 7.\n\nDestroys 5 enemy drillers in any combat. The sub it rides moves at 1.5× base speed (local). Promotes to General.',
  },
  general: {
    glyph: '⚔︎',
    short: 'post-spec — +10 enemy drillers killed globally per General owned.',
    long: 'Combat: fires after CP 7, before the shield phase (no formal CP slot).\n\nWhen you have any specialist participating in a combat, every General you own globally adds +10 enemy drillers destroyed. Multiple Generals stack additively. Carrier sub moves at 1.5× base speed. Promoted from Lieutenant.',
  },
  war_hero: {
    glyph: '✪',
    short: 'CP 7 — destroys 20 enemy drillers in combat.',
    long: 'Combat: CP 7.\n\nDestroys 20 enemy drillers in any combat (sub-vs-sub or outpost). Per-War-Hero additive. Promoted from Sentry. Countered by: Revered Elder, Martyr, Assassin (CP 6 < 7).',
  },
  sentry: {
    glyph: '◉',
    short: 'no CP (outpost passive) — every 2h shoots an enemy sub in sonar.',
    long: "Combat: no CP — pure outpost passive, no in-combat damage (War Hero is the upgrade that adds combat damage).\n\nEvery 2 hours fires at one enemy sub within *half* of the outpost's sonar range, destroying ceil(5% × that sub's drillers). Targets the sub it can hurt most this tick. Promotes to War Hero.",
  },
  pirate: {
    glyph: '☠︎',
    short: 'no CP — 2× pursuit; targets any visible enemy sub directly.',
    long: 'Combat: no CP — sub combat at the meet point follows normal sub-vs-sub rules.\n\nSpecial sub-targeting carrier: while pursuing, the sub moves at 2× base speed and aims at a chosen enemy sub regardless of route. After combat (win or lose), the surviving Pirate sub returns to the carrier owner\'s nearest outpost at 4× speed.',
  },

  // --- Economy / utility ---
  smuggler: {
    glyph: '»',
    short: 'no CP — 3× speed when destination is one of your own outposts.',
    long: 'Combat: no CP — boost is movement, not combat.\n\nBoosts the carrier sub to 3× base speed — but only when the destination is an outpost you own. Smuggling to a hostile or dormant outpost reverts to 1× speed. Local-max with other speed specialists. Promotes to Tycoon.',
  },
  tycoon: {
    glyph: '¤',
    short: 'no CP — +50% factory cycle speed globally; +3 drillers/cycle local.',
    long: 'Combat: no CP — pure economy.\n\nGlobal passive: every Tycoon you own shortens *all* your factory cycle intervals by 50% (additive per Tycoon). Local: +3 drillers per cycle at the factory the Tycoon is at. Promoted from Smuggler.',
  },
  inspector: {
    glyph: '⛨',
    short: 'no CP — fully charges his outpost\'s shield on arrival + after combat.',
    long: "Combat: no CP — fires *between* combats, not during.\n\nWhen the Inspector arrives at a friendly outpost OR a combat resolves at that outpost (held, not captured), the shield is instantly recharged to its current max. Doesn't raise the max — that's Queen / Security Chief / King. Promotes to Security Chief.",
  },
  security_chief: {
    glyph: '⊞',
    short: 'no CP — +10 max shield globally per SC owned; +10 more locally.',
    long: 'Combat: no CP — passive shield bonus + the Inspector recharge behaviour, both outside the combat phase.\n\nAdds +10 max shield charge to every outpost you own, per Security Chief globally. The SC\'s own outpost gets an additional +10 local. Inherits the Inspector full-recharge-on-arrival/after-combat behaviour. Promoted from Inspector.',
  },
  diplomat: {
    glyph: '✿',
    short: 'no CP — releases your captives held within his outpost\'s sonar.',
    long: "Combat: no CP — runs in the captive-resolution tick, not combat.\n\nEvery tick, looks for any of YOUR specialists held captive at an outpost within the Diplomat's current outpost's sonar range. Each such captive is released — spawns a small gift-sub home. Doesn't free other players' captives.",
  },

  // --- Visibility / production ---
  intelligence_officer: {
    glyph: '◎',
    short: 'no CP — +25% sonar on all your outposts per IO owned.',
    long: 'Combat: no CP — pure visibility passive.\n\n+25% sonar range additive across every outpost you own, per Intelligence Officer. (In the original game IOs also revealed the *kind* of outposts outside sonar; in this build all outposts are common-knowledge so that effect is a no-op.) Stacks across all your IOs globally.',
  },
  tinkerer: {
    glyph: '⚙︎',
    short: 'no CP — +3× outpost max-shield electrical; drains 3 shield/h local.',
    long: "Combat: no CP — economy / shield interference, not a combat-phase actor.\n\nPer Tinkerer at the outpost: adds 3× the outpost's current max shield charge to your electrical output (a big draw). Also continuously drains 3 shield-charges per hour at this outpost. Promotes to Minister of Energy.",
  },
  minister_of_energy: {
    glyph: '⚡︎',
    short: 'no CP — +300 electrical globally; -1 driller/factory-cycle.',
    long: 'Combat: no CP — economy bonus.\n\n+300 to your global electrical output per MoE owned. Cost: each factory cycle produces 1 fewer driller per MoE (the trade-off for the energy bonus). Promoted from Tinkerer.',
  },
  foreman: {
    glyph: '⛏︎',
    short: 'no CP — +6 drillers per factory cycle while at the factory.',
    long: "Combat: no CP — production bonus.\n\n+6 drillers per production cycle at the Foreman's current factory. Stacks additively. Pauses while in transit on a sub. Promotes to Engineer.",
  },
  engineer: {
    glyph: '⚒︎',
    short: 'post-driller — restores 25% of lost drillers after a won combat.',
    long: "Combat: post-driller (no CP slot). Only fires if the Engineer's owner WINS the combat.\n\nEach Engineer you own globally restores 25% of the drillers your side lost in that combat. If an Engineer was at the combat site, an extra 25% is added. Restored drillers clamp to your electrical cap. Doesn't fire on losses or ties. Promoted from Foreman.",
  },
  hypnotist: {
    glyph: '☯︎',
    short: 'no CP — converts captives at his outpost to your side every tick.',
    long: "Combat: no CP — captive resolution, not combat.\n\nEvery tick, takes control of every captive specialist held at the Hypnotist's own outpost — they become active specialists of the Hypnotist's owner. Counter: enemy Diplomat in sonar (Diplomat resolves first that tick, freeing them home). Promotes to King.",
  },
  king: {
    glyph: '♔',
    short: 'post-spec — +1 enemy driller per 3 friendly at the King\'s location.',
    long: "Combat: post-spec, post-CP-7, before the shield phase (same slot as General). Fires in combats at the King's own location only.\n\nAdds 1 enemy driller destroyed per 3 friendly drillers remaining after the specialist phase. Also +20 max shield at his outpost / -20 at every other outpost you own. Promoted from Hypnotist.",
  },
  navigator: {
    glyph: '➤',
    short: 'no CP — lets you redirect this sub mid-flight to a new destination.',
    long: "Combat: no CP — out-of-combat utility on a sub.\n\nRequired to redirect a sub once it's left port. Without a Navigator aboard, an in-flight sub commits to its destination irrevocably. Redirect changes destinationId + recomputes arrivalAt from the sub's current position. Promotes to Admiral.",
  },
  admiral: {
    glyph: '⚓︎',
    short: 'no CP — +50% global speed for empty subs; 1.5× local.',
    long: "Combat: no CP — speed buff, not a combat-phase actor.\n\nGlobal: every Admiral you own adds +0.5× speed to *any* sub you own that's carrying NO specialists (additive — two Admirals = 2× speed for empty subs). Local: the Admiral's own sub moves at 1.5× base. Promoted from Navigator.",
  },
  helmsman: {
    glyph: '↻',
    short: 'no CP — 2× base speed for the sub he\'s on.',
    long: "Combat: no CP — speed only.\n\nCarrier sub moves at 2× base speed (local). Local-max with other speed specialists — pairs poorly with Smuggler / Pirate (only the highest applies). Doesn't promote.",
  },
};

/** Icon for the sub entity itself (HUD, lists, badges). */
export const SUB_GLYPH = '◐';
