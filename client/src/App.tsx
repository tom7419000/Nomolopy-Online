import { useEffect } from 'react';
import './net';
import { moduleFor } from '@shared/registry';
import { useIsMyTurn, useStore } from './state/store';
import { navigate, roomHash, useHashRoute } from './hooks/useHashRoute';
import { Home } from './pages/Home';
import { JoinRoom } from './pages/JoinRoom';
import { RoomPage } from './pages/Room';
import { CLIENT_GAMES } from './games/registry';
import { AdminPanel } from './games/monopoly/AdminPanel';
import { PackEditor } from './games/trivia/PackEditor';
import { CardModal, DebugDialog, PropertyDialog, SavesDialog, TradeDialog } from './games/monopoly/Dialogs';
import { InstallBanner } from './components/InstallBanner';
import { Toasts } from './components/Toasts';

export default function App() {
  const room = useStore((s) => s.room);
  const isLocalGame = useStore((s) => s.session?.mode === 'local');
  const game = useStore((s) => s.game);
  const dialog = useStore((s) => s.dialog);
  const isMyTurn = useIsMyTurn();
  const route = useHashRoute();

  useEffect(() => {
    // Lokal ist immer „jemand" dran (die Identität wandert mit dem Sitz) –
    // ein „Du bist dran" im Tab-Titel wäre dort dauerhaft und nichtssagend.
    if (isLocalGame) document.title = '📱 PlayHub – lokale Partie';
    else document.title = isMyTurn ? '🎲 Du bist dran! · PlayHub' : 'PlayHub – Spieleabend online';
  }, [isMyTurn, isLocalGame]);

  // URL mit dem Raum synchron halten (teilbare Links)
  useEffect(() => {
    // Lokale Räume bekommen KEINEN Link: der Code existiert auf keinem Server,
    // ein geteilter Link liefe bei allen anderen ins Leere.
    if (isLocalGame) return;
    if (room) {
      if (window.location.hash !== roomHash(room.meta.code)) navigate({ page: 'room', code: room.meta.code });
    } else if (route.page === 'room' && !useStore.getState().session) {
      // Raum verlassen → Link-Ansicht bleibt nur, wenn es eine fremde Einladung ist
    }
  }, [room, route.page, isLocalGame]);

  // Über die Registry statt über eine `??`-Kette: die hätte bei einem neuen
  // Spiel stumm `null` geliefert und die Partie in der Lobby festgehalten.
  const state = room ? room[room.meta.gameId] : null;
  const phase = state ? moduleFor(room!.meta.gameId).phase(state) : null;

  let screen: React.ReactNode;
  if (room && phase && phase !== 'lobby') {
    // Über die Registry statt über einen Ternary: ein unbekanntes Spiel
    // wäre sonst stumm als Poker gerendert und dort abgestürzt.
    const Table = CLIENT_GAMES[room.meta.gameId].Table;
    screen = <Table />;
  } else if (room) {
    screen = <RoomPage />;
  } else if (route.page === 'room') {
    screen = <JoinRoom code={route.code} />;
  } else {
    screen = <Home />;
  }

  return (
    <>
      {screen}

      {/* Karten-Modal hat Vorrang und ist nicht wegklickbar */}
      {game && game.phase === 'playing' && <CardModal game={game} />}

      {dialog?.type === 'admin' && <AdminPanel />}
      {dialog?.type === 'packs' && <PackEditor />}
      {dialog?.type === 'saves' && <SavesDialog />}
      {dialog?.type === 'debug' && game && <DebugDialog game={game} />}
      {dialog?.type === 'property' && game && <PropertyDialog game={game} tileId={dialog.tileId} />}
      {dialog?.type === 'trade' && game && <TradeDialog game={game} />}

      <InstallBanner />
      <Toasts />
    </>
  );
}
