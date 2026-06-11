import { useEffect, useMemo, useRef, useState } from 'react';
import type { Outpost, OutpostId, World } from '@subterfuge/sim';
import { playerColorHex } from './colors.js';

interface CommandPaletteProps {
  open: boolean;
  world: World | null;
  /** Selected an outpost → caller centers map + opens its sheet. */
  onPick: (id: OutpostId) => void;
  onClose: () => void;
}

const MAX_RESULTS = 12;

/**
 * Cmd-K command palette. Fuzzy-ish (case-insensitive substring) search
 * over outpost names — Subterfuge maps have ~40-60 named outposts and
 * the in-game alternative is pan+squint, which gets old fast.
 *
 * Keyboard:
 *   ↑/↓     move selection
 *   Enter   pick highlighted entry
 *   Esc     close (handled by App's global handler too)
 *
 * Results are sorted: exact prefix match > anywhere-match, alphabetic
 * within each bucket. Dormant outposts are de-prioritised because
 * "find me my outpost" is the dominant query.
 */
export function CommandPalette({ open, world, onPick, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state every time the palette opens — old query / cursor
  // shouldn't survive a close-reopen.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      // Focus the input on next frame so the focus survives the
      // initial render (React's auto-focus inside conditional renders
      // can race with parent re-renders).
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo<Outpost[]>(() => {
    if (!open || world === null) return [];
    return rankOutposts(world.outposts, query).slice(0, MAX_RESULTS);
  }, [open, world, query]);

  // Clamp selection when results shrink.
  useEffect(() => {
    if (selectedIdx >= results.length) {
      setSelectedIdx(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIdx]);

  if (!open) return null;

  return (
    <>
      <div className="command-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="command-palette"
        role="dialog"
        aria-label="find outpost"
      >
        <input
          ref={inputRef}
          type="text"
          className="command-input"
          placeholder="find outpost…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelectedIdx((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelectedIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const picked = results[selectedIdx];
              if (picked !== undefined) onPick(picked.id);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="command-results" role="listbox">
          {results.length === 0 && (
            <div className="command-empty">
              {query.length > 0 ? 'no match' : 'type to find an outpost'}
            </div>
          )}
          {results.map((o, idx) => (
            <button
              key={o.id}
              type="button"
              className={`command-result${idx === selectedIdx ? ' active' : ''}`}
              onMouseEnter={() => setSelectedIdx(idx)}
              onClick={() => onPick(o.id)}
              role="option"
              aria-selected={idx === selectedIdx}
            >
              <span
                className="command-swatch"
                style={{
                  background:
                    o.ownerId === null ? 'transparent' : playerColorHex(o.ownerId),
                  borderColor:
                    o.ownerId === null ? 'var(--line)' : playerColorHex(o.ownerId),
                }}
                aria-hidden="true"
              />
              <span className="command-glyph" aria-hidden="true">
                {kindGlyph(o.kind)}
              </span>
              <span className="command-name">{o.name.toLowerCase()}</span>
              <span className="command-kind">{o.kind}</span>
            </button>
          ))}
        </div>
        <div className="command-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </>
  );
}

function kindGlyph(kind: Outpost['kind']): string {
  switch (kind) {
    case 'factory':
      return '▲';
    case 'generator':
      return '●';
    case 'mine':
      return '◆';
  }
}

function rankOutposts(outposts: readonly Outpost[], query: string): Outpost[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    // No query: surface owned outposts first, then by name. Helps
    // "I want to find one of mine" without typing.
    return [...outposts].sort((a, b) => {
      const ao = a.ownerId !== null ? 0 : 1;
      const bo = b.ownerId !== null ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  }
  const scored: { o: Outpost; score: number }[] = [];
  for (const o of outposts) {
    const name = o.name.toLowerCase();
    let score: number;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else continue;
    // Tiebreak: prefer owned (non-dormant) outposts within same score.
    if (o.ownerId === null) score += 0.5;
    scored.push({ o, score });
  }
  scored.sort((a, b) => a.score - b.score || a.o.name.localeCompare(b.o.name));
  return scored.map((s) => s.o);
}
