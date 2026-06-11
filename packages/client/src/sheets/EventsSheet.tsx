import { useMemo, useState } from 'react';
import {
  type SimEvent,
  type World,
} from '@subterfuge/sim';
import { BottomSheet } from '../BottomSheet.js';
import {
  CATEGORY_OF,
  EVENT_CATEGORIES as CATEGORIES,
  KIND_LABEL,
  SEVERITY_OF,
  type EventCategory as Category,
} from '../eventMeta.js';
import { formatTime } from '../format.js';

interface EventsSheetProps {
  world: World;
  onClose: () => void;
  /** Center the map on a world coord (used by the per-row jump button
   *  for any event with a `pos`). Omit to disable the jump action. */
  onJumpTo?: (pos: { x: number; y: number }) => void;
}

/**
 * Read-only event log. The server filters events per viewer in
 * `viewForPlayer`, so the list here is already scoped to the active
 * player's own combats / sentry shots / etc. Newest first.
 *
 * Category chips at the top filter the list to a single concern
 * (combat / sentry / diplomacy) when the log is long; the count next
 * to each chip is the live total in that bucket.
 *
 * Events with a `pos` get a "jump" affordance — tapping it centers
 * the map on the event location and closes the sheet so the player
 * can see it in context.
 */
export function EventsSheet({ world, onClose, onJumpTo }: EventsSheetProps) {
  const [category, setCategory] = useState<Category>('all');
  // Reversed (newest-first) once per render — cheap, the buffer is
  // bounded to MAX_EVENTS.
  const newest = useMemo(() => [...world.events].reverse(), [world.events]);
  const counts = useMemo(() => {
    const c: Record<Category, number> = { all: 0, combat: 0, sentry: 0, diplo: 0 };
    for (const e of world.events) {
      c.all += 1;
      const bucket = CATEGORY_OF[e.kind];
      if (bucket !== undefined) c[bucket] += 1;
    }
    return c;
  }, [world.events]);
  const filtered = useMemo(() => {
    if (category === 'all') return newest;
    return newest.filter((e) => CATEGORY_OF[e.kind] === category);
  }, [newest, category]);

  const meta =
    filtered.length === 0
      ? category === 'all'
        ? 'no events'
        : 'none in this category'
      : `${filtered.length} of ${world.events.length}`;

  return (
    <BottomSheet open onClose={onClose} title="event log" meta={meta}>
      <div className="event-filter">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`tag event-filter-chip${category === c.key ? ' active' : ''}`}
            onClick={() => setCategory(c.key)}
            aria-pressed={category === c.key}
          >
            {c.label}
            <span className="event-filter-count">{counts[c.key]}</span>
          </button>
        ))}
      </div>
      {filtered.length === 0 && category === 'all' && (
        <div className="help">
          combat outcomes, sentry shots, martyr blasts, releases and
          conversions appear here as they happen.
        </div>
      )}
      {filtered.map((e) => (
        <EventRow
          key={e.id}
          event={e}
          {...(onJumpTo !== undefined ? { onJumpTo } : {})}
          onClose={onClose}
        />
      ))}
    </BottomSheet>
  );
}

function EventRow({
  event,
  onJumpTo,
  onClose,
}: {
  event: SimEvent;
  onJumpTo?: (pos: { x: number; y: number }) => void;
  onClose: () => void;
}) {
  const canJump = event.pos !== undefined && onJumpTo !== undefined;
  const severity = SEVERITY_OF[event.kind] ?? 'neutral';
  return (
    <div className={`event-row event-row-${severity}`}>
      {/* Meta line on top (time + kind tag + jump), summary on its own
          full-width line below — a side tag column wasted a third of
          the sheet and forced summaries to wrap into slivers. */}
      <div className="event-head">
        <span className="event-time">{formatTime(event.at)}</span>
        <span className={`event-tag tag event-tag-${severity}`}>
          {KIND_LABEL[event.kind] ?? event.kind}
        </span>
        {canJump && (
          <button
            type="button"
            className="event-jump"
            title="centre the map here"
            aria-label="centre map on event location"
            onClick={() => {
              onJumpTo!(event.pos!);
              onClose();
            }}
          >
            ⌖
          </button>
        )}
      </div>
      <span className="event-summary">{event.summary}</span>
    </div>
  );
}

