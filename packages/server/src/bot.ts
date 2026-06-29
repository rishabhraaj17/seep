import { Card, GameState, getCardNumericValue, getPointValue } from './index.js';

export interface BotPlay {
  action: 'CAPTURE' | 'BUILD_HOUSE' | 'THROW';
  card: Card;
  targetCards: Card[];
  houseValue?: number;
  score: number;
}

export function chooseBestBotMove(
  botId: string,
  hand: Card[],
  floor: Card[],
  gameState: GameState,
  team: 1 | 2
): BotPlay {
  const plays: BotPlay[] = [];

  // Evaluate all cards in hand
  for (const card of hand) {
    const val = getCardNumericValue(card);

    // A. CAPTURES
    // 1. Direct captures
    const matches = floor.filter(fc => getCardNumericValue(fc) === val);
    if (matches.length > 0) {
      const score = 1000 + matches.reduce((sum, c) => sum + getPointValue(c), 0) + getPointValue(card);
      plays.push({ action: 'CAPTURE', card, targetCards: matches, score });
    }

    // 2. Sum captures
    // Check combination pairs
    for (let i = 0; i < floor.length; i++) {
      for (let j = i + 1; j < floor.length; j++) {
        if (getCardNumericValue(floor[i]) + getCardNumericValue(floor[j]) === val) {
          const score = 1000 + getPointValue(floor[i]) + getPointValue(floor[j]) + getPointValue(card);
          plays.push({ action: 'CAPTURE', card, targetCards: [floor[i], floor[j]], score });
        }
      }
    }

    // B. BUILD HOUSES (if card is between 9 and 13)
    if (val >= 9 && val <= 13) {
      // Build with floor card
      for (const fc of floor) {
        if (getCardNumericValue(fc) < val) {
          const needed = val - getCardNumericValue(fc);
          const extra = hand.find(hc => hc.id !== card.id && getCardNumericValue(hc) === needed);
          if (extra) {
            plays.push({ action: 'BUILD_HOUSE', card, targetCards: [fc], houseValue: val, score: 300 });
          }
        }
      }
    }

    // C. THROW (default safe option)
    // Check if throw setup a seep (total table sum under 14)
    const currentTableSum = floor.reduce((sum, fc) => sum + getCardNumericValue(fc), 0);
    const postThrowSum = currentTableSum + val;
    const seepRisk = postThrowSum <= 13;
    const throwScore = seepRisk ? 50 - val : 100 - val; // Prefer throwing small cards, heavily penalize seep risks

    plays.push({ action: 'THROW', card, targetCards: [], score: throwScore });
  }

  // Sort by score descending and return best play
  plays.sort((a, b) => b.score - a.score);
  return plays[0];
}
