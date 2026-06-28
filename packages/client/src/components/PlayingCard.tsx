import { motion } from 'motion/react';
import type { Card } from '../types';

interface PlayingCardProps {
  card: Card & { faceDown?: boolean };
  onClick?: () => void;
  isSelected?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const suitColors: Record<string, string> = {
  hearts: 'text-red-500',
  diamonds: 'text-red-500',
  clubs: 'text-gray-900',
  spades: 'text-gray-900',
};

const suitSymbols: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export default function PlayingCard({ card, onClick, isSelected, size = 'md' }: PlayingCardProps) {
  // Mobile-friendly sizing with min 44px touch targets
  const sizeClasses = {
    sm: 'w-10 h-14 sm:w-12 sm:h-16 text-[10px] sm:text-xs',
    md: 'w-14 h-20 sm:w-16 sm:h-24 text-xs sm:text-sm',
    lg: 'w-16 h-24 sm:w-20 sm:h-28 text-sm sm:text-base',
  };

  // Wrap in a container for larger touch area on mobile
  const minSizeClass = 'min-w-[44px] min-h-[44px]';

  if (card.faceDown) {
    return (
      <motion.div
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className={`${sizeClasses[size]} ${minSizeClass} bg-yellow-500 rounded-lg flex items-center justify-center cursor-pointer card-shadow`}
      >
        <div className="text-yellow-700 font-bold text-lg sm:text-xl">?</div>
      </motion.div>
    );
  }

  return (
    <motion.div
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={`${sizeClasses[size]} ${minSizeClass} bg-white rounded-lg p-1 sm:p-2 flex flex-col justify-between cursor-pointer card-shadow relative ${
        isSelected ? 'ring-2 ring-yellow-500' : ''
      }`}
    >
      {/* Top left corner */}
      <div className="flex items-start justify-between">
        <span className={`font-bold ${suitColors[card.suit]}`}>{card.rank}</span>
        <span className={`${suitColors[card.suit]} text-xs sm:text-sm`}>{suitSymbols[card.suit]}</span>
      </div>

      {/* Center symbol */}
      <div className={`text-xl sm:text-2xl text-center ${suitColors[card.suit]}`}>
        {suitSymbols[card.suit]}
      </div>

      {/* Bottom right corner (inverted) */}
      <div className="flex items-end justify-end rotate-180">
        <span className={`font-bold ${suitColors[card.suit]}`}>{card.rank}</span>
      </div>

      {/* Point value indicator (for scoring cards) */}
      {card.pointValue > 0 && (
        <div className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 bg-yellow-500 text-black text-[8px] sm:text-[10px] font-bold rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center">
          {card.pointValue}
        </div>
      )}
    </motion.div>
  );
}