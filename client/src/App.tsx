import { useEffect } from 'react';
import './net';
import { useIsMyTurn, useStore } from './state/store';
import { navigate, roomHash, useHashRoute } from './hooks/useHashRoute';
import { Home } from './pages/Home';
import { JoinRoom } from './pages/JoinRoom';
import { RoomPage } from './pages/Room';
import { GameTable } from './games/monopoly/GameTable';
import { PokerTable } from './games/poker/PokerTable';
import { AdminPanel } from './games/monopoly/AdminPanel';
import { CardModal, DebugDialog, PropertyDialog, SavesDialog, TradeDialog } from './games/monopoly/Dialogs';
import { InstallBanner } from './components/InstallBanner';
import { Toasts } from './components/Toasts';

export default function App() {
  const room = useStore((s) => s.room);
  const isLocalGame = useStore((s) => s.session?.mode === 'local');
  const game = useStore((s) => s.game);
  const poker = useStore((s) => s.poker);
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

  const phase = game?.phase ?? poker?.phase ?? null;

  let screen: React.ReactNode;
  if (room && phase && phase !== 'lobby') {
    screen = game ? <GameTable /> : <PokerTable />;
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
      {dialog?.type === 'saves' && <SavesDialog />}
      {dialog?.type === 'debug' && game && <DebugDialog game={game} />}
      {dialog?.type === 'property' && game && <PropertyDialog game={game} tileId={dialog.tileId} />}
      {dialog?.type === 'trade' && game && <TradeDialog game={game} />}

      <InstallBanner />
      <Toasts />
    </>
  );
}
