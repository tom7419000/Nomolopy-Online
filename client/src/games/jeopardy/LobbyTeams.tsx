/**
 * Teams im Wartezimmer.
 *
 * Es gibt IMMER Teams: Wer dazukommt, ist erst mal allein in einem, benannt
 * nach sich selbst. Das sieht aus wie ohne Teams, und wer zusammenspielen
 * will, tritt einem bei. Nur ein Codepfad, keine Umschaltung.
 *
 * Der Weg zum Server ist `api.action` und nicht `configureLobby`: Letzteres
 * ist host-gesperrt, sein Team sucht sich aber jeder selbst aus. Die vier
 * Team-Aktionen stehen deshalb in `applyJeopardyAction` VOR der
 * Phasenprüfung – siehe den Kommentar dort.
 */

import { useState } from 'react';
import { membersOf, teamLabel } from '@shared/jeopardy/engine';
import type { JeopardyTeam } from '@shared/jeopardy/types';
import { api } from '../../net';
import { useStore } from '../../state/store';

function TeamCard({
  team,
  myTeamId,
  canRename,
}: {
  team: JeopardyTeam;
  myTeamId: string | undefined;
  canRename: boolean;
}) {
  const view = useStore((s) => s.jeopardy)!;
  const [draft, setDraft] = useState<string | null>(null);
  const members = membersOf(view, team.id);
  const mine = team.id === myTeamId;

  return (
    <li className={`jeo-team ${mine ? 'mine' : ''}`} style={{ borderLeftColor: team.color }}>
      <div className="jeo-team-head">
        {canRename ? (
          <input
            className="input small"
            maxLength={24}
            // Leer abschicken heißt „wieder aus den Mitgliedern ableiten".
            placeholder={teamLabel(view, team)}
            value={draft ?? team.name}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null && draft !== team.name) {
                api.action({ type: 'renameTeam', teamId: team.id, name: draft });
              }
              setDraft(null);
            }}
            aria-label={`Name von ${teamLabel(view, team)}`}
          />
        ) : (
          <strong>{teamLabel(view, team)}</strong>
        )}
        {!mine && (
          <button
            className="btn ghost small"
            onClick={() => api.action({ type: 'joinTeam', teamId: team.id })}
          >
            Beitreten
          </button>
        )}
      </div>
      <div className="jeo-team-members">
        {members.map((p) => (
          <span key={p.id} className="jeo-team-member">
            <span aria-hidden>{p.avatar}</span> {p.name}
          </span>
        ))}
        {members.length === 0 && <span className="hint">leer</span>}
      </div>
    </li>
  );
}

export function JeopardyLobbyTeams() {
  const view = useStore((s) => s.jeopardy);
  const session = useStore((s) => s.session);
  if (!view || view.phase !== 'lobby') return null;

  const me = view.players.find((p) => p.id === session?.playerId);
  // Der Moderator spielt nicht mit und steht in gar keinem Team.
  if (me?.moderator) {
    return (
      <p className="hint">
        🎙 Du moderierst – die Teams bilden die Mitspieler unter sich.
      </p>
    );
  }
  const alone = me ? membersOf(view, me.teamId).length === 1 : true;

  return (
    <div className="jeo-teams">
      <h3 className="setup-title">Teams</h3>
      <ul className="jeo-team-list">
        {view.teams.map((t) => (
          <TeamCard key={t.id} team={t} myTeamId={me?.teamId} canRename={t.id === me?.teamId} />
        ))}
      </ul>
      <div className="btn-row">
        <button className="btn small" disabled={alone} onClick={() => api.action({ type: 'newTeam' })}>
          ➕ Eigenes Team
        </button>
        {me?.isHost && (
          <button className="btn small" onClick={() => api.action({ type: 'splitTeams' })}>
            👥 Auf zwei Teams aufteilen
          </button>
        )}
      </div>
      <p className="hint">
        Punkte gehen aufs Team, gebuzzert wird weiter einzeln. Wer allein spielt,
        ist ein Team für sich – dann ist alles wie ohne Teams.
      </p>
    </div>
  );
}
