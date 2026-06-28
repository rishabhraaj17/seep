import PlayingCard from './PlayingCard';
import type { Card } from '../types';

interface PlayerHandProps {
  cards: Card[];
  position: 'top' | 'bottom' | 'left' | 'right';
  isOpponent?: boolean;
  selectedCard?: Card | null;
  onSelectCard?: (card: Card) => void;
}

export default function PlayerHand({
  cards,
  position,
  isOpponent = false,
  selectedCard,
  onSelectCard,
}: PlayerHandProps) {
  // Mobile-friendly card sizing
  const cardSize = position === 'top' || position === 'bottom' ? 'sm' : 'sm';

  if (position === 'left' || position === 'right') {
    return (
      <div className="flex flex-col gap-1 sm:gap-2">
        {cards.map((card, _index) => (
          <PlayingCard
            key={card.id}
            card={{ ...card, faceDown: isOpponent }}
            size={cardSize}
          />
        ))}
      </div>
    );
  }

  // Mobile-friendly horizontal layout with proper spacing
  const rotation = position === 'top' ? 'rotate-180' : '';
  const gapClass = position === 'bottom'
    ? 'gap-2 sm:gap-3 md:gap-4'
    : 'gap-1 sm:gap-2';

  return (
    <div className={`flex flex-wrap justify-center ${gapClass} ${rotation} px-2`}>
      {cards.map((card, _index) => (
        <PlayingCard
          key={card.id}
          card={{ ...card, faceDown: isOpponent }}
          onClick={!isOpponent ? () => onSelectCard?.(card) : undefined}
          isSelected={selectedCard?.id === card.id && !isOpponent}
          size={cardSize}
        />
      ))}
    </div>
  );
}