import { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import type { Card, GameState } from '../types';
import PlayerHand from './PlayerHand';
import FloorCards from './FloorCards';
import Scoreboard from './Scoreboard';
import BiddingPhase from './BiddingPhase';
import TossPhase from './TossPhase';

interface GameScreenProps {
  socket: Socket;
  userId: string;
  username: string;
  role: string;
  lobbyCode: string;
  onLeaveGame: () => void;
  onLogout: () => void;
}

function getCardValue(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return parseInt(card.rank, 10);
}

function findCapturableCards(card: Card, floor: Card[]): Card[] {
  const val = getCardValue(card);
  const direct = floor.filter(f => getCardValue(f) === val);
  if (direct.length > 0) return direct;
  const combo: Card[] = [];
  for (let i = 0; i < floor.length; i++)
    for (let j = i + 1; j < floor.length; j++)
      if (getCardValue(floor[i]) + getCardValue(floor[j]) === val) {
        if (!combo.includes(floor[i])) combo.push(floor[i]);
        if (!combo.includes(floor[j])) combo.push(floor[j]);
      }
  return combo;
}

export default function GameScreen({
  socket,
  userId,
  username,
  role,
  lobbyCode: initialLobbyCode,
  onLeaveGame,
  onLogout,
}: GameScreenProps) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [capturedCards, setCapturedCards] = useState<Card[]>([]);
  const [houseValue, setHouseValue] = useState<9 | 10 | 11 | 12 | 13 | 14 | null>(null);
  const [lobbyCode, setLobbyCode] = useState(initialLobbyCode);
  const [hand, setHand] = useState<Card[]>([]);
  const [isBidding, setIsBidding] = useState(true);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showGuide, setShowGuide] = useState(true);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), duration);
  };

  useEffect(() => {
    // Request initial card deal and game state sync
    if (lobbyCode) {
      socket.emit('request-deal', { lobbyCode });
    }

    socket.on('game-started', (data?: { lobbyCode?: string }) => {
      if (data?.lobbyCode) setLobbyCode(data.lobbyCode);
      setIsBidding(true);
    });

    socket.on('deal-cards', ({ lobbyCode: code, floor, hand: myHand, biddingPlayerIndex }: {
      lobbyCode: string; floor: Card[]; hand: Card[]; playerIndex: number; biddingPlayerIndex: number;
    }) => {
      setLobbyCode(code);
      setHand(myHand);
      setGameState({
        lobbyCode: code, floor, houses: [],
        currentPlayerIndex: biddingPlayerIndex, roundNumber: 1,
        teamScores: { team1: 0, team2: 0 }, capturedCards: { team1: [], team2: [] },
        seepCount: { team1: 0, team2: 0 }, gamePhase: 'bidding',
        firstTurnCompleted: [],
      });
      setIsBidding(true);
    });

    socket.on('game-state', (state: GameState) => {
      setGameState(state);
      if (state.gamePhase !== 'bidding') setIsBidding(false);
    });

    socket.on('bid-placed', ({ bid, playerId }: { bid: number; playerId: string }) => {
      setIsBidding(false);
      showToast(playerId === userId ? `You bid ${bid}. Game on!` : `Bid of ${bid} placed. Game on!`, 'success');
    });

    socket.on('seep-executed', ({ playerId }: { playerId: string }) => {
      showToast(playerId === userId ? '🌊 SEEP! You cleared the floor! +50 pts!' : '🌊 Seep! Opponent cleared the floor!', 'success', 4000);
    });

    socket.on('error-message', (data: { message: string }) => {
      showToast(`⚠️ ${data.message}`, 'error');
    });

    return () => {
      ['game-started','deal-cards','game-state','bid-placed','seep-executed','error-message'].forEach(e => socket.off(e));
    };
  }, [socket, userId]);

  const handleCardClick = (card: Card) => {
    setSelectedCard(card);
    setHouseValue(null);
    setCapturedCards(findCapturableCards(card, gameState?.floor || []));
  };

  const handleCapture = () => {
    if (!selectedCard || capturedCards.length === 0 || !lobbyCode) return;
    socket.emit('game-action', { lobbyCode, action: 'CAPTURE', payload: { card: selectedCard, targetCards: capturedCards } });
    setHand(prev => prev.filter(c => c.id !== selectedCard.id));
    setSelectedCard(null); setCapturedCards([]);
  };

  const handleThrow = () => {
    if (!selectedCard || !lobbyCode) return;
    socket.emit('game-action', { lobbyCode, action: 'THROW', payload: { card: selectedCard, targetCards: [] } });
    setHand(prev => prev.filter(c => c.id !== selectedCard.id));
    setSelectedCard(null); setCapturedCards([]);
  };

  const handleBuildHouse = () => {
    if (!selectedCard || !houseValue || !lobbyCode) return;
    socket.emit('game-action', { lobbyCode, action: 'BUILD_HOUSE', payload: { card: selectedCard, targetCards: capturedCards, houseValue } });
    setHand(prev => prev.filter(c => c.id !== selectedCard.id));
    setSelectedCard(null); setHouseValue(null); setCapturedCards([]);
  };

  if (gameState?.gamePhase === 'toss') {
    return <TossPhase gameState={gameState} userId={userId} />;
  }

  if (isBidding || gameState?.gamePhase === 'bidding') {
    return (
      <BiddingPhase
        socket={socket} userId={userId} lobbyCode={lobbyCode}
        hand={hand} floorCards={gameState?.floor || []}
        onBidComplete={() => setIsBidding(false)}
      />
    );
  }

  const opponentCards = Array(4).fill(null).map((_, i) => ({
    id: `opp-${i}`, suit: 'spades' as const, rank: '2' as const, pointValue: 0, faceDown: true
  }));

  const toastColors = {
    success: { bg: 'rgba(22,160,133,0.25)', border: 'rgba(22,160,133,0.5)', color: '#1abc9c' },
    error:   { bg: 'rgba(139,26,26,0.3)',   border: 'rgba(192,57,43,0.5)',  color: '#f1948a' },
    info:    { bg: 'rgba(22,48,32,0.6)',     border: 'rgba(212,175,55,0.3)', color: '#d4af37' },
  };

  return (
    <div className="relative w-full h-screen overflow-hidden felt-bg">
      {/* Table oval decoration */}
      <div className="absolute inset-[5%] sm:inset-[8%] rounded-[50%] table-oval pointer-events-none" />

      {/* Toast notifications */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.9 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold whitespace-nowrap pointer-events-none"
            style={{
              background: toastColors[toast.type].bg,
              border: `1px solid ${toastColors[toast.type].border}`,
              color: toastColors[toast.type].color,
              backdropFilter: 'blur(10px)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* User profile / Leave game buttons on top left */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2">
        <button
          onClick={onLeaveGame}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-black/40 border border-gold-500/25 hover:border-gold-500/50 text-white cursor-pointer"
          style={{ minHeight: '36px' }}
        >
          ← Lobby
        </button>

        <div className="relative">
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-black/40 border border-gold-500/25 hover:border-gold-500/50 text-white cursor-pointer"
            style={{ minHeight: '36px' }}
          >
            👤 <span className="hidden sm:inline text-gold-gradient">{username}</span>
          </button>
          
          <AnimatePresence>
            {showProfile && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute left-0 mt-2 w-48 rounded-xl p-4 shadow-xl z-50 text-left"
                style={{
                  background: 'rgba(9, 18, 11, 0.96)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(212, 175, 55, 0.3)',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.6)'
                }}
              >
                <div className="text-xs font-semibold text-gray-400 mb-1">User: {username}</div>
                <div className="text-xs font-semibold text-yellow-500 uppercase mb-3">Role: {role}</div>
                <button
                  onClick={onLogout}
                  className="w-full py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer"
                  style={{
                    background: 'rgba(139,26,26,0.3)',
                    border: '1px solid rgba(192,57,43,0.4)',
                    color: '#f1948a',
                    minHeight: '32px'
                  }}
                >
                  🚪 Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Scoreboard toggle (mobile) */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowScoreboard(!showScoreboard)}
        className="absolute top-3 right-3 z-30 w-10 h-10 rounded-xl flex items-center justify-center sm:hidden"
        style={{ background: 'rgba(9,18,11,0.85)', border: '1px solid rgba(212,175,55,0.3)', backdropFilter: 'blur(10px)' }}
      >
        <span className="text-lg">📊</span>
      </motion.button>

      {/* Desktop scoreboard (always visible) */}
      <div className="hidden sm:block">
        <Scoreboard
          team1Score={gameState?.teamScores.team1}
          team2Score={gameState?.teamScores.team2}
          round={gameState?.roundNumber}
          seepCount={gameState?.seepCount}
        />
      </div>

      {/* Dynamic Rules Guide Panel */}
      <div className="absolute top-6 right-6 z-40 hidden lg:block">
        <div className="glass-panel rounded-xl p-4 w-72" style={{ background: 'rgba(9,18,11,0.95)', border: '1px solid rgba(212,175,55,0.25)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-display tracking-widest uppercase text-gold-gradient font-bold">✦ Dynamic Guide</span>
            <button onClick={() => setShowGuide(!showGuide)} className="text-xs text-gold-gradient hover:underline bg-transparent border-0 cursor-pointer min-h-0 py-0 px-1">
              {showGuide ? 'Hide' : 'Show'}
            </button>
          </div>
          {showGuide && (
            <div className="text-[11px] leading-relaxed flex flex-col gap-2" style={{ color: 'rgba(245,240,232,0.75)' }}>
              <div className="divider-gold opacity-30" style={{ margin: '4px 0' }} />
              {gameState?.gamePhase === 'playing' && (
                <>
                  <p><strong>🎯 Goal:</strong> First team to 100 points wins.</p>
                  <p><strong>♠️ Spades:</strong> Spades count for face value (A=1, J=11, Q=12, K=13).</p>
                  <p><strong>♦️ Diamonds:</strong> 10♦ counts for 6 points. Other Aces = 1 point.</p>
                  <p><strong>🏠 Houses:</strong> Max 2 houses. Unlayered houses (Kacha) can be distorted by opponents. Layered houses (2+ cards or value 13) are cemented (Pukta).</p>
                  <p><strong>🌊 Seeps:</strong> Clearing the floor = +50 points. Seeps cancel out at round end.</p>
                  <p><strong>⏳ First Turn:</strong> Non-dealers start with 4 cards and receive remaining 8 after their first move.</p>
                </>
              )}
              {((gameState?.gamePhase as string) === 'bidding' || isBidding) && (
                <>
                  <p><strong>Bidding Phase:</strong> The starting dealer must declare a bid value (9–13) based on their first 4 cards.</p>
                  <p><strong>Redeal:</strong> If the dealer has no cards &ge; 9 in their hand, cards are redealt.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile scoreboard */}
      <div className="sm:hidden">
        <Scoreboard
          team1Score={gameState?.teamScores.team1}
          team2Score={gameState?.teamScores.team2}
          round={gameState?.roundNumber}
          seepCount={gameState?.seepCount}
          isOpen={showScoreboard}
          onClose={() => setShowScoreboard(false)}
        />
      </div>

      {/* Game layout */}
      <div className="relative w-full h-full flex flex-col items-center">
        {/* TOP — Opponent across */}
        <div className="absolute top-4 sm:top-6 left-0 right-0 flex justify-center">
          <PlayerHand cards={opponentCards} position="top" isOpponent label="Opponent" />
        </div>

        {/* LEFT — Partner (left side) */}
        <div className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2">
          <PlayerHand cards={opponentCards.slice(0, 3)} position="left" isOpponent label="Partner" />
        </div>

        {/* RIGHT — Opponent (right side) */}
        <div className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2">
          <PlayerHand cards={opponentCards.slice(0, 3)} position="right" isOpponent label="Opp." />
        </div>

        {/* CENTER — Floor cards */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ zIndex: 10 }}>
          <FloorCards
            cards={gameState?.floor || []}
            highlightedIds={capturedCards.map(c => c.id)}
          />
        </div>

        {/* BOTTOM — Player hand */}
        <div className="absolute bottom-28 sm:bottom-24 left-0 right-0 flex justify-center" style={{ zIndex: 20 }}>
          <PlayerHand
            cards={hand}
            position="bottom"
            selectedCard={selectedCard}
            onSelectCard={handleCardClick}
            label={userId}
          />
        </div>

        {/* ACTION BAR */}
        <div className="absolute bottom-0 left-0 right-0 z-30" style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
          <AnimatePresence>
            {selectedCard ? (
              <motion.div
                key="action-bar"
                initial={{ y: 80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 80, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="mx-2 sm:mx-4 mb-2 sm:mb-3 rounded-2xl overflow-hidden"
                style={{
                  background: 'rgba(9,18,11,0.92)',
                  border: '1px solid rgba(212,175,55,0.25)',
                  backdropFilter: 'blur(20px)',
                  boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
                }}
              >
                {/* Selected card info */}
                <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-display tracking-wide" style={{ color: 'rgba(212,175,55,0.7)' }}>
                      Selected: <span className="font-bold" style={{ color: '#d4af37' }}>
                        {selectedCard.rank} of {selectedCard.suit}
                      </span>
                    </span>
                    {capturedCards.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: 'rgba(22,160,133,0.2)', border: '1px solid rgba(22,160,133,0.4)', color: '#1abc9c' }}>
                        Can capture {capturedCards.length}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => { setSelectedCard(null); setCapturedCards([]); setHouseValue(null); }}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                    style={{ background: 'rgba(139,26,26,0.3)', border: '1px solid rgba(192,57,43,0.4)', color: '#f1948a', minHeight: 'auto' }}
                  >
                    ×
                  </button>
                </div>

                {/* Action buttons */}
                <div className="p-3 flex flex-wrap gap-2 items-center">
                  {/* Capture */}
                  {capturedCards.length > 0 && (
                    <motion.button whileTap={{ scale: 0.94 }} onClick={handleCapture}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold font-display tracking-wide"
                      style={{ background: 'rgba(22,160,133,0.25)', border: '1px solid rgba(22,160,133,0.5)', color: '#1abc9c' }}>
                      ⚡ Capture
                    </motion.button>
                  )}

                  {/* Throw */}
                  <motion.button whileTap={{ scale: 0.94 }} onClick={handleThrow}
                    disabled={!!houseValue}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold font-display tracking-wide disabled:opacity-40"
                    style={{ background: 'rgba(52,73,94,0.4)', border: '1px solid rgba(100,149,200,0.3)', color: 'rgba(245,240,232,0.7)' }}>
                    ↑ Throw
                  </motion.button>

                  {/* House builder */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs" style={{ color: 'rgba(245,240,232,0.35)' }}>Build:</span>
                    {[9, 10, 11, 12, 13, 14].map(v => (
                      <motion.button key={v} whileTap={{ scale: 0.88 }}
                        onClick={() => setHouseValue(houseValue === v ? null : v as any)}
                        className="w-8 h-8 rounded-lg font-display font-bold text-xs"
                        style={{
                          minHeight: 'auto',
                          background: houseValue === v ? 'rgba(212,175,55,0.3)' : 'rgba(0,0,0,0.4)',
                          border: `1px solid ${houseValue === v ? 'rgba(212,175,55,0.6)' : 'rgba(212,175,55,0.15)'}`,
                          color: houseValue === v ? '#d4af37' : 'rgba(245,240,232,0.5)',
                          boxShadow: houseValue === v ? '0 0 10px rgba(212,175,55,0.2)' : 'none',
                        }}>
                        {v === 14 ? 'A' : v === 11 ? 'J' : v === 12 ? 'Q' : v === 13 ? 'K' : v}
                      </motion.button>
                    ))}
                    {houseValue && (
                      <motion.button whileTap={{ scale: 0.94 }} onClick={handleBuildHouse}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold font-display btn-gold"
                        style={{ minHeight: 'auto' }}>
                        ✦ Build {houseValue === 14 ? 'A' : houseValue === 11 ? 'J' : houseValue === 12 ? 'Q' : houseValue === 13 ? 'K' : houseValue}
                      </motion.button>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="hint-bar"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                className="mx-2 sm:mx-4 mb-2 sm:mb-3 px-4 py-2 rounded-xl flex items-center justify-center gap-3"
                style={{ background: 'rgba(9,18,11,0.7)', border: '1px solid rgba(212,175,55,0.1)', backdropFilter: 'blur(10px)' }}
              >
                <span className="text-xs" style={{ color: 'rgba(245,240,232,0.35)' }}>
                  {hand.length > 0 ? '👆 Tap a card in your hand to play' : '⏳ Waiting for your cards...'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}