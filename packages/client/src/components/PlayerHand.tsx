import PlayingCard from './PlayingCard';
import type { Card } from '../types';

interface PlayerHandProps {
  cards: Card[];
  position: 'top' | 'bottom' | 'left' | 'right';
  isOpponent?: boolean;
  selectedCard?: Card | null;
  onSelectCard?: (card: Card) => void;
  label?: string;
  onDragStart?: (e: React.DragEvent, card: Card) => void;
}

export default function PlayerHand({
  cards,
  position,
  isOpponent = false,
  selectedCard,
  onSelectCard,
  label,
  onDragStart,
}: PlayerHandProps) {
  const isVertical = position === 'left' || position === 'right';
  const cardSize = isVertical ? 'sm' : (position === 'bottom' ? 'md' : 'sm');
  const faceDown = isOpponent;

  if (isVertical) {
    return (
      <div className="flex flex-col items-center gap-1">
        {label && (
          <div className="text-xs font-display tracking-wide mb-1 px-2 py-0.5 rounded-full"
            style={{ color: 'rgba(212,175,55,0.6)', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.15)' }}>
            {label}
          </div>
        )}
        <div className="flex flex-col gap-[-6px]">
          {cards.map((card, i) => (
            <div key={card.id + i} style={{ marginTop: i > 0 ? '-18px' : 0, zIndex: i }}>
              <PlayingCard card={{ ...card, faceDown }} size={cardSize} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const rotation = position === 'top' ? 'rotate-180' : '';
  const isBottom = position === 'bottom';

  return (
    <div className="flex flex-col items-center">
      {label && !isBottom && (
        <div className="text-xs font-display tracking-wide mb-1.5 px-2 py-0.5 rounded-full"
          style={{ color: 'rgba(212,175,55,0.6)', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.15)' }}>
          {label}
        </div>
      )}

      <div className={`flex items-end ${rotation}`} style={{ gap: isBottom ? '-4px' : '-8px' }}>
        {cards.map((card, i) => {
          const isSelected = !isOpponent && selectedCard?.id === card.id;
          // Slight fan effect for bottom hand
          const fanRotate = isBottom ? ((i - (cards.length - 1) / 2) * 2.5) : 0;
          const fanY = isBottom ? (Math.abs(i - (cards.length - 1) / 2) * 3) : 0;

          return (
            <div
              key={card.id}
              draggable={!isOpponent}
              onDragStart={!isOpponent && onDragStart ? (e) => onDragStart(e, card) : undefined}
              style={{
                marginLeft: i > 0 ? (isBottom ? '-6px' : '-10px') : 0,
                zIndex: isSelected ? 50 : i,
                transform: `rotate(${fanRotate}deg) translateY(${isSelected ? -10 : fanY}px)`,
                transition: 'transform 0.15s ease',
              }}
            >
              <PlayingCard
                card={{ ...card, faceDown }}
                size={cardSize}
                isSelected={isSelected}
                onClick={!isOpponent && onSelectCard ? () => onSelectCard(card) : undefined}
              />
            </div>
          );
        })}
      </div>

      {label && isBottom && (
        <div className="text-xs font-display tracking-wide mt-2 px-2 py-0.5 rounded-full"
          style={{ color: '#d4af37', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)' }}>
          {label} ⭐
        </div>
      )}
    </div>
  );
}