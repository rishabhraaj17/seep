import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import PlayingCard from './PlayingCard';
import type { Card, GameState } from '../types';

interface TossPhaseProps {
  gameState: GameState;
  userId: string;
}

export default function TossPhase({ gameState, userId }: TossPhaseProps) {
  const tossHistory = gameState.tossHistory || [];
  
  const [animatedDeals, setAnimatedDeals] = useState<{ playerId: string; card: Card }[]>([]);
  const [currentWinner, setCurrentWinner] = useState<string | null>(null);

  useEffect(() => {
    // Animate deals one by one
    setAnimatedDeals([]);
    setCurrentWinner(null);

    let idx = 0;
    const interval = setInterval(() => {
      if (idx < tossHistory.length) {
        const currentDeal = tossHistory[idx];
        setAnimatedDeals(prev => [...prev, currentDeal]);
        
        if (currentDeal.card.rank === 'J') {
          setCurrentWinner(currentDeal.playerId);
          clearInterval(interval);
        }
        idx++;
      } else {
        clearInterval(interval);
      }
    }, 600);

    return () => clearInterval(interval);
  }, [tossHistory]);

  // Group cards by player
  const cardsByPlayer: Record<string, Card[]> = {};
  animatedDeals.forEach(deal => {
    if (!cardsByPlayer[deal.playerId]) {
      cardsByPlayer[deal.playerId] = [];
    }
    cardsByPlayer[deal.playerId].push(deal.card);
  });

  // Seats are always dealt in order 1..4; seat 1 is always "You" post-toss-rotation.
  const playersBySeat = [...(gameState.players || [])].sort((a, b) => a.seat - b.seat);
  const seatLabel = (seat: number) => {
    if (seat === 1) return 'You';
    if (seat === 3) return 'Partner';
    return 'Opponent';
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden felt-bg">
      {/* Background decoration */}
      <div className="absolute inset-[8%] rounded-[50%] table-oval pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-4xl glass-panel rounded-2xl p-6 text-center z-10"
        style={{ background: 'rgba(9,18,11,0.92)', border: '1px solid rgba(212,175,55,0.2)' }}
      >
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-3"
          style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)' }}>
          <span className="text-xs font-display tracking-[0.25em] uppercase text-gold-gradient font-bold">
            Toss Phase
          </span>
        </div>
        
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-gold-gradient mb-2">
          Determining the Starting Dealer
        </h1>
        
        <p className="text-xs max-w-xl mx-auto mb-6 text-emerald-100/70">
          The deck is shuffled and cards are dealt face-up one-by-one to each player.
          The first player to receive a <strong>Jack (J)</strong> wins the toss, becomes player 0, and places the opening bid!
        </p>

        {/* Toss status message */}
        <div className="min-h-[50px] mb-8 flex justify-center items-center">
          <AnimatePresence mode="wait">
            {currentWinner ? (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="px-6 py-2.5 rounded-xl border font-bold text-sm tracking-wide text-center"
                style={{ background: 'rgba(212,175,55,0.15)', border: '1px solid #d4af37', color: '#f5d78e' }}
              >
                🏆 {currentWinner === userId ? 'You got the Jack first and won the toss!' : `${gameState.players?.find(p => p.id === currentWinner)?.username || 'Your Opponent'} got the Jack and wins the toss!`}
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm font-semibold animate-pulse"
                style={{ color: 'rgba(var(--text-rgb),0.6)' }}
              >
                Dealing cards... looking for a Jack
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Players seats layout */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {playersBySeat.map(player => {
            const isMe = player.id === userId;
            return (
              <div key={player.id} className="p-4 rounded-xl border flex flex-col items-center"
                style={isMe
                  ? { background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.25)' }
                  : { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.08)' }}>
                <span className={`text-xs font-bold mb-3 ${isMe ? 'text-gold-gradient' : 'text-emerald-400'}`}>
                  Seat {player.seat} ({isMe ? 'You' : seatLabel(player.seat)})
                </span>
                <div className="flex gap-1 flex-wrap justify-center min-h-[120px] items-center">
                  {cardsByPlayer[player.id]?.map(c => (
                    <PlayingCard key={c.id} card={c} size="sm" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Dynamic Rules Tip Box */}
        <div className="text-left p-4 rounded-xl text-xs max-w-2xl mx-auto"
          style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,175,55,0.1)' }}>
          <div className="font-semibold text-gold-gradient mb-1">✦ Current Rules context:</div>
          <span style={{ color: 'rgba(var(--text-rgb),0.65)' }}>
            Seep is played in partnerships. Seat 1 (You) and Seat 3 (Partner) form Team 1, and Seat 2 & Seat 4 form Team 2.
            The Jack Toss winner is rotated to Seat 1 for the game, earning the bidding dealer seat.
          </span>
        </div>
      </motion.div>
    </div>
  );
}
