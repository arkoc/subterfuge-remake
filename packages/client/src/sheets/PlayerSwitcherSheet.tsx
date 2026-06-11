import { type PlayerId, type World } from '@subterfuge/sim';
import { BottomSheet } from '../BottomSheet.js';
import { playerColorHex, playerLetter } from '../colors.js';

interface PlayerSwitcherSheetProps {
  world: World;
  activePlayerId: PlayerId;
  onSelect: (id: PlayerId) => void;
  onClose: () => void;
}

export function PlayerSwitcherSheet({
  world,
  activePlayerId,
  onSelect,
  onClose,
}: PlayerSwitcherSheetProps) {
  return (
    <BottomSheet
      open
      onClose={onClose}
      title="select callsign"
      meta="dev mode"
    >
      <div className="help">
        switch active player. real auth + lobby lands in phase 12. for now
        each player slot has the same controls; use this to test multiple
        perspectives on the same game.
      </div>
      <div className="player-list">
        {world.players.map((p) => {
          const isActive = p.id === activePlayerId;
          // From the currently-active player's filtered view we only see
          // outposts within sonar; printing "0 outposts" for an unseen
          // player misleads. Mark non-active counts as unknown.
          return (
            <button
              key={p.id}
              type="button"
              className={`item${isActive ? ' active' : ''}`}
              onClick={() => {
                onSelect(p.id);
                onClose();
              }}
            >
              <span
                className="swatch"
                style={{
                  background: playerColorHex(p.id),
                  color: playerColorHex(p.id),
                }}
              />
              <span style={{ flex: 1, textAlign: 'left' }}>
                <strong>
                  {playerLetter(p.id)} {p.name}
                </strong>
                {p.eliminated && (
                  <span style={{ color: 'var(--warn)', marginLeft: 8, fontSize: 11 }}>
                    eliminated
                  </span>
                )}
              </span>
              {isActive && (
                <span style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--phos)' }}>
                  active
                </span>
              )}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
