import { motion } from 'motion/react';
import type { Card } from '../types';

interface PlayingCardProps {
  card: Card & { faceDown?: boolean };
  onClick?: () => void;
  isSelected?: boolean;
  selectedVariant?: 'gold' | 'teal';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const suitConfig: Record<string, { color: string; symbol: string; isRed: boolean }> = {
  hearts:   { color: '#c0392b', symbol: '♥', isRed: true },
  diamonds: { color: '#c0392b', symbol: '♦', isRed: true },
  clubs:    { color: '#1a1a2e', symbol: '♣', isRed: false },
  spades:   { color: '#1a1a2e', symbol: '♠', isRed: false },
};

const sizeConfig = {
  sm: { outer: 'w-10 h-14 sm:w-12 sm:h-16', rank: 'text-[10px] sm:text-xs', suit: 'text-sm sm:text-base', padding: 'p-1' },
  md: { outer: 'w-14 h-20 sm:w-16 sm:h-24', rank: 'text-xs sm:text-sm', suit: 'text-lg sm:text-xl', padding: 'p-1.5 sm:p-2' },
  lg: { outer: 'w-16 h-24 sm:w-20 sm:h-28', rank: 'text-sm sm:text-base', suit: 'text-xl sm:text-2xl', padding: 'p-2 sm:p-2.5' },
};

export default function PlayingCard({ card, onClick, isSelected, selectedVariant = 'gold', size = 'md', className = '' }: PlayingCardProps) {
  const sc = sizeConfig[size];
  const suit = suitConfig[card.suit] ?? { color: '#000', symbol: '?', isRed: false };
  const isTeal = selectedVariant === 'teal';

  /* ─── Face down ─── */
  if (card.faceDown) {
    return (
      <motion.div
        whileTap={onClick ? { scale: 0.92 } : undefined}
        onClick={onClick}
        className={`${sc.outer} rounded-lg flex-shrink-0 select-none relative overflow-hidden touch-target ${onClick ? 'cursor-pointer' : ''} ${className}`}
        style={{
          background: 'linear-gradient(135deg, #1a3a2a 0%, #0d1f13 100%)',
          border: '1.5px solid rgba(212,175,55,0.35)',
          boxShadow: '0 3px 10px rgba(0,0,0,0.6), inset 0 1px 0 rgba(212,175,55,0.1)',
        }}
      >
        {/* Pattern */}
        <div className="absolute inset-1 rounded" style={{
          backgroundImage: `repeating-linear-gradient(45deg, rgba(212,175,55,0.06) 0, rgba(212,175,55,0.06) 1px, transparent 0, transparent 50%),
            repeating-linear-gradient(-45deg, rgba(212,175,55,0.06) 0, rgba(212,175,55,0.06) 1px, transparent 0, transparent 50%)`,
          backgroundSize: '8px 8px',
        }} />
        {/* Center symbol */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="font-display text-xl opacity-40" style={{ color: '#d4af37' }}>✦</div>
        </div>
        {/* Border inner glow */}
        <div className="absolute inset-0 rounded-lg" style={{ boxShadow: 'inset 0 0 8px rgba(212,175,55,0.08)' }} />
      </motion.div>
    );
  }

  /* ─── Face up ─── */
  const isJQK = ['J', 'Q', 'K'].includes(card.rank);

  return (
    <motion.div
      whileTap={onClick ? { scale: 0.92 } : undefined}
      onClick={onClick}
      className={`${sc.outer} rounded-lg flex-shrink-0 select-none relative overflow-hidden touch-target ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{
        background: isSelected
          ? (isTeal ? 'linear-gradient(135deg, #f5fffb 0%, #e6fff6 100%)' : 'linear-gradient(135deg, #fffdf5 0%, #fff9e6 100%)')
          : 'linear-gradient(135deg, #ffffff 0%, #f8f6f0 100%)',
        border: isSelected
          ? (isTeal ? '2px solid #1abc9c' : '2px solid #d4af37')
          : '1.5px solid rgba(0,0,0,0.15)',
        boxShadow: isSelected
          ? (isTeal
            ? '0 0 0 3px rgba(22,160,133,0.3), 0 8px 20px rgba(0,0,0,0.5), 0 0 20px rgba(22,160,133,0.25)'
            : '0 0 0 3px rgba(212,175,55,0.3), 0 8px 20px rgba(0,0,0,0.5), 0 0 20px rgba(212,175,55,0.2)')
          : '0 2px 8px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3)',
        transform: isSelected ? 'translateY(-6px)' : undefined,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <div className={`absolute inset-0 flex flex-col justify-between ${sc.padding}`}>
        {/* Top-left rank + suit */}
        <div className="flex flex-col items-start leading-none">
          <span className={`${sc.rank} font-bold leading-none`} style={{ color: suit.color, fontFamily: 'Georgia, serif' }}>
            {card.rank}
          </span>
          <span className={`${sc.rank} leading-none mt-0.5`} style={{ color: suit.color }}>
            {suit.symbol}
          </span>
        </div>

        {/* Center suit */}
        <div className={`${sc.suit} text-center leading-none`} style={{ color: suit.color, opacity: isJQK ? 0.7 : 1 }}>
          {isJQK ? (
            <span className="font-bold" style={{ fontSize: '80%', fontFamily: 'Georgia, serif' }}>{card.rank}</span>
          ) : (
            suit.symbol
          )}
        </div>

        {/* Bottom-right rank + suit (rotated) */}
        <div className="flex flex-col items-end leading-none rotate-180">
          <span className={`${sc.rank} font-bold leading-none`} style={{ color: suit.color, fontFamily: 'Georgia, serif' }}>
            {card.rank}
          </span>
          <span className={`${sc.rank} leading-none mt-0.5`} style={{ color: suit.color }}>
            {suit.symbol}
          </span>
        </div>
      </div>

      {/* Point value badge (for scoring cards) */}
      {card.pointValue > 0 && (
        <div
          className="absolute top-0.5 right-0.5 rounded-full flex items-center justify-center font-bold leading-none"
          style={{
            width: size === 'sm' ? '14px' : '18px',
            height: size === 'sm' ? '14px' : '18px',
            fontSize: size === 'sm' ? '8px' : '10px',
            background: 'linear-gradient(135deg, #d4af37, #b8960c)',
            color: '#0d1f13',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}
        >
          {card.pointValue}
        </div>
      )}

      {/* Selected glow overlay */}
      {isSelected && (
        <div className="absolute inset-0 rounded-lg pointer-events-none"
          style={{ boxShadow: `inset 0 0 12px rgba(${isTeal ? '22,160,133' : '212,175,55'},0.15)` }} />
      )}
    </motion.div>
  );
}