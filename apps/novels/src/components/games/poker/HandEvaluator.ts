// 德州扑克手牌评估算法
// 基于简化 2+2 算法和五张牌最佳组合评估

import { Card, HandResult, HandRank, HandStrength } from "./PokerTypes";

// 创建一副标准扑克牌 (52 张)
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({
        suit: suit as 0 | 1 | 2 | 3,
        rank: rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13,
        faceUp: true
      });
    }
  }
  return deck;
}

// 洗牌
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// 发指定数量的牌
export function dealCards(deck: Card[], count: number): { cards: Card[]; remaining: Card[] } {
  return {
    cards: deck.slice(0, count),
    remaining: deck.slice(count)
  };
}

// 评估手牌 (返回最佳五张牌组合的评估结果)
export function evaluateHand(holeCards: Card[], communityCards: Card[]): HandResult {
  const allCards = [...holeCards, ...communityCards];
  
  if (allCards.length < 5) {
    return evaluatePartialHand(holeCards, communityCards);
  }
  
  // 找出所有 5 张牌的组合中最佳的那手
  let bestHand: HandResult = {
    rank: HandRank.HighCard,
    name: "高牌",
    kickers: [],
    handRankValue: 0
  };
  
  // 遍历所有 5 张牌组合
  const cardCount = allCards.length;
  for (let i = 0; i < cardCount - 4; i++) {
    for (let j = i + 1; j < cardCount - 3; j++) {
      for (let k = j + 1; k < cardCount - 2; k++) {
        for (let l = k + 1; l < cardCount - 1; l++) {
          for (let m = l + 1; m < cardCount; m++) {
            const fiveCards = [allCards[i], allCards[j], allCards[k], allCards[l], allCards[m]];
            const result = evaluateFiveCards(fiveCards);
            if (result.handRankValue > bestHand.handRankValue) {
              bestHand = result;
            }
          }
        }
      }
    }
  }
  
  return bestHand;
}

// 评估 5 张牌
function evaluateFiveCards(cards: Card[]): HandResult {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  
  // 检查同花
  const isFlush = suits.every(s => s === suits[0]);
  
  // 检查顺子 (包括 A-2-3-4-5 的特殊顺子)
  const isStraight = checkStraight(ranks);
  
  // 计算各点数的数量
  const rankCounts: Map<number, number> = new Map();
  for (const r of ranks) {
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  }
  
  // 排序: 先按数量降序, 再按点数降序
  const sortedRanks = Array.from(rankCounts.entries())
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  
  const counts = sortedRanks.map(e => e[1]);
  const uniqueRanks = sortedRanks.map(e => e[0]);
  
  let rank: HandRank;
  let handRankValue: number;
  const kickers: number[] = [];
  
  // 皇家同花顺
  if (isFlush && isStraight && ranks[0] === 13 && ranks[1] === 12) { // K, Q
    rank = HandRank.RoyalFlush;
    handRankValue = 9 * 10000000000;
  }
  // 同花顺
  else if (isFlush && isStraight) {
    rank = HandRank.StraightFlush;
    handRankValue = 8 * 10000000000 + ranks[0] * 100000000;
  }
  // 四条
  else if (counts[0] === 4) {
    rank = HandRank.FourOfAKind;
    handRankValue = 7 * 10000000000 + uniqueRanks[0] * 100000000;
    kickers.push(uniqueRanks[1]);
  }
  // 葫芦
  else if (counts[0] === 3 && counts[1] === 2) {
    rank = HandRank.FullHouse;
    handRankValue = 6 * 10000000000 + uniqueRanks[0] * 100000000 + uniqueRanks[1] * 1000000;
  }
  // 同花
  else if (isFlush) {
    rank = HandRank.Flush;
    handRankValue = 5 * 10000000000 + ranks.reduce((sum, r, i) => sum + r * Math.pow(100, 4 - i), 0);
  }
  // 顺子
  else if (isStraight) {
    rank = HandRank.Straight;
    handRankValue = 4 * 10000000000 + ranks[0] * 100000000;
  }
  // 三条
  else if (counts[0] === 3) {
    rank = HandRank.ThreeOfAKind;
    handRankValue = 3 * 10000000000 + uniqueRanks[0] * 100000000;
    kickers.push(uniqueRanks[1]);
    kickers.push(uniqueRanks[2]);
  }
  // 两对
  else if (counts[0] === 2 && counts[1] === 2) {
    rank = HandRank.TwoPair;
    handRankValue = 2 * 10000000000 + Math.max(uniqueRanks[0], uniqueRanks[1]) * 100000000 + Math.min(uniqueRanks[0], uniqueRanks[1]) * 1000000 + uniqueRanks[2];
  }
  // 一对
  else if (counts[0] === 2) {
    rank = HandRank.OnePair;
    handRankValue = 1 * 10000000000 + uniqueRanks[0] * 100000000;
    kickers.push(uniqueRanks[1]);
    kickers.push(uniqueRanks[2]);
    kickers.push(uniqueRanks[3]);
  }
  // 高牌
  else {
    rank = HandRank.HighCard;
    handRankValue = ranks.reduce((sum, r, i) => sum + r * Math.pow(100, 4 - i), 0);
  }
  
  const rankNames: Record<HandRank, string> = {
    [HandRank.HighCard]: "高牌",
    [HandRank.OnePair]: "一对",
    [HandRank.TwoPair]: "两对",
    [HandRank.ThreeOfAKind]: "三条",
    [HandRank.Straight]: "顺子",
    [HandRank.Flush]: "同花",
    [HandRank.FullHouse]: "葫芦",
    [HandRank.FourOfAKind]: "四条",
    [HandRank.StraightFlush]: "同花顺",
    [HandRank.RoyalFlush]: "皇家同花顺"
  };
  
  return {
    rank,
    name: rankNames[rank],
    kickers,
    handRankValue
  };
}

