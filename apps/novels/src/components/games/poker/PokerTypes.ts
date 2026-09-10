// 德州扑克核心类型定义

// 花色: 黑桃、红心、梅花、方块
export type Suit = 0 | 1 | 2 | 3;
export const SUIT_SYMBOLS = ["♠", "♥", "♣", "♦"];
export const SUIT_COLORS = ["black", "red", "black", "red"];

// 点数: A(1), 2-10, J(11), Q(12), K(13)
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export const RANK_SYMBOLS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

// 一张纸牌
export interface Card {
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
}

// 玩家行动
export type ActionType = "fold" | "check" | "call" | "raise" | "all-in" | "none";

// 玩家状态
export type PlayerStatus = "playing" | "folded" | "all-in" | "bust";

// 德州扑克玩家
export interface PokerPlayer {
  id: string;
  name: string;
  chips: number;           // 当前筹码
  initialChips: number;    // 初始筹码
  cards: Card[];           // 手牌
  isAI: boolean;
  isHuman: boolean;
  status: PlayerStatus;
  currentBet: number;      // 本轮已下注
  lastAction: ActionType;
  position: number;        // 座位位置 (0 = 小盲位)
}

// 游戏阶段
export type GamePhase = "preflop" | "flop" | "turn" | "river" | "showdown" | "gameover";

// 德州扑克游戏状态
export interface PokerGameState {
  players: PokerPlayer[];
  communityCards: Card[];   // 公共牌
  pot: number;             // 底池
  currentBet: number;      // 当前下注额
  minRaise: number;        // 最小加注额
  dealerIndex: number;     // 庄家位置
  currentPlayerIndex: number; // 当前行动玩家
  phase: GamePhase;
  bigBlind: number;
  smallBlind: number;
  roundBets: number;       // 本轮总下注
  potShared: boolean;      // 是否已分池
}

// 游戏配置
export interface PokerGameConfig {
  aiCount: number;
  nickname: string;
  initialChips?: number;
  bigBlind?: number;
  minBuyIn?: number;
  maxBuyIn?: number;
}

// 行动历史记录
export interface ActionRecord {
  playerId: string;
  action: ActionType;
  amount: number;
  timestamp: number;
}

// 游戏结果
export interface GameResult {
  playerId: string;
  won: boolean;
  amount: number;
  hand: HandResult | null;
}

// 手牌评估结果
export interface HandResult {
  rank: HandRank;          // 牌型
  name: string;           // 牌型名称
  kickers: number[];      // 踢子牌
  handRankValue: number;   // 用于比较的数值
}

// 牌型枚举 (从低到高)
export enum HandRank {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

// 手牌强度 (用于 AI 决策)
export interface HandStrength {
  rank: number;           // 0-1 之间的数值
  outs: number;           // outs 数量
  potOdds: number;        // 底池赔率
  impliedOdds: number;    // 隐含赔率
}

// AI 决策上下文
export interface AIContEXT {
  handStrength: HandStrength;
  position: number;
  remainingPlayers: number;
  potSize: number;
  currentBet: number;
  chipsToCall: number;
  playerChips: number;
  bettingHistory: ActionRecord[];
  communityCards: Card[];
  holeCards: Card[];
}

// 预设加注选项
export interface RaiseOption {
  amount: number;
  label: string;
}