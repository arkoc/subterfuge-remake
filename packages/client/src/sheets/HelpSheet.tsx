import { BottomSheet } from '../BottomSheet.js';

interface HelpSheetProps {
  onClose: () => void;
}

export function HelpSheet({ onClose }: HelpSheetProps) {
  return (
    <BottomSheet open onClose={onClose} title="how to play" meta="quick reference">
      <div className="section-title">map</div>
      <div className="help" style={{ fontStyle: 'normal' }}>
        <p>
          <strong style={{ color: 'var(--phos)' }}>tap an outpost</strong> to inspect it.
        </p>
        <p>
          <strong style={{ color: 'var(--phos)' }}>drag from one of your outposts to another</strong>{' '}
          to launch a sub on that route. release on empty space to cancel.
        </p>
        <p>
          <strong style={{ color: 'var(--phos)' }}>drag empty space</strong> to pan the
          map. <strong style={{ color: 'var(--phos)' }}>scroll wheel / pinch</strong> to zoom.
        </p>
        <p>
          <strong style={{ color: 'var(--phos)' }}>tap a sub in flight</strong> to see its
          cargo, route and ETA.
        </p>
      </div>

      <div className="section-title">glyphs</div>
      <div className="help" style={{ fontStyle: 'normal' }}>
        <p>
          <span style={{ color: 'var(--phos)' }}>▲</span> factory · produces 6 drillers
          every 8h
          <br />
          <span style={{ color: 'var(--phos)' }}>●</span> generator · +50 electrical cap
          <br />
          <span style={{ color: 'var(--phos)' }}>◆</span> mine · 1 kg neptunium / day ×
          your outposts
          <br />
          <span style={{ color: '#ff5470' }}>•</span> small red dot beside a factory ·
          paused — your drillers are at the electrical cap
          <br />
          <span style={{ color: '#ff5470' }}>⚔ 6h</span> red badge above an outpost ·
          incoming enemy sub eta
        </p>
        <p style={{ marginTop: 8 }}>
          Specialist glyphs appear above each outpost (and beside each sub) — tap
          one in the outpost sheet to read the full effect. Use{' '}
          <strong style={{ color: 'var(--phos)' }}>♛ find queen</strong> in the
          top-right tools cluster (or press <kbd>Q</kbd>) to centre on her.
        </p>
      </div>

      <div className="section-title">time machine</div>
      <div className="help" style={{ fontStyle: 'normal' }}>
        <p>
          <strong style={{ color: 'var(--phos)' }}>drag the bottom scrubber</strong>{' '}
          forward to project into the future. the map updates to show what would happen
          given visible information.
        </p>
        <p>
          launch orders issued while scrubbed are{' '}
          <strong style={{ color: 'var(--phos)' }}>queued</strong> — they execute when the
          real sim clock reaches your scrubbed time.
        </p>
        <p>
          tap the &quot;live&quot; tag (left side of the scrubber) to snap back to live.
        </p>
      </div>

      <div className="section-title">combat</div>
      <div className="help" style={{ fontStyle: 'normal' }}>
        <p>
          when launching at an enemy outpost, the launch sheet shows a live{' '}
          <strong style={{ color: 'var(--phos)' }}>combat preview</strong> using the
          shared sim engine — same code the server uses to resolve combat, so the
          prediction matches reality given visible info.
        </p>
        <p>
          shields absorb attackers 1-for-1. ties go to the defender. capturing a
          mine costs the previous owner 20% of their neptunium.
        </p>
      </div>

      <div className="section-title">diplomacy</div>
      <div className="help" style={{ fontStyle: 'normal' }}>
        <p>
          <strong style={{ color: 'var(--phos)' }}>chat (msg button)</strong> — global or
          DM. messages are persistent and visible across sessions.
        </p>
        <p>
          <strong style={{ color: 'var(--phos)' }}>gift subs</strong> — in the launch
          sheet (enemy target), toggle &quot;gift to X&quot; to transfer drillers
          peacefully instead of attacking.
        </p>
        
      </div>

      <div className="section-title">interface</div>
      <div className="help" style={{ fontStyle: 'normal' }}>
        <p>
          <strong>top bar</strong>: time (amber when scrubbed) · drillers/cap ·
          neptunium with progress-bar to 200 kg · your player chip (tap to switch).
        </p>
        <p>
          <strong>top-right tools</strong>: ♛ find queen · ⌖ fit map · ?
          help. Pinch to zoom (touch) or use scroll wheel (desktop).
        </p>
        <p>
          <strong>bottom tab bar</strong>: msg · flt · que · hir · log. Each badge
          shows pending counts. Tap the active tab again to close its sheet.
        </p>
        <p>
          <strong>scrubber</strong> (above the tab bar) — drag forward to project
          the future, tap LIVE to snap back. You can also drag from any outpost on
          the map to scrub the timeline to the projected arrival of a sub on that
          trajectory.
        </p>
      </div>
    </BottomSheet>
  );
}
