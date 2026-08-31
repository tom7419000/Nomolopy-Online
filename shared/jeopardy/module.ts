/**
 * Jeopardy als Plattform-Modul.
 *
 * Wie bei Monopoly und Poker nur ein Adapter – `engine.ts` bleibt frei von
 * Plattform-Wissen.
 *
 * Die Besonderheit gegenüber den beiden anderen: Jeopardy braucht INHALT zur
 * Laufzeit. Das Fragenpaket steckt bewusst nicht im Zustand (siehe
 * `types.ts`), also reicht die Plattform `GameDeps` bis in `start`, `apply`
 * und den Rematch durch. Genau dafür stehen sie im Vertrag.
 */

import {
  addJeopardyChat,
  addJeopardyPlayer,
  applyJeopardyAction,
  createJeopardy,
  getJeopardyPlayer,
  jeopardyDeadline,
  jeopardyLog,
  jeopardyTick,
  jeopardyView,
  localAdjustJeopardy,
  removeJeopardyLobbyPlayer,
  resetJeopardyToLobby,
  startJeopardy,
} from './engine';
import { sanitizeJeopardyRules } from './rules';
import type { JeopardyAction, JeopardyRules, JeopardyState } from './types';
import type { TriviaPack } from '../trivia/types';
import type { GameDeps, GameModule, SeatInfo } from '../registry';

/**
 * Das Paket dieser Partie – exakt, ohne Ersatz.
 *
 * Ein stiller Rückfall auf „irgendein anderes Paket" wäre falsch: die schon
 * gestellten Fragen stammen aus dem ursprünglichen, ihre IDs fänden sich im
 * Ersatzpaket nicht wieder. Fehlt es, sagt die Engine das lieber.
 */
function packOf(s: JeopardyState, deps: GameDeps): TriviaPack | null {
  return deps.packs().find((p) => p.id === s.rules.packId) ?? null;
}

function seatOf(p: JeopardyState['players'][number]): SeatInfo {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    isHost: p.isHost,
    connected: p.connected,
    // Bei Jeopardy scheidet niemand aus – ein Minuspunktestand ist kein Aus.
    eliminated: false,
    avatar: p.avatar,
    moderator: p.moderator,
  };
}

export const jeopardyModule: GameModule<'jeopardy'> = {
  id: 'jeopardy',

  create(code, config, deps, now) {
    const rules = sanitizeJeopardyRules({
      ...((config.jeopardy ?? config.jeopardyRules ?? {}) as object),
      // Ob moderiert wird, entscheidet der „Raum erstellen"-Dialog, nicht
      // eine Regel, die sich später umstellen ließe: der Moderator wird beim
      // ersten `addPlayer` markiert und bliebe es sonst nicht.
      moderated: Boolean(config.moderate),
    });
    // Beim Anlegen darf ein unbekanntes Paket noch ersetzt werden – ab jetzt
    // ist die Wahl fest.
    const packs = deps.packs();
    if (!packs.some((p) => p.id === rules.packId)) {
      rules.packId = packs[0]?.id ?? rules.packId;
    }
    return createJeopardy(code, rules, now);
  },

  addPlayer(s, id, name, isHost) {
    return addJeopardyPlayer(s, id, name, isHost);
  },

  removeLobbyPlayer(s, id) {
    removeJeopardyLobbyPlayer(s, id);
  },

  start(s, deps, now) {
    return startJeopardy(s, packOf(s, deps), now);
  },

  resetForRematch(s, ctx) {
    // Getrennte fliegen raus, Zuschauer rücken nach – wie bei Poker.
    s.players = s.players.filter((p) => p.connected);
    resetJeopardyToLobby(s);
    if (s.players.length > 0 && !s.players.some((p) => p.isHost)) s.players[0].isHost = true;
    for (const spec of ctx.spectators) {
      if (s.players.length >= ctx.maxPlayers) break;
      addJeopardyPlayer(s, spec.id, spec.name, s.players.length === 0);
      ctx.onSeated(spec.id);
    }
  },

  phase(s) {
    return s.phase;
  },

  seats(s) {
    return s.players.map(seatOf);
  },

  /**
   * Wer gerade handeln DARF.
   *
   * Bei Jeopardy ist das oft NIEMAND im Sinne eines einzelnen Sitzes: beim
   * Buzzern dürfen alle, beim Werten alle außer einem. `null` ist dort die
   * ehrliche Antwort – der Buzzer-Bildschirm und die Wertungsknöpfe hängen
   * an `clue.step`, nicht an „du bist dran".
   */
  activeSeatId(s) {
    if (s.phase !== 'playing') return null;
    // Der Moderator ist nie „dran": er führt durch die Sendung, er spielt
    // nicht mit. Deshalb bleibt der Picker die Anzeige – auch moderiert, wo
    // er nur sagt, welches Feld er sich wünscht.
    const picker = s.players[s.pickerIndex];
    if (!s.clue) return picker?.moderator ? null : picker?.id ?? null;
    if (s.clue.step === 'answering') return s.clue.answererId;
    if (s.clue.step === 'revealed') return picker?.moderator ? null : picker?.id ?? null;
    return null;
  },

  setConnected(s, id, connected) {
    const p = getJeopardyPlayer(s, id);
    if (p) p.connected = connected;
  },

  transferHost(s, fromId) {
    const leaving = getJeopardyPlayer(s, fromId);
    if (!leaving?.isHost) return null;
    const next = s.players.find((p) => p.connected && p.id !== fromId);
    if (!next) return null;
    leaving.isHost = false;
    next.isHost = true;
    return seatOf(next);
  },

  apply(s, playerId, action, deps, now) {
    return applyJeopardyAction(s, playerId, action as JeopardyAction, packOf(s, deps), now);
  },

  chat(s, author, text) {
    return addJeopardyChat(s, author, text);
  },

  messages(s) {
    return s.chat;
  },

  systemLog(s, text, playerId) {
    jeopardyLog(s, 'system', text, playerId);
  },

  configure(s, patch, deps) {
    const p = patch.jeopardy ?? patch.jeopardyRules;
    if (!p || typeof p !== 'object') return;
    const merged = sanitizeJeopardyRules({ ...s.rules, ...(p as Partial<JeopardyRules>) });
    // Ein Paket, das es nicht gibt, wird nicht übernommen – sonst ließe sich
    // der Raum in einen unstartbaren Zustand konfigurieren.
    if (!deps.packs().some((x) => x.id === merged.packId)) merged.packId = s.rules.packId;
    s.rules = merged;
  },

  redact: (s) => jeopardyView(s),
  /**
   * Einheitlich redigiert: die Antwort ist vor ALLEN verborgen, nicht nur
   * vor manchen. Der Server serialisiert deshalb einmal statt pro Empfänger.
   * Erst Final Jeopardy mit verdeckten Einsätzen bräuchte den teuren Pfad.
   */
  redactPerViewer: false,

  deadline(s) {
    return jeopardyDeadline(s);
  },

  tick(s, deps, now) {
    // Auch die Uhr braucht das Paket: läuft die Buzzer-Zeit ab, ohne dass
    // jemand gedrückt hat, wird die richtige Antwort aufgelöst.
    return jeopardyTick(s, now, packOf(s, deps));
  },

  localAdjust(s, now) {
    localAdjustJeopardy(s, now);
  },

  caps: {
    // Das ist der ganze Witz des Mehrgeräte-Betriebs: ein Zuschauer ist der
    // große Bildschirm, auf dem das Brett steht.
    spectators: true,
    saveLoad: false,
    rejoinByName: true,
    rotatesToActor: false,
  },
};
