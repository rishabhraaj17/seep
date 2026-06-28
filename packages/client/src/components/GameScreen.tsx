import { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { motion } from 'motion/react';
import type { Card, GameState } from '../types';
import PlayerHand from './PlayerHand';
import FloorCards from './FloorCards';
import Scoreboard from './Scoreboard';
import BiddingPhase from './BiddingPhase';

interface GameScreenProps {
  socket: Socket;
  userId: string;
}

// Card value for sum calculations
function getCardValue(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return parseInt(card.rank, 10);
}

// Check if cards can be captured with played card
function findCapturableCards(card: Card, floor: Card[]): Card[] {
  const cardValue = getCardValue(card);
  const capturable: Card[] = [];

  // Single cards
  for (const floorCard of floor) {
    if (getCardValue(floorCard) === cardValue) {
      capturable.push(floorCard);
    }
  }

  // Sum combinations (simple check - find pairs/triples that sum to card value)
  for (let i = 0; i < floor.length; i++) {
    for (let j = i + 1; j < floor.length; j++) {
      if (getCardValue(floor[i]) + getCardValue(floor[j]) === cardValue) {
        if (!capturable.includes(floor[i])) capturable.push(floor[i]);
        if (!capturable.includes(floor[j])) capturable.push(floor[j]);
      }
    }
  }

  return capturable;
}

export default function GameScreen({ socket, userId }: GameScreenProps) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [capturedCards, setCapturedCards] = useState<Card[]>([]);
  const [houseValue, setHouseValue] = useState<9 | 10 | 11 | 12 | 13 | 14 | null>(null);
  const [lobbyCode, _setLobbyCode] = useState<string | null>(null);
  const [hand, setHand] = useState<Card[]>([]);
  const [isBidding, setIsBidding] = useState(true);
  const [showScoreboard, setShowScoreboard] = useState(false);

  useEffect(() => {
    // Handle game started
    socket.on('game-started', () => {
      setIsBidding(true);
    });

    // Handle deal cards
    socket.on('deal-cards', ({ floor, hands, biddingPlayerIndex }: {
      floor: Card[];
      hands: Card[][];
      biddingPlayerIndex: number;
    }) => {
      setGameState({
        lobbyCode: lobbyCode!,
        floor,
        houses: [],
        currentPlayerIndex: biddingPlayerIndex,
        roundNumber: 1,
        teamScores: { team1: 0, team2: 0 },
        capturedCards: { team1: [], team2: [] },
        seepCount: 0,
        gamePhase: 'bidding',
      });

      // Get our hand (we're player 0 for now)
      setHand(hands[0]);
    });

    // Handle game state updates
    socket.on('game-state', (state: GameState) => {
      setGameState(state);
    });

    // Handle card selection feedback
    socket.on('valid-capture', ({ cards }: { cards: Card[] }) => {
      setCapturedCards(cards);
    });

    return () => {
      socket.off('game-started');
      socket.off('deal-cards');
      socket.off('game-state');
      socket.off('valid-capture');
    };
  }, [socket, lobbyCode]);

  const handleCardClick = (card: Card) => {
    setSelectedCard(card);
    const capturable = findCapturableCards(card, gameState?.floor || []);

    if (capturable.length > 0) {
      setCapturedCards(capturable);
    } else {
      setCapturedCards([]);
    }
  };

  const handleCapture = () => {
    if (selectedCard && capturedCards.length > 0) {
      socket.emit('game-action', {
        action: 'CAPTURE',
        lobbyCode: gameState?.lobbyCode,
        payload: {
          playerId: userId,
          card: selectedCard,
          targetCards: capturedCards,
        },
      });
      setSelectedCard(null);
      setCapturedCards([]);
    }
  };

  const handleBuildHouse = () => {
    if (selectedCard && houseValue) {
      socket.emit('game-action', {
        action: 'BUILD_HOUSE',
        lobbyCode: gameState?.lobbyCode,
        payload: {
          playerId: userId,
          card: selectedCard,
          houseValue,
        },
      });
      setSelectedCard(null);
      setHouseValue(null);
    }
  };

  const handleThrow = () => {
    if (selectedCard) {
      socket.emit('game-action', {
        action: 'THROW',
        lobbyCode: gameState?.lobbyCode,
        payload: {
          playerId: userId,
          card: selectedCard,
        },
      });
      setSelectedCard(null);
    }
  };

  // Show bidding phase if we're in it
  if (isBidding || gameState?.gamePhase === 'bidding') {
    return (
      <BiddingPhase
        socket={socket}
        userId={userId}
        lobbyCode={lobbyCode || ''}
        hand={hand}
        floorCards={gameState?.floor || []}
        onBidComplete={() => setIsBidding(false)}
      />
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Game Table Background */}
      <div className="absolute inset-0 bg-green-800" />

      {/* Mobile Score Toggle */}
      <button
        onClick={() => setShowScoreboard(!showScoreboard)}
        className="absolute top-2 right-2 z-20 sm:hidden w-10 h-10 bg-gray-700 rounded-lg flex items-center justify-center"
      >
        📊
      </button>

      {/* Scoreboard - Hidden on mobile, sliding sidebar on larger screens */}
      <div className="hidden sm:block">
        <Scoreboard />
      </div>
      {showScoreboard && (
        <div className="sm:hidden">
          <Scoreboard onClose={() => setShowScoreboard(false)} />
        </div>
      )}

      {/* Game Area */}
      <div className="relative flex flex-col items-center justify-center h-full">
        {/* Opponent 1 (top) */}
        <div className="absolute top-4 w-full px-8">
          <div className="flex justify-center">
            <PlayerHand
              cards={hand.slice(0, 3).map(c => ({ ...c, faceDown: true }))}
              position="top"
              isOpponent
            />
          </div>
        </div>

        {/* Floor Cards (center) */}
        <div className="flex-1 flex items-center justify-center">
          <FloorCards cards={gameState?.floor || []} />
        </div>

        {/* Opponent 2 (left) */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2">
          <PlayerHand
            cards={hand.slice(0, 3).map(c => ({ ...c, faceDown: true }))}
            position="left"
            isOpponent
          />
        </div>

        {/* Opponent 3 (right) */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          <PlayerHand
            cards={hand.slice(0, 2).map(c => ({ ...c, faceDown: true }))}
            position="right"
            isOpponent
          />
        </div>

        {/* Current Player's Hand (bottom) */}
        <div className="absolute bottom-32 w-full px-8">
          <PlayerHand
            cards={hand}
            position="bottom"
            selectedCard={selectedCard}
            onSelectCard={handleCardClick}
          />
        </div>

        {/* Action Panel */}
        {selectedCard && (
          <div className="absolute bottom-2 sm:bottom-4 left-0 right-0 flex flex-col items-center gap-2 sm:gap-3 px-2">
            {/* Captured cards preview */}
            {capturedCards.length > 0 && (
              <div className="bg-yellow-600/20 rounded-lg p-1.5 sm:p-2 max-w-xs">
                <p className="text-[10px] sm:text-sm text-yellow-400 mb-0.5 sm:mb-1">Can capture:</p>
                <div className="flex gap-1 flex-wrap justify-center">
                  {capturedCards.map(card => (
                    <span key={card.id} className="text-[10px] sm:text-xs">{card.rank}{card.suit.charAt(0).toUpperCase()}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons - mobile stack, desktop row */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto">
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="px-4 py-2 sm:px-6 sm:py-2 bg-red-600 rounded-lg font-semibold text-sm sm:text-base"
                onClick={() => setSelectedCard(null)}
              >
                Cancel
              </motion.button>

              {capturedCards.length > 0 && (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  className="px-4 py-2 sm:px-6 sm:py-2 bg-blue-600 rounded-lg font-semibold text-sm sm:text-base"
                  onClick={handleCapture}
                >
                  Capture
                </motion.button>
              )}

              {/* House Building - Grid on mobile */}
              <div className="grid grid-cols-6 sm:flex sm:gap-1 gap-1">
                {[9, 10, 11, 12, 13, 14].map(val => (
                  <motion.button
                    key={val}
                    whileTap={{ scale: 0.9 }}
                    className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg font-bold text-xs sm:text-sm touch-target ${
                      houseValue === val
                        ? 'bg-yellow-600 ring-2 ring-yellow-400'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                    onClick={() => setHouseValue(val as any)}
                  >
                    {val}
                  </motion.button>
                ))}
              </div>

              {houseValue && (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  className="px-4 py-2 sm:px-6 sm:py-2 bg-purple-600 rounded-lg font-semibold text-sm sm:text-base"
                  onClick={handleBuildHouse}
                >
                  Build {houseValue}
                </motion.button>
              )}

              <motion.button
                whileTap={{ scale: 0.95 }}
                className="px-4 py-2 sm:px-6 sm:py-2 bg-green-600 rounded-lg font-semibold text-sm sm:text-base disabled:opacity-50"
                onClick={handleThrow}
                disabled={!!houseValue}
              >
                Throw
              </motion.button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}