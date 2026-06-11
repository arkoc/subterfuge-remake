import { memo } from 'react';

interface FABStackProps {
  /** Number of pending + scheduled orders the active player owns. */
  myQueued: number;
  /** Naïve unread messages count. */
  unread: number;
  /** Whether the active player's next hire is ready right now. */
  hireReady: boolean;
  activeSheet: string | null;
  unreadEvents: number;
  onOpen: (sheet: 'chat' | 'fleet' | 'queue' | 'hire' | 'events' | 'help') => void;
}

/**
 * Mobile-first control surface — the bottom tab bar (.tabbar): primary
 * navigation between sheets. Five icons in a horizontal row across the
 * bottom of the viewport, in the natural thumb-reach zone. iOS-style:
 * phosphor bottom-border accent on the active tab, badges above the
 * icon.
 *
 * The map fills the entire space between the HUD and the tab bar; the
 * scrubber overlays just above the tab bar. This is the canonical
 * mobile-app layout (top read-only HUD → content → bottom action bar).
 *
 * Memoised: the parent re-renders on every WebSocket push, but this
 * component only needs the four scalar counters above + handlers.
 */
function FABStackInner({
  myQueued,
  unread,
  hireReady,
  activeSheet,
  unreadEvents,
  onOpen,
}: FABStackProps) {
  return (
    <>
      {/* Bottom tab bar — primary navigation. Always five tabs in this
          order: msg, flt, que, hir, log. Each tab is a wide tap target
          with a glyph + label so it reads as a tab, not a FAB. */}
      <nav className="tabbar" role="navigation" aria-label="primary">
        <TabButton
          label="comms"
          glyph="msg"
          active={activeSheet === 'chat'}
          badge={unread > 0 ? (unread > 99 ? '99+' : `${unread}`) : null}
          onClick={() => onOpen('chat')}
        />
        <TabButton
          label="fleet"
          glyph="flt"
          active={activeSheet === 'fleet'}
          badge={null}
          onClick={() => onOpen('fleet')}
        />
        <TabButton
          label="queue"
          glyph="que"
          active={activeSheet === 'queue'}
          badge={myQueued > 0 ? `${myQueued}` : null}
          onClick={() => onOpen('queue')}
        />
        {/* Hires never bank (executeHire sets nextHireAt from the hire
            moment, not the previous deadline), so the available count
            is always 0 or 1 — shown as a number to match the other
            tabs' badge grammar. */}
        <TabButton
          label="hire"
          glyph="hir"
          active={activeSheet === 'hire'}
          badge={hireReady ? '1' : null}
          badgeKind={hireReady ? 'ready' : 'count'}
          onClick={() => onOpen('hire')}
        />
        <TabButton
          label="log"
          glyph="log"
          active={activeSheet === 'events'}
          badge={
            unreadEvents > 0 ? (unreadEvents > 99 ? '99+' : `${unreadEvents}`) : null
          }
          onClick={() => onOpen('events')}
        />
      </nav>
    </>
  );
}

interface TabButtonProps {
  label: string;
  glyph: string;
  active: boolean;
  badge: string | null;
  badgeKind?: 'count' | 'ready';
  onClick: () => void;
}

function TabButton({
  label,
  glyph,
  active,
  badge,
  badgeKind = 'count',
  onClick,
}: TabButtonProps) {
  return (
    <button
      type="button"
      className={`tab${active ? ' active' : ''}`}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      <span className="tab-glyph">{glyph}</span>
      {badge !== null && (
        <span className={`tab-badge ${badgeKind === 'ready' ? 'ready' : ''}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

export const FABStack = memo(FABStackInner);
