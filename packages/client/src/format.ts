import { DAY_MS, HOUR_MS, MINUTE_MS } from '@subterfuge/sim';

/**
 * Shared time formatters. One implementation each — these used to be
 * copy-pasted per component and had quietly diverged (spacing, 'NOW'
 * vs 'now' vs 'arrived'). Canonical voices:
 *
 *   formatTime     elapsed/absolute clock readouts  `2d 14h` `3h 5m` `12m`
 *   formatDuration like formatTime, clamps negatives to `0m`
 *   formatSimTime  compact absolute stamp           `2d14h`
 *   formatEta      countdowns                       `now` `<1m` `45m` `3h5m`
 *   formatOffset   scrubber/tether deltas (≥1m)     `1d23h` `3h5m` `4m`
 */

export function formatTime(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const mins = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function formatDuration(ms: number): string {
  if (ms < 0) return '0m';
  return formatTime(ms);
}

export function formatSimTime(simMs: number): string {
  if (simMs < 0) return '0h';
  const days = Math.floor(simMs / DAY_MS);
  const hours = Math.floor((simMs % DAY_MS) / HOUR_MS);
  return `${days}d${hours}h`;
}

export function formatEta(ms: number): string {
  if (ms <= 0) return 'now';
  if (ms < MINUTE_MS) return '<1m';
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)}m`;
  const h = Math.floor(ms / HOUR_MS);
  const m = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export function formatOffset(ms: number): string {
  if (ms >= DAY_MS) {
    const d = Math.floor(ms / DAY_MS);
    const h = Math.floor((ms % DAY_MS) / HOUR_MS);
    return h === 0 ? `${d}d` : `${d}d${h}h`;
  }
  if (ms >= HOUR_MS) {
    const h = Math.floor(ms / HOUR_MS);
    const m = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return m === 0 ? `${h}h` : `${h}h${m}m`;
  }
  return `${Math.max(1, Math.floor(ms / MINUTE_MS))}m`;
}
