import { useState, type ReactNode } from 'react';
import type { SpecialistKind } from '@subterfuge/sim';
import { SPECIALISTS } from './specialistInfo.js';

interface SpecialistChipProps {
  kind: SpecialistKind;
  /** Right-side status badge (e.g. "active", "captive", "converting"). */
  status?: ReactNode;
  /** Optional accent color for status / glyph (e.g. owner color when
   *  the specialist is held captive by someone else). */
  accentColor?: string;
  /** Pre-expanded on mount. False by default — saves vertical space. */
  defaultExpanded?: boolean;
}

/**
 * Specialist display row used everywhere a specialist is listed:
 * outpost sheet, sub popover, launch sheet checkbox list, captives,
 * hire sheet, combat preview breakdowns.
 *
 * Layout (collapsed):
 *   [glyph] kind                                  status ▸
 *           one-line short description
 *
 * Tap the row → expands to show the full multi-line description below
 * the short. Tap again → collapses. The chevron flips ▸ ↔ ▾.
 *
 * If the caller renders the specialist as part of a clickable form
 * control (e.g. a `<label>` wrapping a checkbox), pass `interactive={false}`
 * to disable the row-tap-toggle so the parent label's click semantics
 * aren't hijacked. (TBD: not currently exposed; expand pattern can be
 * added if needed.)
 */
export function SpecialistChip({
  kind,
  status,
  accentColor,
  defaultExpanded = false,
}: SpecialistChipProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const info = SPECIALISTS[kind];
  const label = kind.replace(/_/g, ' ');

  return (
    <button
      type="button"
      className={`spec-chip${open ? ' open' : ''}`}
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
    >
      <div className="spec-chip-row">
        <span className="spec-chip-glyph" aria-hidden="true">
          {info.glyph}
        </span>
        <span className="spec-chip-text">
          <span className="spec-chip-name">{label}</span>
        </span>
        {status !== undefined && (
          <span className="spec-chip-status" style={accentColor ? { color: accentColor } : undefined}>
            {status}
          </span>
        )}
        <span className="spec-chip-chev" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </div>
      {open && (
        <div className="spec-chip-long">
          <span className="spec-chip-short">{info.short}</span>
          {info.long}
        </div>
      )}
    </button>
  );
}
