import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import type { Card, GameState, House } from '../types';
import PlayerHand from './PlayerHand';
import FloorCards from './FloorCards';
import Scoreboard from './Scoreboard';
import BiddingPhase from './BiddingPhase';
import TossPhase from './TossPhase';
import PlayingCard from './PlayingCard';

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

function groupHouseCards(cards: Card[], targetValue: number): Card[][] {
  const result: Card[][] = [];
  const remaining = [...cards];

  const findAndRemoveSubset = (): boolean => {
    let foundPath: Card[] | null = null;
    const search = (startIndex: number, currentSum: number, path: Card[]): boolean => {
      if (currentSum === targetValue) {
        foundPath = [...path];
        return true;
      }
      if (currentSum > targetValue) {
        return false;
      }
      for (let i = startIndex; i < remaining.length; i++) {
        const card = remaining[i];
        const val = getCardValue(card);
        path.push(card);
        if (search(i + 1, currentSum + val, path)) {
          return true;
        }
        path.pop();
      }
      return false;
    };

    if (search(0, 0, [])) {
      if (foundPath) {
        (foundPath as Card[]).forEach(c => {
          const idx = remaining.findIndex(rc => rc.id === c.id);
          if (idx !== -1) remaining.splice(idx, 1);
        });
        result.push(foundPath);
        return true;
      }
    }
    return false;
  };

  while (remaining.length > 0) {
    const found = findAndRemoveSubset();
    if (!found) {
      remaining.forEach(c => result.push([c]));
      break;
    }
  }

  return result;
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

const suitSymbol = (suit: string) => {
  if (suit === 'hearts') return '♥';
  if (suit === 'diamonds') return '♦';
  if (suit === 'clubs') return '♣';
  return '♠';
};

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
  const [houseValue, setHouseValue] = useState<9 | 10 | 11 | 12 | 13 | null>(null);
  const [lobbyCode, setLobbyCode] = useState(initialLobbyCode);
  const [hand, setHand] = useState<Card[]>([]);
  const [isBidding, setIsBidding] = useState(true);
  const [teamNames, setTeamNames] = useState<{ team1: string; team2: string }>({ team1: 'Team 1', team2: 'Team 2' });
  const [notifications, setNotifications] = useState<{ id: number; msg: string; type: 'success' | 'error' | 'info' | 'move' | 'seep'; card?: Card }[]>([]);
  const notifId = useRef(0);
  const [showProfile, setShowProfile] = useState(false);
  const [showGuide, setShowGuide] = useState(false); // Rules hidden by default
  const [lastMoveVisual, setLastMoveVisual] = useState<any | null>(null);
  const [houseActionPrompt, setHouseActionPrompt] = useState<{ card: Card; house: House; floorCards: Card[] } | null>(null);

  const playersRef = useRef(gameState?.players);
  useEffect(() => {
    playersRef.current = gameState?.players;
  }, [gameState?.players]);

  const addNotification = (msg: string, type: 'success' | 'error' | 'info' | 'move' | 'seep' = 'info', duration = 3500, card?: Card) => {
    const id = ++notifId.current;
    setNotifications(prev => [...prev.slice(-4), { id, msg, type, card }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), duration);
  };

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000) => {
    addNotification(msg, type, duration);
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
      setGameState(prev => {
        if (prev && prev.lobbyCode === code) return prev;
        return {
          lobbyCode: code, floor, houses: [],
          currentPlayerIndex: biddingPlayerIndex, roundNumber: 1,
          teamScores: { team1: 0, team2: 0 }, capturedCards: { team1: [], team2: [] },
          seepCount: { team1: 0, team2: 0 }, gamePhase: 'bidding',
          firstTurnCompleted: [],
          handSizes: {},
          players: [],
          deck: [],
        };
      });
      setIsBidding(true);
    });

    socket.on('game-state', (state: GameState) => {
      setGameState(state);
      if (state.gamePhase !== 'bidding') setIsBidding(false);
    });

    socket.on('teams-updated', ({ teamNames: tn }: { teamNames: { team1: string; team2: string } }) => {
      setTeamNames(tn);
    });

    socket.on('bid-placed', ({ bid, playerId }: { bid: number; playerId: string }) => {
      const bidderName = playerId === userId ? 'You' : (playersRef.current?.find(p => p.id === playerId)?.username || playerId);
      showToast(`📢 ${bidderName} placed a bid of ${bid}!`, 'success');
      setIsBidding(false);
    });

    socket.on('seep-executed', ({ playerId }: { playerId: string }) => {
      const seepName = playerId === userId ? 'You' : (playersRef.current?.find(p => p.id === playerId)?.username || playerId);
      addNotification(`🌊 SEEP by ${seepName}! +50 pts!`, 'seep', 5000);
    });

    socket.on('toast-message', ({ message }: { message: string }) => {
      addNotification(message, 'info', 4000);
    });

    socket.on('move-executed', ({ playerId: pid, username: name, action, card, targetCards: targets, houseValue: hVal }) => {
      let msg = '';
      const cardStr = `${card.rank}${suitSymbol(card.suit)}`;
      const displayName = pid === userId ? 'You' : name;
      
      if (action === 'BID') {
        msg = `📢 ${displayName} bid ${hVal} using [${cardStr}]`;
      } else if (action === 'THROW') {
        msg = `📤 ${displayName} threw [${cardStr}]`;
      } else if (action === 'CAPTURE') {
        const tStr = targets.map((c: Card) => `${c.rank}${suitSymbol(c.suit)}`).join(', ');
        msg = `✨ ${displayName} captured [${tStr}] with [${cardStr}]`;
      } else if (action === 'BUILD_HOUSE') {
        const tStr = targets.map((c: Card) => `${c.rank}${suitSymbol(c.suit)}`).join(', ');
        msg = `🏠 ${displayName} built house-${hVal} with [${cardStr}]+[${tStr}]`;
      }
      
      addNotification(msg, 'move', 3500, card);
      if (action === 'BUILD_HOUSE' || action === 'CAPTURE') {
        setLastMoveVisual({
          playedCard: card,
          targetCards: targets || [],
          action,
          value: hVal,
          player: displayName,
        });
        setTimeout(() => {
          setLastMoveVisual(null);
        }, 2200);
      }
    });

    socket.on('error-message', (data: { message: string }) => {
      addNotification(data.message, 'error', 4000);
      if (lobbyCode) {
        socket.emit('request-deal', { lobbyCode });
      }
    });

    return () => {
      ['game-started', 'deal-cards', 'game-state', 'teams-updated', 'bid-placed', 'seep-executed', 'toast-message', 'move-executed', 'error-message'].forEach(e => socket.off(e));
    };
  }, [socket, userId, lobbyCode]); // gameState removed to prevent infinite listener re-binding / flickering!

  const performHouseAction = (actionType: 'CAPTURE' | 'CONTRIBUTE', playedCard: Card, targetHouse: House, floorCards: Card[]) => {
    if (!lobbyCode) return;
    const playedVal = getCardValue(playedCard);
    const cleanFloorCards = floorCards.filter(fc => !targetHouse.cards.some(hc => hc.id === fc.id));
    const floorSum = cleanFloorCards.reduce((sum, c) => sum + getCardValue(c), 0);

    if (actionType === 'CAPTURE') {
      socket.emit('game-action', {
        lobbyCode,
        action: 'CAPTURE',
        payload: { card: playedCard, targetCards: targetHouse.cards }
      });
    } else {
      // Contribution or Distortion
      const newDistortedValue = playedVal + targetHouse.value + floorSum;
      const isStacking = playedVal + floorSum === targetHouse.value;

      if (isStacking) {
        socket.emit('game-action', {
          lobbyCode,
          action: 'BUILD_HOUSE',
          payload: {
            card: playedCard,
            targetCards: [...targetHouse.cards, ...cleanFloorCards],
            houseValue: targetHouse.value
          }
        });
      } else {
        socket.emit('game-action', {
          lobbyCode,
          action: 'BUILD_HOUSE',
          payload: {
            card: playedCard,
            targetCards: [...targetHouse.cards, ...cleanFloorCards],
            houseValue: newDistortedValue
          }
        });
      }
    }
    setHand(prev => prev.filter(c => c.id !== playedCard.id));
    setSelectedCard(null);
    setCapturedCards([]);
    setHouseActionPrompt(null);
  };

  const executeHouseAction = (playedCard: Card, targetHouse: House, floorCards: Card[]) => {
    setHouseActionPrompt({ card: playedCard, house: targetHouse, floorCards });
  };

  // Drag and Drop handlers — cap house sum at 13
  const handleDragStart = (e: React.DragEvent, card: Card) => {
    e.dataTransfer.setData('cardId', card.id);
  };

  const handleDropOnCard = (e: React.DragEvent, targetCard: Card) => {
    e.preventDefault();
    e.stopPropagation();
    const cardId = e.dataTransfer.getData('cardId');
    const playedCard = hand.find(c => c.id === cardId);
    if (!playedCard || !lobbyCode) return;

    const playedVal = getCardValue(playedCard);
    const targetVal = getCardValue(targetCard);
    const sum = playedVal + targetVal;

    if (playedVal === targetVal) {
      socket.emit('game-action', { lobbyCode, action: 'CAPTURE', payload: { card: playedCard, targetCards: [targetCard] } });
      setHand(prev => prev.filter(c => c.id !== playedCard.id));
    } else if (sum >= 9 && sum <= 13) {
      socket.emit('game-action', { lobbyCode, action: 'BUILD_HOUSE', payload: { card: playedCard, targetCards: [targetCard], houseValue: sum } });
      setHand(prev => prev.filter(c => c.id !== playedCard.id));
    } else {
      socket.emit('game-action', { lobbyCode, action: 'THROW', payload: { card: playedCard, targetCards: [] } });
      setHand(prev => prev.filter(c => c.id !== playedCard.id));
    }
  };

  const handleDropOnHouse = (e: React.DragEvent, targetHouse: House) => {
    e.preventDefault();
    e.stopPropagation();
    const cardId = e.dataTransfer.getData('cardId');
    const playedCard = hand.find(c => c.id === cardId);
    if (!playedCard || !lobbyCode) return;

    executeHouseAction(playedCard, targetHouse, capturedCards);
  };

  const handleDropOnBoard = (e: React.DragEvent) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData('cardId');
    const playedCard = hand.find(c => c.id === cardId);
    if (!playedCard || !lobbyCode) return;

    socket.emit('game-action', { 
      lobbyCode, 
      action: 'THROW', 
      payload: { card: playedCard, targetCards: [] } 
    });
    setHand(prev => prev.filter(c => c.id !== playedCard.id));
  };

  const handleCardClick = (card: Card) => {
    const isFromHand = hand.some(c => c.id === card.id);
    if (isFromHand) {
      setSelectedCard(card);
      setHouseValue(null);
      setCapturedCards(findCapturableCards(card, gameState?.floor || []));
    } else {
      if (selectedCard) {
        setCapturedCards(prev => {
          if (prev.some(c => c.id === card.id)) {
            return prev.filter(c => c.id !== card.id);
          } else {
            return [...prev, card];
          }
        });
      }
    }
  };

  const handleHouseClick = (house: House) => {
    if (!selectedCard || !lobbyCode) return;
    executeHouseAction(selectedCard, house, capturedCards);
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

  const handleRespondAbove8 = (answer: boolean) => {
    socket.emit('respond-above-8', { lobbyCode, answer });
  };

  if (gameState?.gamePhase === 'toss') {
    return <TossPhase gameState={gameState} userId={userId} />;
  }

  // Verification Dialog for "Ask Caller if has card above 8"
  const isCaller = gameState?.players[0]?.id === userId;
  if (gameState?.askAbove8) {
    return (
      <div className="w-full h-screen overflow-hidden felt-bg flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-6 rounded-2xl border text-center shadow-2xl max-w-md w-full"
          style={{ background: 'rgba(9, 18, 11, 0.96)', borderColor: 'rgba(212,175,55,0.35)' }}
        >
          <div className="text-4xl mb-3">🃏</div>
          <h2 className="font-display text-lg font-bold text-gold-gradient mb-2">Dealer Verification</h2>
          <p className="text-xs mb-6 leading-relaxed" style={{ color: 'rgba(245,240,232,0.7)' }}>
            The dealer asks: Do you have at least one card above 8 (9, 10, J, Q, K) in your initial 4 cards?
          </p>

          {isCaller ? (
            <div className="flex flex-col gap-4">
              {/* Show caller their first 4 cards for their context */}
              <div className="flex gap-2 justify-center mb-2">
                {hand.slice(0, 4).map(c => (
                  <PlayingCard key={c.id} card={c} size="sm" />
                ))}
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => handleRespondAbove8(true)}
                  className="flex-1 btn-gold py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest"
                >
                  Yes (I have one)
                </button>
                <button
                  onClick={() => handleRespondAbove8(false)}
                  className="flex-1 py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest text-emerald-100 bg-emerald-950/40 border border-emerald-800/40 hover:border-emerald-600"
                >
                  No (Redeal)
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gold mb-3" />
              <p className="text-xs" style={{ color: 'rgba(245,240,232,0.5)' }}>
                Waiting for the caller ({gameState.players[0]?.username}) to reply to the dealer...
              </p>
            </div>
          )}
        </motion.div>
      </div>
    );
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

  // Rotated Seat calculations (fixes duplicate player / RR name bug)
  const myPlayer = gameState?.players.find(p => p.id === userId);
  const mySeat = myPlayer?.seat || 1;

  const leftSeat = (mySeat % 4) + 1;
  const partnerSeat = ((mySeat + 1) % 4) + 1;
  const rightSeat = ((mySeat + 2) % 4) + 1;

  const leftPlayer = gameState?.players.find(p => p.seat === leftSeat);
  const partnerPlayer = gameState?.players.find(p => p.seat === partnerSeat);
  const rightPlayer = gameState?.players.find(p => p.seat === rightSeat);

  const leftHandSize = gameState?.handSizes[leftPlayer?.id || ''] || 4;
  const partnerHandSize = gameState?.handSizes[partnerPlayer?.id || ''] || 4;
  const rightHandSize = gameState?.handSizes[rightPlayer?.id || ''] || 4;

  const leftUsername = leftPlayer?.username || 'Opponent (L)';
  const partnerUsername = partnerPlayer?.username || 'Partner';
  const rightUsername = rightPlayer?.username || 'Opponent (R)';

  const leftHandCards = Array(leftHandSize).fill(null).map((_, i) => ({
    id: `opp-l-${i}`, suit: 'spades' as const, rank: '2' as const, pointValue: 0, faceDown: true
  }));
  const partnerHandCards = Array(partnerHandSize).fill(null).map((_, i) => ({
    id: `opp-t-${i}`, suit: 'spades' as const, rank: '2' as const, pointValue: 0, faceDown: true
  }));
  const rightHandCards = Array(rightHandSize).fill(null).map((_, i) => ({
    id: `opp-r-${i}`, suit: 'spades' as const, rank: '2' as const, pointValue: 0, faceDown: true
  }));

  const notifColors: Record<string, { bg: string; border: string; color: string }> = {
    success: { bg: 'rgba(22,160,133,0.2)',  border: 'rgba(22,160,133,0.5)',  color: '#1abc9c' },
    error:   { bg: 'rgba(139,26,26,0.35)',  border: 'rgba(192,57,43,0.55)',  color: '#f1948a' },
    info:    { bg: 'rgba(22,48,32,0.7)',    border: 'rgba(212,175,55,0.35)', color: '#d4af37' },
    move:    { bg: 'rgba(9,18,11,0.9)',     border: 'rgba(212,175,55,0.4)',  color: '#f5d78e' },
    seep:    { bg: 'rgba(15,40,80,0.85)',   border: 'rgba(100,160,255,0.6)', color: '#7ec8ff' },
  };

  return (
    <div className="relative w-full h-screen overflow-hidden felt-bg flex flex-col">
      {/* Sleek horizontal Scoreboard header at the top */}
      <Scoreboard
        team1Score={gameState?.teamScores.team1}
        team2Score={gameState?.teamScores.team2}
        round={gameState?.roundNumber}
        seepCount={gameState?.seepCount}
        teamNames={teamNames}
      />

      {/* Floating Menu Toggle Button */}
      <div className="absolute top-16 left-4 z-40">
        <button
          onClick={() => setShowProfile(!showProfile)}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all bg-black/40 border border-emerald-800/40 hover:border-gold"
        >
          <span className="text-sm">👤</span>
        </button>
      </div>

      {/* Profile/Menu overlay */}
      <AnimatePresence>
        {showProfile && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute top-28 left-4 z-40 p-4 rounded-xl border w-60 text-left shadow-2xl"
            style={{ background: 'rgba(9,18,11,0.95)', borderColor: 'rgba(212,175,55,0.25)' }}
          >
            <div className="mb-2">
              <h3 className="font-display font-bold text-gold-gradient text-sm">{username}</h3>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(245,240,232,0.4)' }}>
                {role} • Team {(gameState?.players.find(p => p.id === userId)?.team) || 1}
              </p>
            </div>
            <div className="divider-gold opacity-20 my-2" />
            <button
              onClick={onLeaveGame}
              className="w-full text-left py-1.5 text-xs text-rose-400 hover:text-rose-300 font-semibold"
            >
              🚪 Leave Room
            </button>
            <button
              onClick={onLogout}
              className="w-full text-left py-1.5 text-xs text-emerald-100/50 hover:text-emerald-100/70"
            >
              🚪 Logout
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stacked notification feed — top-center, no overlap */}
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-1.5 items-center pointer-events-none" style={{ minWidth: '240px', maxWidth: '90vw' }}>
        <AnimatePresence mode="popLayout">
          {notifications.map(n => (
            <motion.div
              key={n.id}
              layout
              initial={{ y: -24, opacity: 0, scale: 0.92 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="px-4 py-2 rounded-xl text-xs font-semibold tracking-wide shadow-xl border backdrop-blur-md flex items-center gap-2 text-center w-full"
              style={notifColors[n.type] || notifColors.info}
            >
              <span className="flex-1">{n.msg}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Dynamic Rules Guide Panel */}
      <div className="absolute top-16 right-4 z-40 hidden lg:block">
        <motion.div
          drag
          dragMomentum={false}
          className="glass-panel rounded-xl p-4 w-72 select-none"
          style={{
            background: 'rgba(9,18,11,0.95)',
            border: '1px solid rgba(212,175,55,0.25)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing">
              <span className="text-[10px] opacity-50">✥</span>
              <span className="text-xs font-display tracking-widest uppercase text-gold-gradient font-bold">Rules Guide</span>
            </div>
            <button onClick={() => setShowGuide(!showGuide)} className="text-xs text-gold-gradient hover:underline bg-transparent border-0 cursor-pointer min-h-0 py-0 px-1 font-bold">
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
        </motion.div>
      </div>

      {/* Felt Board Dropzone for Throwing */}
      <div 
        className="relative w-full flex-1 flex flex-col items-center justify-center overflow-hidden felt-table"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnBoard}
      >
        {/* Table oval decoration */}
        <div className="absolute inset-[5%] sm:inset-[8%] rounded-[50%] table-oval pointer-events-none" />

        {/* TOP — Partner across (in front) */}
        <div className="absolute top-4 sm:top-6 left-0 right-0 flex justify-center">
          <PlayerHand
            cards={partnerHandCards}
            position="top"
            isOpponent
            label={`${partnerUsername} 🤝 Partner`}
          />
        </div>

        {/* LEFT — Opponent (left side) */}
        <div className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2">
          <PlayerHand cards={leftHandCards} position="left" isOpponent label={leftUsername} />
        </div>

        {/* RIGHT — Opponent (right side) */}
        <div className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2">
          <PlayerHand cards={rightHandCards} position="right" isOpponent label={rightUsername} />
        </div>

        {/* CENTER — Table Floor (Loose Cards & Houses) */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-5 sm:gap-6 items-center justify-center z-10 w-full max-w-2xl px-4">
          {/* Last Move Visual Animation Overlay */}
          <AnimatePresence>
            {lastMoveVisual && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 bg-emerald-950/95 border border-gold/30 rounded-2xl flex flex-col items-center justify-center shadow-2xl z-30 p-4"
                style={{ backdropFilter: 'blur(8px)' }}
              >
                <span className="text-[10px] uppercase tracking-widest text-gold-gradient font-bold mb-3">
                  ⚡ {lastMoveVisual.player}'s Move
                </span>
                
                <div className="flex items-center gap-4 sm:gap-6">
                  {/* Target Cards */}
                  {lastMoveVisual.targetCards.length > 0 ? (
                    <div className="flex -space-x-3 bg-black/20 p-2 rounded-xl border border-emerald-800/20">
                      {lastMoveVisual.targetCards.map((c: Card) => (
                        <div key={c.id}>
                          <PlayingCard card={c} size="md" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 italic bg-black/20 p-4 rounded-xl border border-emerald-800/10">Empty Table</div>
                  )}

                  {/* Action Arrow */}
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-gold-gradient font-bold text-xl leading-none">➔</span>
                    <span className="text-[8px] font-bold tracking-widest uppercase text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded-full border border-emerald-800/30">
                      {lastMoveVisual.action === 'BUILD_HOUSE' ? 'BUILD' : 'CAPTURE'}
                    </span>
                  </div>

                  {/* Played Card Overlay */}
                  <div className="relative">
                    <PlayingCard card={lastMoveVisual.playedCard} size="md" className="border-2 border-gold shadow-lg" />
                    {lastMoveVisual.value !== undefined && (
                      <div className="absolute -top-2.5 -right-2.5 bg-gold text-emerald-950 text-[10px] font-bold rounded-full w-6 h-6 flex items-center justify-center border border-emerald-900 shadow font-display">
                        {lastMoveVisual.value}
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-xs text-gray-300 mt-4 text-center font-display max-w-xs">
                  {lastMoveVisual.action === 'BUILD_HOUSE'
                    ? `Played [${lastMoveVisual.playedCard.rank}${suitSymbol(lastMoveVisual.playedCard.suit)}] to build House of ${lastMoveVisual.value}`
                    : `Played [${lastMoveVisual.playedCard.rank}${suitSymbol(lastMoveVisual.playedCard.suit)}] to capture floor cards`
                  }
                </p>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Loose Floor Cards — only show when there are actually loose cards */}
          {(gameState?.floor?.length ?? 0) > 0 ? (
            <div className="flex flex-col items-center">
              <span className="text-[9px] sm:text-[10px] uppercase tracking-widest text-emerald-300/30 mb-1">Open Played Cards</span>
              <FloorCards
                cards={gameState?.floor || []}
                highlightedIds={capturedCards.map(c => c.id)}
                onCardClick={handleCardClick}
                onDropOnCard={handleDropOnCard}
                hideEmptyMessage={true}
              />
            </div>
          ) : (gameState?.houses?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center">
              <p className="text-sm font-display" style={{ color: 'rgba(245,240,232,0.3)' }}>Table is empty</p>
            </div>
          ) : null}

          {/* Active Houses */}
          {gameState?.houses && gameState.houses.length > 0 && (
            <div className="flex flex-col items-center w-full">
              <span className="text-[9px] sm:text-[10px] uppercase tracking-widest text-emerald-300/30 mb-1.5">Active Houses</span>
              <div className="flex flex-wrap gap-4 sm:gap-6 justify-center items-center">
                {gameState.houses.map(house => {
                  const isSelected = capturedCards.some(cc => house.cards.some(hc => hc.id === cc.id));
                  const groups = groupHouseCards(house.cards, house.value);
                  return (
                    <motion.div
                      key={house.id}
                      onClick={() => handleHouseClick(house)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDropOnHouse(e, house)}
                      className={`relative flex flex-col items-center p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected ? 'border-gold bg-gold/10' : 'border-emerald-800/40 bg-black/30 hover:border-emerald-600/30'
                      }`}
                      style={{ minWidth: '100px' }}
                      whileHover={{ scale: 1.02 }}
                    >
                      {/* Badge */}
                      <div className={`absolute -top-3 px-2 py-0.5 rounded-full text-[9px] font-bold shadow ${
                        house.isPukta ? 'bg-gold-gradient text-emerald-950 border border-gold' : 'bg-emerald-900 border border-emerald-700 text-emerald-100'
                      }`}>
                        {house.isPukta ? '🏆' : '🏠'} House {house.value}
                      </div>

                      {/* Stack of Cards grouped together */}
                      <div className="flex gap-2 items-start justify-center mt-2.5 min-h-[96px] px-2">
                        {groups.map((group, gIdx) => (
                          <div key={gIdx} className="flex flex-col items-center">
                            {group.map((c, cIdx) => (
                              <div
                                key={c.id}
                                style={{
                                  marginTop: cIdx > 0 ? '-28px' : '0px',
                                  zIndex: cIdx,
                                  position: 'relative',
                                }}
                              >
                                <PlayingCard card={c} size="sm" />
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* BOTTOM — Player hand */}
        <div className="absolute bottom-28 sm:bottom-24 left-0 right-0 flex justify-center" style={{ zIndex: 20 }}>
          <PlayerHand
            cards={hand}
            position="bottom"
            selectedCard={selectedCard}
            onSelectCard={handleCardClick}
            onDragStart={handleDragStart}
            label={`${username} (You)`}
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

                {/* Actions container */}
                <div className="p-3 sm:p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-center">
                  <div className="flex gap-3 flex-1 justify-center">
                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      onClick={handleCapture}
                      disabled={capturedCards.length === 0}
                      className={`flex-1 sm:flex-initial px-6 py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest transition-all ${
                        capturedCards.length > 0 ? 'btn-gold animate-glow-pulse' : 'bg-black/30 text-gray-500 border border-gray-800 cursor-not-allowed'
                      }`}
                    >
                      Capture Cards
                    </motion.button>

                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      onClick={handleThrow}
                      className="flex-1 sm:flex-initial px-6 py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest text-emerald-100 bg-emerald-950/40 border border-emerald-800/40 hover:border-emerald-600"
                    >
                      Throw Card
                    </motion.button>
                  </div>

                  {/* House building interface */}
                  <div className="flex items-center gap-2 justify-center border-t sm:border-t-0 sm:border-l border-emerald-800/20 pt-3 sm:pt-0 sm:pl-4">
                    <span className="text-xs text-gray-400">House Value:</span>
                    <div className="flex gap-1.5">
                      {[9, 10, 11, 12, 13].map(v => (
                        <motion.button
                          key={v}
                          whileTap={{ scale: 0.88 }}
                          onClick={() => setHouseValue(v as any)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                            houseValue === v
                              ? 'bg-gold text-emerald-950 font-bold shadow'
                              : 'bg-black/30 text-gray-400 border border-emerald-800/30 hover:border-gold/30'
                          }`}
                        >
                          {v}
                        </motion.button>
                      ))}
                    </div>

                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      onClick={handleBuildHouse}
                      disabled={!houseValue}
                      className={`px-5 py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest transition-all ${
                        houseValue ? 'btn-gold' : 'bg-black/30 text-gray-500 border border-gray-800 cursor-not-allowed'
                      }`}
                    >
                      Build
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* ─── ROUND END OVERLAY ─── */}
      <AnimatePresence>
        {gameState?.gamePhase === 'roundEnd' && gameState.roundSummary && (
          <motion.div
            key="round-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(5,12,7,0.88)', backdropFilter: 'blur(6px)' }}
          >
            <motion.div
              initial={{ scale: 0.88, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              className="rounded-2xl p-8 w-full max-w-md shadow-2xl text-center"
              style={{ background: 'rgba(9,22,12,0.98)', border: '1px solid rgba(212,175,55,0.35)' }}
            >
              <p className="text-[10px] uppercase tracking-[0.3em] font-display mb-1" style={{ color: 'rgba(212,175,55,0.5)' }}>
                Round {gameState.roundNumber - 1} Complete
              </p>
              <h2 className="text-2xl font-display font-bold text-gold-gradient mb-6">
                {gameState.roundSummary.winningTeam === 1
                  ? `${teamNames.team1} wins this round!`
                  : gameState.roundSummary.winningTeam === 2
                    ? `${teamNames.team2} wins this round!`
                    : "Round Draw!"}
              </h2>

              {/* Score table */}
              <div className="grid grid-cols-3 gap-2 text-xs mb-6">
                <div />
                <div className="font-bold font-display text-gold-gradient text-center">{teamNames.team1}</div>
                <div className="font-bold font-display text-gold-gradient text-center">{teamNames.team2}</div>

                <div className="text-left" style={{ color: 'rgba(245,240,232,0.5)' }}>Card pts</div>
                <div className="text-center font-mono">{gameState.roundSummary.team1CardPoints}</div>
                <div className="text-center font-mono">{gameState.roundSummary.team2CardPoints}</div>

                <div className="text-left" style={{ color: 'rgba(245,240,232,0.5)' }}>Net seeps</div>
                <div className="text-center font-mono">{gameState.roundSummary.team1SeepsNet > 0 ? `+${gameState.roundSummary.team1SeepsNet} 🌊` : '—'}</div>
                <div className="text-center font-mono">{gameState.roundSummary.team2SeepsNet > 0 ? `+${gameState.roundSummary.team2SeepsNet} 🌊` : '—'}</div>

                <div className="text-left border-t border-gold/20 pt-1" style={{ color: 'rgba(245,240,232,0.5)' }}>Round Δ</div>
                <div className={`text-center font-mono font-bold border-t border-gold/20 pt-1 ${gameState.roundSummary.team1RoundScore > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {gameState.roundSummary.team1RoundScore > 0 ? `+${gameState.roundSummary.team1RoundScore}` : gameState.roundSummary.team1RoundScore}
                </div>
                <div className={`text-center font-mono font-bold border-t border-gold/20 pt-1 ${gameState.roundSummary.team2RoundScore > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {gameState.roundSummary.team2RoundScore > 0 ? `+${gameState.roundSummary.team2RoundScore}` : gameState.roundSummary.team2RoundScore}
                </div>

                <div className="text-left border-t border-gold/20 pt-2 mt-1" style={{ color: 'rgba(245,240,232,0.5)' }}>Total</div>
                <div className="text-center font-mono font-bold text-gold-gradient border-t border-gold/20 pt-2 mt-1 text-base">{gameState.teamScores.team1}</div>
                <div className="text-center font-mono font-bold text-gold-gradient border-t border-gold/20 pt-2 mt-1 text-base">{gameState.teamScores.team2}</div>
              </div>

              {/* Dealer selection */}
              {(() => {
                const selTeam = gameState.dealerSelectionTeam;
                const losingTeamPlayers = gameState.players.filter(p => p.team === selTeam);
                const myTeam = gameState.players.find(p => p.id === userId)?.team;
                const canPick = myTeam === selTeam;
                return (
                  <div>
                    <div className="divider-gold opacity-20 my-4" />
                    <p className="text-xs mb-3" style={{ color: 'rgba(245,240,232,0.5)' }}>
                      <span className="font-bold" style={{ color: 'rgba(212,175,55,0.8)' }}>
                        {selTeam === 1 ? teamNames.team1 : teamNames.team2}
                      </span>{' '}lost — choose the next dealer:
                    </p>
                    <div className="flex gap-3 justify-center flex-wrap">
                      {losingTeamPlayers.map(p => (
                        <button
                          key={p.id}
                          disabled={!canPick}
                          onClick={() => socket.emit('select-dealer', { lobbyCode, dealerId: p.id })}
                          className={`px-4 py-2 rounded-xl text-xs font-bold font-display transition-all ${
                            canPick
                              ? 'btn-gold cursor-pointer'
                              : 'bg-black/30 text-gray-500 border border-gray-800 cursor-not-allowed'
                          }`}
                        >
                          {p.username}{canPick ? ' — Deal' : ''}
                        </button>
                      ))}
                    </div>
                    {!canPick && (
                      <p className="text-[10px] mt-3 italic" style={{ color: 'rgba(245,240,232,0.3)' }}>
                        Waiting for {selTeam === 1 ? teamNames.team1 : teamNames.team2} to pick a dealer…
                      </p>
                    )}
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── GAME END OVERLAY ─── */}
      <AnimatePresence>
        {gameState?.gamePhase === 'gameEnd' && (
          <motion.div
            key="game-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(5,12,7,0.92)', backdropFilter: 'blur(8px)' }}
          >
            <motion.div
              initial={{ scale: 0.85, y: 40 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 180, damping: 22 }}
              className="rounded-2xl p-10 w-full max-w-sm shadow-2xl text-center"
              style={{ background: 'rgba(9,22,12,0.99)', border: '1px solid rgba(212,175,55,0.5)' }}
            >
              <div className="text-5xl mb-4">🏆</div>
              <p className="text-[10px] uppercase tracking-[0.3em] font-display mb-1" style={{ color: 'rgba(212,175,55,0.5)' }}>Game Over</p>
              <h2 className="text-3xl font-display font-bold text-gold-gradient mb-2">
                {(gameState.teamScores.team1 >= 100)
                  ? `${teamNames.team1} wins!`
                  : `${teamNames.team2} wins!`}
              </h2>
              <div className="flex justify-center gap-8 mt-6 mb-8">
                <div>
                  <div className="text-2xl font-bold font-mono text-gold-gradient">{gameState.teamScores.team1}</div>
                  <div className="text-xs mt-1" style={{ color: 'rgba(245,240,232,0.4)' }}>{teamNames.team1}</div>
                </div>
                <div className="w-px bg-gold/20" />
                <div>
                  <div className="text-2xl font-bold font-mono text-gold-gradient">{gameState.teamScores.team2}</div>
                  <div className="text-xs mt-1" style={{ color: 'rgba(245,240,232,0.4)' }}>{teamNames.team2}</div>
                </div>
              </div>
              <button onClick={onLeaveGame} className="btn-gold px-8 py-3 rounded-xl text-sm font-bold font-display uppercase tracking-widest">
                Back to Lobby
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── EAT vs CONTRIBUTE CHOOSE PROMPT ─── */}
      <AnimatePresence>
        {houseActionPrompt && (
          <motion.div
            key="house-action-prompt"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="glass-panel rounded-2xl p-6 w-full max-w-sm text-center flex flex-col items-center border border-gold/30"
              style={{ background: 'rgba(9,22,12,0.98)' }}
            >
              <h3 className="text-lg font-display font-bold text-gold-gradient mb-2">
                House Action Decision
              </h3>
              <p className="text-xs text-gray-300 mb-6 font-display">
                Would you like to Eat (Capture) House {houseActionPrompt.house.value} or Contribute to it?
              </p>

              <div className="flex flex-col gap-3 w-full">
                <button
                  onClick={() => performHouseAction('CAPTURE', houseActionPrompt.card, houseActionPrompt.house, houseActionPrompt.floorCards)}
                  className="w-full py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest btn-gold shadow-lg cursor-pointer"
                >
                  🍽️ Eat (Capture) House
                </button>

                <button
                  onClick={() => performHouseAction('CONTRIBUTE', houseActionPrompt.card, houseActionPrompt.house, houseActionPrompt.floorCards)}
                  className="w-full py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest text-emerald-100 bg-emerald-950/50 border border-emerald-800/40 hover:border-emerald-600 transition-all cursor-pointer"
                >
                  ➕ Contribute / Distort
                </button>

                <button
                  onClick={() => setHouseActionPrompt(null)}
                  className="w-full py-2.5 rounded-xl text-xs text-gray-400 hover:text-gray-200 transition-all bg-transparent border-0 mt-2 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}