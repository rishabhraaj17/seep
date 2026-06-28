import { useState } from 'react';
import { Socket } from 'socket.io-client';
import { motion } from 'motion/react';
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

// Card values for bidding (mapped from rank)
const rankToValue: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

export default function BiddingPhase({
  socket,
  userId,
  lobbyCode,
  hand,
  floorCards,
  onBidComplete,
}: BiddingPhaseProps) {
  const [selectedBid, setSelectedBid] = useState<number | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);

  const handlePlaceBid = () => {
    if (selectedBid && selectedCard) {
      socket.emit('place-bid', {
        lobbyCode,
        playerId: userId,
        bid: selectedBid,
        cardId: selectedCard.id,
      });
      onBidComplete();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gray-800 rounded-xl p-8 w-full max-w-4xl"
      >
        <h1 className="text-3xl font-bold mb-6 text-center text-yellow-500">Bidding Phase</h1>

        {/* Floor Cards */}
        <div className="mb-8">
          <h2 className="text-lg font-medium mb-3 text-gray-400">Table Cards (Floor)</h2>
          <div className="flex justify-center gap-3">
            {floorCards.map((card, i) => (
              <PlayingCard key={i} card={{ ...card, faceDown: false }} size="lg" />
            ))}
          </div>
        </div>

        {/* Your Hand */}
        <div className="mb-8">
          <h2 className="text-lg font-medium mb-3 text-gray-400">Your Hand (4 cards)</h2>
          <div className="flex justify-center gap-3">
            {hand.map(card => (
              <PlayingCard
                key={card.id}
                card={card}
                onClick={() => {
                  const value = rankToValue[card.rank];
                  if ([9, 10, 11, 12, 13, 14].includes(value)) {
                    setSelectedCard(card);
                    setSelectedBid(value);
                  }
                }}
                isSelected={selectedCard?.id === card.id}
              />
            ))}
          </div>
        </div>

        {/* Bid Selection */}
        <div className="mb-8">
          <h2 className="text-lg font-medium mb-3 text-gray-400">Select Your Bid (9-14)</h2>
          <div className="grid grid-cols-6 gap-2 max-w-md mx-auto">
            {[9, 10, 11, 12, 13, 14].map(bid => {
              const isAvailable = hand.some(card => rankToValue[card.rank] === bid);
              const isSelected = selectedBid === bid;

              return (
                <motion.button
                  key={bid}
                  whileHover={isAvailable ? { scale: 1.05 } : undefined}
                  whileTap={isAvailable ? { scale: 0.95 } : undefined}
                  onClick={() => isAvailable && setSelectedBid(bid)}
                  disabled={!isAvailable}
                  className={`py-3 px-4 rounded-lg font-bold text-lg transition-all ${
                    isSelected
                      ? 'bg-yellow-600 text-white ring-2 ring-yellow-400'
                      : isAvailable
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  {bid}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Action Button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handlePlaceBid}
          disabled={!selectedBid || !selectedCard}
          className={`w-full max-w-md py-4 px-6 rounded-lg font-semibold text-lg ${
            selectedBid && selectedCard
              ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          Place Bid {selectedBid && `(${selectedBid})`}
        </motion.button>

        <p className="text-center text-sm text-gray-400 mt-4">
          Combine your bid card with floor cards to capture, or match directly
        </p>
      </motion.div>
    </div>
  );
}