// 检查是否为顺子
function checkStraight(ranks: number[]): boolean {
  // 检查普通顺子
  for (let i = 0; i < 4; i++) {
    if (ranks[i] - ranks[i + 1] !== 1) {
      // 不是普通顺子, 检查 A-2-3-4-5 特殊顺子
      if (i === 3 && ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
        return true;
      }
      return false;
    }
  }
  return true;
}

// 评估不完整的牌 (用于游戏早期阶段)
function evaluatePartialHand(holeCards: Card[], communityCards: Card[]): HandResult {
  const allCards = [...holeCards, ...communityCards];
  const ranks = allCards.map(c => c.rank).sort((a, b) => b - a);
  const suits = allCards.map(c => c.suit);
  
  // 检查同花可能性
  const suitCounts: Map<number, number> = new Map();
  for (const s of suits) {
    suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
  }
  const maxSuitCount = Math.max(...suitCounts.values());
  const hasFlushPotential = maxSuitCount >= 3;
  
  // 检查顺子可能性
  const rankSet = new Set(ranks);
  let straightPotential = false;
  const sortedRanks = [...rankSet].sort((a, b) => b - a);
  if (sortedRanks.length >= 3) {
    for (let i = 0; i < sortedRanks.length - 2; i++) {
      if (sortedRanks[i] - sortedRanks[i + 1] === 1 && sortedRanks[i + 1] - sortedRanks[i + 2] === 1) {
        straightPotential = true;
        break;
      }
    }
    // 检查 A-2-3 顺子可能性
    if (rankSet.has(1) && rankSet.has(2) && rankSet.has(3)) { // A as 1
      straightPotential = true;
    }
  }
  
  // 点数计数
  const rankCounts: Map<number, number> = new Map();
  for (const r of ranks) {
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  }
  
  const counts = Array.from(rankCounts.values()).sort((a, b) => b - a);
  const maxPairCount = counts[0] || 0;
  
  // 估算手牌强度
  let baseValue = 0;
  
  // 对子加分
  if (maxPairCount === 2) baseValue += 2;
  else if (maxPairCount === 3) baseValue += 5;
  else if (maxPairCount === 4) baseValue += 8;
  
  // 高牌加分
  if (ranks[0] >= 12) baseValue += 1; // Q,K,A
  if (ranks[0] === 1) baseValue += 1; // A as 1
  
  // 同花顺子加分
  if (hasFlushPotential) baseValue += 1.5;
  if (straightPotential) baseValue += 1;
  
  const rankNames: Record<number, string> = {
    0: "待定",
    1: "高牌",
    2: "一对",
    3: "两对",
    4: "三条",
    5: "顺子",
    6: "同花",
    7: "葫芦",
    8: "四条",
    9: "同花顺"
  };
  
  return {
    rank: Math.floor(baseValue) as HandRank,
    name: rankNames[Math.floor(baseValue)] || "待定",
    kickers: [],
    handRankValue: baseValue
  };
}

