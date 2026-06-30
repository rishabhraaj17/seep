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
  team: number,
  players: { id: string; team: number }[]
): BotPlay {
  const plays: BotPlay[] = [];

  for (const card of hand) {
    const val = getCardNumericValue(card);

    // 1. EVALUATE HOUSE CAPTURES
    // Any player can capture a house of value 'val' using card 'val'
    const matchingHouses = gameState.houses.filter(h => h.value === val);
    if (matchingHouses.length > 0) {
      let housePoints = 0;
      const targetHouseCards: Card[] = [];
      matchingHouses.forEach(h => {
        housePoints += h.cards.reduce((sum, c) => sum + getPointValue(c), 0);
        targetHouseCards.push(...h.cards);
      });
      // We can also capture loose cards on the floor that match/sum to 'val'
      const floorMatches = floor.filter(fc => getCardNumericValue(fc) === val);
      const floorPoints = floorMatches.reduce((sum, c) => sum + getPointValue(c), 0);
      
      const score = 1500 + housePoints + floorPoints + getPointValue(card);
      plays.push({
        action: 'CAPTURE',
        card,
        targetCards: [...targetHouseCards, ...floorMatches],
        score
      });
    }

    // 2. EVALUATE CONTRIBUTING TO TEAMMATE'S HOUSE (CEMENTING)
    // teammate's house of value 'val', not pukta, contribute to it
    const teamHouses = gameState.houses.filter(h => {
      const creator = players.find(p => p.id === h.createdBy);
      return creator && creator.team === team && h.value === val && !h.isPukta;
    });
    for (const h of teamHouses) {
      const score = 1200 + getPointValue(card);
      plays.push({
        action: 'BUILD_HOUSE',
        card,
        targetCards: h.cards,
        houseValue: val,
        score
      });
    }

    // 3. EVALUATE DISTORTING OPPONENT'S HOUSE
    // Opponent's house of value 'V' < val (val between 9-13), not pukta
    if (val >= 9 && val <= 13) {
      const opponentHouses = gameState.houses.filter(h => {
        const creator = players.find(p => p.id === h.createdBy);
        return creator && creator.team !== team && h.value < val && !h.isPukta && h.value !== 13;
      });
      for (const h of opponentHouses) {
        // Need a card in hand that equals (val - h.value)
        const neededVal = val - h.value;
        const hasHelper = hand.find(hc => hc.id !== card.id && getCardNumericValue(hc) === neededVal);
        if (hasHelper) {
          const housePoints = h.cards.reduce((sum, c) => sum + getPointValue(c), 0);
          const score = 1000 + housePoints + getPointValue(card);
          plays.push({
            action: 'BUILD_HOUSE',
            card,
            targetCards: h.cards,
            houseValue: val,
            score
          });
        }
      }
    }

    // 4. EVALUATE FLOOR LOOSE CAPTURES
    // Direct matches
    const floorMatches = floor.filter(fc => getCardNumericValue(fc) === val);
    if (floorMatches.length > 0) {
      const score = 800 + floorMatches.reduce((sum, c) => sum + getPointValue(c), 0) + getPointValue(card);
      plays.push({
        action: 'CAPTURE',
        card,
        targetCards: floorMatches,
        score
      });
    }
    // Sum combinations (pairs)
    for (let i = 0; i < floor.length; i++) {
      for (let j = i + 1; j < floor.length; j++) {
        if (getCardNumericValue(floor[i]) + getCardNumericValue(floor[j]) === val) {
          const score = 800 + getPointValue(floor[i]) + getPointValue(floor[j]) + getPointValue(card);
          plays.push({
            action: 'CAPTURE',
            card,
            targetCards: [floor[i], floor[j]],
            score
          });
        }
      }
    }

    // 5. EVALUATE CREATING A NEW HOUSE
    if (val >= 9 && val <= 13) {
      // Find floor card we can combine with
      for (const fc of floor) {
        if (getCardNumericValue(fc) < val) {
          const needed = val - getCardNumericValue(fc);
          const extra = hand.find(hc => hc.id !== card.id && getCardNumericValue(hc) === needed);
          if (extra) {
            plays.push({ action: 'BUILD_HOUSE', card, targetCards: [fc], houseValue: val, score: 500 });
          }
        }
      }
    }

    // 6. THROW
    const currentTableSum = floor.reduce((sum, fc) => sum + getCardNumericValue(fc), 0);
    const postThrowSum = currentTableSum + val;
    const seepRisk = postThrowSum <= 13;
    const throwScore = seepRisk ? 50 - val : 100 - val;
    plays.push({ action: 'THROW', card, targetCards: [], score: throwScore });
  }

  plays.sort((a, b) => b.score - a.score);
  return plays[0];
}
