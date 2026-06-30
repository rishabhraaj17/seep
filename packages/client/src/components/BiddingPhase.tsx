import { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import PlayingCard from './PlayingCard';
import type { Card } from '../types';

interface BiddingPhaseProps {
  socket: Socket;
  userId: string;
  lobbyCode: string;
  hand: Card[];
  floorCards: Card[];
  onBidComplete: () => void;
}

const rankToValue: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 1,
};

const rankLabel: Record<number, string> = {
  9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

export default function BiddingPhase({ socket, userId, lobbyCode, hand, floorCards, onBidComplete }: BiddingPhaseProps) {
  const [selectedBid, setSelectedBid] = useState<number | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [waitMsg, setWaitMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    socket.on('bid-placed', ({ bid, playerId }: { bid: number; playerId: string }) => {
      setWaitMsg(playerId === userId
        ? `You bid ${rankLabel[bid]}. Starting game...`
        : `A bid of ${rankLabel[bid]} was placed. Get ready!`
      );
      setTimeout(() => onBidComplete(), 1400);
    });
    return () => { socket.off('bid-placed'); };
  }, [socket, userId, onBidComplete]);

  const handlePlaceBid = () => {
    if (!selectedBid || !selectedCard || !lobbyCode || submitted) return;
    setSubmitted(true);
    socket.emit('place-bid', { lobbyCode, playerId: userId, bid: selectedBid, cardId: selectedCard.id });
  };

  const selectBidValue = (bid: number) => {
    const matching = hand.find(c => rankToValue[c.rank] === bid);
    if (matching) { setSelectedBid(bid); setSelectedCard(matching); }
  };

  const availableBids = [9, 10, 11, 12, 13].filter(b => hand.some(c => rankToValue[c.rank] === b));

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-64 opacity-30"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.12) 0%, transparent 70%)' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-3xl"
      >
        <div className="glass-panel rounded-2xl overflow-hidden">
          {/* Gold bar */}
          <div className="h-1" style={{ background: 'linear-gradient(90deg, transparent, #d4af37, #f5d78e, #d4af37, transparent)' }} />

          <div className="p-6 sm:p-8">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-3"
                style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)' }}>
                <span className="text-xs font-display tracking-[0.25em] uppercase text-gold-gradient font-bold">Bidding Phase</span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-gold-gradient">Place Your Bid</h1>
              <p className="text-sm mt-2" style={{ color: 'rgba(245,240,232,0.4)' }}>
                Select a card from your hand (9–K) to declare your bid value
              </p>
            </div>

            {/* Success message */}
            <AnimatePresence>
              {waitMsg && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="mb-6 p-4 rounded-xl text-center font-semibold text-sm"
                  style={{ background: 'rgba(22,160,133,0.2)', border: '1px solid rgba(22,160,133,0.4)', color: '#1abc9c' }}
                >
                  ✦ {waitMsg}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Floor cards */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="divider-gold flex-1" />
                <span className="text-xs font-display tracking-[0.2em] uppercase" style={{ color: 'rgba(212,175,55,0.6)' }}>
                  Floor Cards
                </span>
                <div className="divider-gold flex-1" />
              </div>
              <div className="flex justify-center gap-2 flex-wrap min-h-[80px] items-center">
                {floorCards.length > 0 ? floorCards.map((card, i) => (
                  <motion.div key={card.id || i}
                    initial={{ scale: 0, y: -20 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ delay: i * 0.08, type: 'spring', stiffness: 350 }}>
                    <PlayingCard card={card} size="md" />
                  </motion.div>
                )) : (
                  <span className="text-sm" style={{ color: 'rgba(245,240,232,0.25)' }}>No floor cards</span>
                )}
              </div>
            </div>

            {/* Your hand */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="divider-gold flex-1" />
                <span className="text-xs font-display tracking-[0.2em] uppercase" style={{ color: 'rgba(212,175,55,0.6)' }}>
                  Your Hand
                </span>
                <div className="divider-gold flex-1" />
              </div>
              <div className="flex justify-center gap-2 sm:gap-3 flex-wrap min-h-[100px] items-center">
                {hand.length > 0 ? hand.map(card => {
                  const value = rankToValue[card.rank];
                  const canBid = [9, 10, 11, 12, 13].includes(value);
                  const isChosen = selectedCard?.id === card.id;
                  return (
                    <motion.div key={card.id}
                      whileHover={canBid ? { y: -8, scale: 1.05 } : {}}
                      className={canBid ? 'cursor-pointer' : 'opacity-50'}
                      style={{ transition: 'none' }}>
                      <PlayingCard
                        card={card}
                        size="md"
                        isSelected={isChosen}
                        onClick={canBid ? () => { setSelectedCard(card); setSelectedBid(value); } : undefined}
                      />
                    </motion.div>
                  );
                }) : (
                  <div className="animate-pulse text-sm" style={{ color: 'rgba(245,240,232,0.3)' }}>
                    Waiting for cards...
                  </div>
                )}
              </div>
              {hand.length > 0 && availableBids.length === 0 && (
                <p className="text-center text-xs mt-2" style={{ color: '#f1948a' }}>
                  ⚠️ You have no cards with values 9–K
                </p>
              )}
            </div>

            {/* Bid value picker */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="divider-gold flex-1" />
                <span className="text-xs font-display tracking-[0.2em] uppercase" style={{ color: 'rgba(212,175,55,0.6)' }}>
                  Bid Value
                </span>
                <div className="divider-gold flex-1" />
              </div>
              <div className="grid grid-cols-5 gap-2 max-w-sm mx-auto">
                {[9, 10, 11, 12, 13].map(bid => {
                  const avail = availableBids.includes(bid);
                  const chosen = selectedBid === bid;
                  return (
                    <motion.button
                      key={bid}
                      whileTap={avail ? { scale: 0.92 } : undefined}
                      onClick={() => avail && selectBidValue(bid)}
                      disabled={!avail}
                      className="py-3 rounded-xl font-display font-bold text-base transition-all"
                      style={chosen
                        ? { background: 'linear-gradient(135deg, #d4af37, #b8960c)', color: '#0d1f13', boxShadow: '0 0 20px rgba(212,175,55,0.4)', border: '1px solid #f5d78e' }
                        : avail
                        ? { background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,175,55,0.25)', color: 'rgba(245,240,232,0.8)' }
                        : { background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(212,175,55,0.08)', color: 'rgba(245,240,232,0.2)', cursor: 'not-allowed' }
                      }
                    >
                      {rankLabel[bid]}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Confirm button */}
            <motion.button
              whileTap={selectedBid && selectedCard && !submitted ? { scale: 0.97 } : undefined}
              onClick={handlePlaceBid}
              disabled={!selectedBid || !selectedCard || !lobbyCode || submitted}
              className="btn-gold w-full py-4 rounded-xl font-display text-sm tracking-widest uppercase"
            >
              {submitted
                ? '✓ Bid Placed'
                : selectedBid
                ? `✦ Place Bid — ${rankLabel[selectedBid]}`
                : '✦ Select a Card to Bid'
              }
            </motion.button>

            <p className="text-center text-xs mt-3" style={{ color: 'rgba(245,240,232,0.25)' }}>
              Tip: Cards are highlighted when they can be bid. Click a card or bid value to select.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}