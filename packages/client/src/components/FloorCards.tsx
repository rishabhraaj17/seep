import { motion } from 'motion/react';
import PlayingCard from './PlayingCard';
import type { Card } from '../types';

interface FloorCardsProps {
  cards: Card[];
}

export default function FloorCards({ cards }: FloorCardsProps) {
  return (
    <div className="flex flex-wrap gap-3 justify-center items-center p-4">
      {cards.map((card, index) => (
        <motion.div
          key={card.id + index}
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <PlayingCard card={card} size="lg" />
        </motion.div>
      ))}
      {cards.length === 0 && (
        <div className="text-slate-400 text-center">
          <p>Floor is empty</p>
          <p className="text-sm">(Throw a card to start building)</p>
        </div>
      )}
    </div>
  );
}