// 估算手牌强度 (用于 AI 决策)
export function estimateHandStrength(
  holeCards: Card[],
  communityCards: Card[],
  opponents: number = 1
): HandStrength {
  const result = evaluateHand(holeCards, communityCards);
  
  // 计算 outs
  const outs = calculateOuts(holeCards, communityCards);
  
  // 简化胜率估算
  // 基于手牌强度和 outs 的快速估算
  let winProb = estimateWinProbability(result.rank, holeCards, communityCards, opponents);
  
  return {
    rank: winProb,
    outs,
    potOdds: 0,
    impliedOdds: 0
  };
}

// 计算 outs (改进的牌数)
function calculateOuts(holeCards: Card[], communityCards: Card[]): number {
  const result = evaluateHand(holeCards, communityCards);
  
  // 如果已经很强, outs 很少
  if (result.rank >= HandRank.FullHouse) return 0;
  if (result.rank >= HandRank.ThreeOfAKind) return 3; // 可能改进到四条或葫芦
  
  // 简单估算: 基于当前牌型和剩余未发牌数
  const remaining = 5 - communityCards.length;
  let outs = 0;
  
  // 听牌估算
  if (remaining === 0) return 0;
  
  // 同花听牌: 9 outs
  if (result.rank === HandRank.Flush - 1) {
    outs = 9;
  }
  // 顺子听牌: 根据类型不同
  else if (result.rank === HandRank.Straight - 1) {
    // 两端顺子: 8 outs
    // 卡顺: 4 outs
    outs = 6; // 中等估算
  }
  
  return outs;
}

// 估算胜率 (简化算法)
function estimateWinProbability(
  currentRank: HandRank,
  holeCards: Card[],
  communityCards: Card[],
  opponents: number
): number {
  // 根据当前牌型估算
  let baseProb = 0;
  
  const totalCards = holeCards.length + communityCards.length;
  
  switch (currentRank) {
    case HandRank.RoyalFlush:
    case HandRank.StraightFlush:
      baseProb = 0.95;
      break;
    case HandRank.FourOfAKind:
      baseProb = 0.9;
      break;
    case HandRank.FullHouse:
      baseProb = 0.85;
      break;
    case HandRank.Flush:
      if (communityCards.length < 5) baseProb = 0.6;
      else baseProb = 0.8;
      break;
    case HandRank.Straight:
      if (communityCards.length < 5) baseProb = 0.5;
      else baseProb = 0.75;
      break;
    case HandRank.ThreeOfAKind:
      baseProb = 0.4;
      break;
    case HandRank.TwoPair:
      baseProb = 0.3;
      break;
    case HandRank.OnePair:
      baseProb = 0.2;
      break;
    default:
      // 基于高牌估算
      const maxRank = Math.max(...holeCards.map(c => c.rank));
      if (maxRank >= 13) baseProb = 0.15;
      else if (maxRank >= 10) baseProb = 0.1;
      else baseProb = 0.05;
  }
  
  // 考虑对手数量
  const opponentMultiplier = 1 - (opponents * 0.05);
  
  // 考虑公共牌数量
  if (communityCards.length === 0) {
    baseProb *= 0.5;
  } else if (communityCards.length === 3) {
    baseProb *= 0.8;
  } else if (communityCards.length === 4) {
    baseProb *= 0.9;
  }
  
  return Math.max(0.05, Math.min(0.95, baseProb * opponentMultiplier));
}

// 比较两手牌
export function compareHands(hand1: HandResult, hand2: HandResult): number {
  if (hand1.handRankValue > hand2.handRankValue) return 1;
  if (hand1.handRankValue < hand2.handRankValue) return -1;
  return 0;
}

