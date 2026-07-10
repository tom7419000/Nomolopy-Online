import { useEffect } from 'react';
import './net/socket';
import { useIsMyTurn, useStore } from './state/store';
import { AdminPanel } from './components/AdminPanel';
import { CardModal, DebugDialog, PropertyDialog, SavesDialog, TradeDialog } from './components/Dialogs';
import { GameTable } from './components/GameTable';
import { Lobby } from './components/Lobby';
import { StartScreen } from './components/StartScreen';
import { Toasts } from './components/Toasts';

export default function App() {
  const game = useStore((s) => s.game);
  const dialog = useStore((s) => s.dialog);
  const isMyTurn = useIsMyTurn();

  useEffect(() => {
    document.title = isMyTurn ? '🎲 Du bist dran! · Nomolopy' : 'Nomolopy Online';
  }, [isMyTurn]);

  let screen: React.ReactNode;
  if (!game) screen = <StartScreen />;
  else if (game.phase === 'lobby') screen = <Lobby />;
  else screen = <GameTable />;

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

      <Toasts />
    </>
  );
}
