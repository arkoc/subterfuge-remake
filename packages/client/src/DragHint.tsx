import { useEffect, useState } from 'react';

const LAUNCH_HINT_SEEN_KEY = 'subterfuge-drag-hint-seen';
const SCRUB_HINT_SEEN_KEY = 'subterfuge-scrub-hint-seen';
const VISIBLE_MS = 7000;

interface DragHintProps {
  /** Has the player completed at least one launch this session? When
   *  it flips from false → true we promote them to the next hint
   *  (drag-to-scrub the timeline). */
  hasLaunched?: boolean;
}

/**
 * Onboarding tooltips. Two hints, shown one at a time:
 *
 *  1. **Launch** — "drag from one of your outposts to another to
 *     launch a sub". Shown on first load. localStorage flag prevents
 *     repeats across sessions.
 *  2. **Scrub** — "drag deeper to peek into the future". Shown the
 *     first time the player completes a launch (so they know the
 *     drag-to-launch gesture works) and discovers the secondary use.
 *
 * Floats above the map but below sheets so it never blocks a sheet
 * interaction. Auto-dismisses after VISIBLE_MS or on tap.
 */
export function DragHint({ hasLaunched = false }: DragHintProps) {
  const [active, setActive] = useState<'launch' | 'scrub' | null>(null);

  // Decide which hint (if any) to show on mount and whenever the
  // hasLaunched flag flips.
  useEffect(() => {
    const launchSeen = readFlag(LAUNCH_HINT_SEEN_KEY);
    const scrubSeen = readFlag(SCRUB_HINT_SEEN_KEY);
    if (!launchSeen) {
      setActive('launch');
      return;
    }
    if (hasLaunched && !scrubSeen) {
      setActive('scrub');
      return;
    }
    setActive(null);
  }, [hasLaunched]);

  // Auto-dismiss after VISIBLE_MS, persisting the dismissal so we
  // don't show the same hint on next load.
  useEffect(() => {
    if (active === null) return;
    const flag = active === 'launch' ? LAUNCH_HINT_SEEN_KEY : SCRUB_HINT_SEEN_KEY;
    const t = setTimeout(() => {
      setActive(null);
      writeFlag(flag);
    }, VISIBLE_MS);
    return () => clearTimeout(t);
  }, [active]);

  if (active === null) return null;

  const isLaunch = active === 'launch';
  return (
    <button
      type="button"
      className={`drag-hint drag-hint-${active}`}
      onClick={() => {
        const flag = isLaunch ? LAUNCH_HINT_SEEN_KEY : SCRUB_HINT_SEEN_KEY;
        setActive(null);
        writeFlag(flag);
      }}
      aria-label="dismiss hint"
    >
      <span className="drag-hint-glyph" aria-hidden="true">
        {isLaunch ? '↗' : '⇣'}
      </span>
      <span className="drag-hint-text">
        {isLaunch
          ? 'tip: drag from one of your outposts to another to launch a sub'
          : 'tip: drag further to scrub the timeline — preview combat before launch'}
      </span>
      <span className="drag-hint-dismiss" aria-hidden="true">×</span>
    </button>
  );
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* ignore — private mode etc. */
  }
}
