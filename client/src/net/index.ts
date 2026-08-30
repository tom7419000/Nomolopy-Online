/**
 * Transport-Router.
 *
 * Die Spiel-Komponenten importieren ausschließlich von hier und wissen nicht,
 * ob ihre Aktionen über Socket.io an einen Server gehen oder von der Engine im
 * selben Browser-Tab beantwortet werden. Welcher Transport greift, entscheidet
 * sich pro Aufruf – ein Wechsel mitten in der Sitzung ist damit unproblematisch.
 */

import { resumeSocket, socketApi, type CreateRoomOptions, type SocketApi } from './socket';
import { localApi, restoreLocalGame } from './local';
import { getMode, setMode } from './mode';

export type { CreateRoomOptions };
export { getMode, setMode, isLocal } from './mode';
export { startLocalGame, isLocalRunning, type StartLocalOptions } from './local';

/** Wählt pro Aufruf die Implementierung des aktiven Transports. */
function route<K extends keyof SocketApi>(method: K): SocketApi[K] {
  return ((...args: unknown[]) => {
    const impl = getMode() === 'local' ? (localApi as Record<string, unknown>)[method as string] : socketApi[method];
    return (impl as (...a: unknown[]) => unknown)(...args);
  }) as SocketApi[K];
}

export const api: SocketApi = {
  createRoom: route('createRoom'),
  joinRoom: route('joinRoom'),
  leaveRoom: route('leaveRoom'),
  action: route('action'),
  chat: route('chat'),
  lobbyChat: route('lobbyChat'),
  kick: route('kick'),
  configureLobby: route('configureLobby'),
  rerollAppearance: route('rerollAppearance'),
  startGame: route('startGame'),
  rematch: route('rematch'),
  saveGame: route('saveGame'),
  listSaves: route('listSaves'),
  loadSave: route('loadSave'),
  deleteSave: route('deleteSave'),
  saveEdition: route('saveEdition'),
  deleteEdition: route('deleteEdition'),
  savePack: route('savePack'),
  deletePack: route('deletePack'),
};

// Eine unterbrochene lokale Partie hat Vorrang vor einer alten Online-Sitzung:
// Wer das Tablet zuklappt und wieder aufmacht, will weiterspielen.
//
// `mode.ts` hat den Modus schon beim Laden auf 'local' gestellt, falls ein
// Spielstand vorliegt – deshalb hat der Socket gar nicht erst verbunden.
// Scheitert die Wiederherstellung (leerer oder kaputter Eintrag), muss dieser
// Vorgriff zurückgenommen werden, sonst bliebe die App ohne Verbindung.
if (!restoreLocalGame() && getMode() === 'local') {
  setMode('online');
  resumeSocket();
}
