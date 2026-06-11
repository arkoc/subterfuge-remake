import type { PlayerId } from '@subterfuge/sim';

/**
 * Player palette. Tuned for the sonar/tactical theme: each colour is
 * legible on the deep-navy backdrop and clearly distinguishable from
 * the phosphor-cyan chrome.
 */
const PLAYER_COLORS: number[] = [
  0x5fb4ff, // A — tactical blue
  0xff5470, // B — alert red
  0xa3e635, // C — lime
  0xffb547, // D — amber
  0xc084fc, // E — lavender
  0xfb923c, // F — orange
  0x67e8f9, // G — cyan
  0xf472b6, // H — pink
  0xfcd34d, // I — yellow
  0xf87171, // J — rose
];

export function playerColor(playerId: PlayerId | null): number {
  if (playerId === null) return 0x4a5874;
  return PLAYER_COLORS[playerId as unknown as number] ?? 0x4a5874;
}

export function playerColorHex(playerId: PlayerId | null): string {
  return '#' + playerColor(playerId).toString(16).padStart(6, '0');
}

export function playerLetter(playerId: PlayerId | null): string {
  if (playerId === null) return '—';
  return String.fromCharCode('A'.charCodeAt(0) + (playerId as unknown as number));
}