// 获取起手牌强度评分 (用于 preflop)
export function getStartingHandStrength(card1: Card, card2: Card): number {
  const r1 = card1.rank;
  const r2 = card2.rank;
  const sameSuit = card1.suit === card2.suit;
  const connected = Math.abs(r1 - r2) === 1;
  const oneGap = Math.abs(r1 - r2) === 2;
  
  // 基础分数
  let score = (r1 + r2) / 2;
  
  // 对子加分
  if (r1 === r2) {
    score += 10 + (r1 >= 10 ? 5 : 0);
    return score;
  }
  
  // 同花加分
  if (sameSuit) score += 3;
  
  // 连牌加分
  if (connected) score += 2;
  else if (oneGap) score += 1;
  
  // 高牌加分
  if (r1 >= 12 || r2 >= 12) score += 2;
  if (r1 === 1 || r2 === 1) score += 1; // A as 1
  
  return score;
}

// 起手牌胜率表 (简化 2+2 算法)
const PREFLOP_WIN_RATES: Record<string, number> = {
  "AA": 0.85, "KK": 0.82, "QQ": 0.79, "JJ": 0.77, "TT": 0.74,
  "99": 0.71, "88": 0.68, "77": 0.65, "66": 0.62, "55": 0.59,
  "44": 0.56, "33": 0.53, "22": 0.50,
  "AKs": 0.67, "AQs": 0.64, "AJs": 0.62, "ATs": 0.60,
  "A9s": 0.58, "A8s": 0.56, "A7s": 0.54, "A6s": 0.52, "A5s": 0.51, "A4s": 0.49, "A3s": 0.48, "A2s": 0.47,
  "AKo": 0.63, "AQo": 0.60, "AJo": 0.58, "ATo": 0.56,
  "A9o": 0.53, "A8o": 0.50, "A7o": 0.47, "A6o": 0.44, "A5o": 0.42, "A4o": 0.40, "A3o": 0.38, "A2o": 0.36,
  "KQs": 0.60, "KJs": 0.58, "KTs": 0.56, "K9s": 0.53,
  "KQo": 0.57, "KJo": 0.54, "KTo": 0.51, "K9o": 0.48,
  "QJs": 0.55, "QTs": 0.53, "Q9s": 0.49,
  "QJo": 0.52, "QTo": 0.49, "Q9o": 0.45,
  "JTs": 0.53, "J9s": 0.48,
  "JTo": 0.50, "J9o": 0.44,
  "T9s": 0.50, "T8s": 0.45,
  "98s": 0.47, "97s": 0.43,
};

// 获取起手牌胜率
export function getPreflopWinRate(card1: Card, card2: Card, opponents: number = 1): number {
  const key = getHandKey(card1, card2);
  let rate = PREFLOP_WIN_RATES[key] || 0.35;
  
  // 调整对手数量
  if (opponents === 2) rate *= 0.95;
  else if (opponents === 3) rate *= 0.88;
  else if (opponents === 4) rate *= 0.80;
  else if (opponents >= 5) rate *= 0.72;
  
  return rate;
}

// 生成手牌键
function getHandKey(card1: Card, card2: Card): string {
  const r1 = card1.rank;
  const r2 = card2.rank;
  const sameSuit = card1.suit === card2.suit;
  
  const rank1 = r1 >= 10 ? (r1 === 11 ? "J" : r1 === 12 ? "Q" : "K") : String(r1);
  const rank2 = r2 >= 10 ? (r2 === 11 ? "J" : r2 === 12 ? "Q" : "K") : String(r2);
  
  // 确保高牌在前
  let highRank = rank1;
  let lowRank = rank2;
  if ((r1 < r2 && r1 !== 1) || r2 === 1) { // A is 1
    [highRank, lowRank] = [lowRank, highRank];
  }
  
  return highRank + lowRank + (sameSuit ? "s" : "o");
}

// 格式化手牌显示
export function formatHandDisplay(card1: Card, card2: Card): string {
  const ranks = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const r1 = ranks[card1.rank];
  const r2 = ranks[card2.rank];
  const suit1 = ["♠", "♥", "♣", "♦"][card1.suit];
  const suit2 = ["♠", "♥", "♣", "♦"][card2.suit];
  
  return `${r1}${suit1} ${r2}${suit2}`;
}

// 判断是否为同花
export function isFlush(cards: Card[]): boolean {
  if (cards.length < 5) return false;
  const suit = cards[0].suit;
  return cards.every(c => c.suit === suit);
}

// 判断是否为顺子
export function isStraight(cards: Card[]): boolean {
  if (cards.length < 5) return false;
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  return checkStraight(ranks);
}