/**
 * Transport-Router.
 *
 * Die Spiel-Komponenten importieren ausschließlich von hier und wissen nicht,
 * ob ihre Aktionen über Socket.io an einen Server gehen oder von der Engine im
 * selben Browser-Tab beantwortet werden.
 */

import { socketApi } from './socket';
import type { CreateRoomOptions } from './socket';

export type { CreateRoomOptions };
export { getMode, setMode, isLocal } from './mode';

export const api = socketApi;
