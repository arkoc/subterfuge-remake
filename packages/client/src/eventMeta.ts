import type { SimEventKind } from '@subterfuge/sim';

/**
 * Shared metadata for game events — used by the event-log sheet AND the
 * Time-Machine timeline markers, so both stay in sync.
 */

// ---------------------------------------------------------------------
// Event-log (EventsSheet) maps
// ---------------------------------------------------------------------

export const KIND_LABEL: Record<SimEventKind, string> = {
  combat_outpost: 'combat',
  combat_sub_vs_sub: 'sub vs sub',
  martyr_blast: 'martyr',
  sentry_shot: 'sentry',
  captive_released: 'release',
  captive_converted: 'convert',
  pirate_intercept: 'pirate',
  princess_promoted: 'royalty',
  player_eliminated: 'elim',
  order_failed: 'failed',
};

export type EventCategory = 'all' | 'combat' | 'sentry' | 'diplo';

export const CATEGORY_OF: Record<SimEventKind, Exclude<EventCategory, 'all'>> = {
  combat_outpost: 'combat',
  combat_sub_vs_sub: 'combat',
  martyr_blast: 'combat',
  sentry_shot: 'sentry',
  pirate_intercept: 'sentry',
  captive_released: 'diplo',
  captive_converted: 'diplo',
  princess_promoted: 'diplo',
  player_eliminated: 'diplo',
  order_failed: 'diplo',
};

export type EventSeverity = 'bad' | 'neutral' | 'good';

export const SEVERITY_OF: Record<SimEventKind, EventSeverity> = {
  combat_outpost: 'neutral',
  combat_sub_vs_sub: 'neutral',
  martyr_blast: 'bad',
  sentry_shot: 'good',
  pirate_intercept: 'neutral',
  captive_released: 'good',
  captive_converted: 'neutral',
  princess_promoted: 'good',
  player_eliminated: 'bad',
  order_failed: 'bad',
};

export const EVENT_CATEGORIES: { key: EventCategory; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'combat', label: 'combat' },
  { key: 'sentry', label: 'sentry' },
  { key: 'diplo', label: 'diplomacy' },
];
