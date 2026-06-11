import type { Coord } from './types.js';
import { MAP_SIZE } from './types.js';

/**
 * Distance on the **toroidal** map (per docs/00_overview.md — the left
 * and right edges are neighbours, and so are the top and bottom). For
 * a point at `x=200` and another at `x=9800` on a MAP_SIZE=10000 map,
 * the true distance is 400, not 9600.
 *
 * Every sim subsystem that uses distance — sonar visibility, sub
 * travel time, world-gen repulsion — gets this for free because they
 * all call through here.
 */
export function distSquared(a: Coord, b: Coord): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const wx = dx > MAP_SIZE / 2 ? MAP_SIZE - dx : dx;
  const wy = dy > MAP_SIZE / 2 ? MAP_SIZE - dy : dy;
  return wx * wx + wy * wy;
}

export function dist(a: Coord, b: Coord): number {
  return Math.sqrt(distSquared(a, b));
}

/**
 * Signed delta from `from` → `to` along the shorter direction of the
 * torus. Result is in `[-MAP_SIZE/2, MAP_SIZE/2]`. Used by sub-position
 * interpolation so a sub travelling from `x=9500` to `x=200` heads
 * **right** (delta = +700), not left across the whole map.
 */
export function torusDelta(from: number, to: number): number {
  let d = to - from;
  if (d > MAP_SIZE / 2) d -= MAP_SIZE;
  else if (d < -MAP_SIZE / 2) d += MAP_SIZE;
  return d;
}

/** Wrap a coordinate into `[0, MAP_SIZE)`. Handles negatives. */
export function wrapCoord(c: number): number {
  return ((c % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;
}
