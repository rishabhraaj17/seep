import { motion } from 'motion/react';
import PlayingCard from './PlayingCard';
import type { Card } from '../types';

interface FloorCardsProps {
  cards: Card[];
  highlightedIds?: string[];
  onCardClick?: (card: Card) => void;
  onDropOnCard?: (e: React.DragEvent, card: Card) => void;
  hideEmptyMessage?: boolean;
}

export default function FloorCards({ cards, highlightedIds = [], onCardClick, onDropOnCard, hideEmptyMessage = false }: FloorCardsProps) {
  return (
    <div className="flex flex-wrap gap-2 sm:gap-3 justify-center items-center p-4 max-w-lg">
      {cards.map((card, index) => (
        <motion.div
          key={card.id + index}
          initial={{ scale: 0, rotate: Math.random() * 20 - 10, y: -20 }}
          animate={{ scale: 1, rotate: 0, y: 0 }}
          transition={{ delay: index * 0.06, type: 'spring', stiffness: 300, damping: 20 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDropOnCard ? (e) => onDropOnCard(e, card) : undefined}
        >
          <PlayingCard
            card={card}
            size="lg"
            isSelected={highlightedIds.includes(card.id)}
            selectedVariant="teal"
            onClick={onCardClick ? () => onCardClick(card) : undefined}
          />
        </motion.div>
      ))}

      {cards.length === 0 && !hideEmptyMessage && (
        <div className="flex flex-col items-center gap-2 py-6">
          <div className="text-4xl opacity-20 select-none">🃏</div>
          <p className="text-sm font-display" style={{ color: 'rgba(var(--text-rgb),0.3)' }}>Floor is empty</p>
          <p className="text-xs" style={{ color: 'rgba(var(--text-rgb),0.2)' }}>Throw a card to begin</p>
        </div>
      )}
    </div>
  );
}