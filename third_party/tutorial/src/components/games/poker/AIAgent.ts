// 德州扑克 AI 决策逻辑
// 基于手牌强度、位置、下注历史等多因素决策

import { 
  PokerPlayer, 
  PokerGameState, 
  ActionType, 
  HandStrength,
  AIContEXT,
  RaiseOption,
  Card,
  HandRank
} from "./PokerTypes";
import { 
  evaluateHand, 
  estimateHandStrength, 
  getPreflopWinRate,
  getStartingHandStrength
} from "./HandEvaluator";

// AI 性格类型
export enum AIAggressiveness {
  TIGHT = "tight",      // 紧：只玩强牌
  LOOSE = "loose",      // 松：玩更多牌
  CONSERVATIVE = "conservative", // 保守：谨慎下注
  AGGRESSIVE = "aggressive",     // 激进：频繁加注
  BALANCED = "balanced"          // 均衡：平衡策略
}

export interface AIConfig {
  aggressiveness: AIAggressiveness;
  thinkingTime: number;    // 思考时间 (ms)
  bluffFrequency: number;  // 诈唬频率 (0-1)
  raiseFrequency: number;  // 加注频率 (0-1)
  callThreshold: number;   // 跟注阈值
}

// 预设 AI 配置
const AI_CONFIGS: Record<AIAggressiveness, AIConfig> = {
  [AIAggressiveness.TIGHT]: {
    aggressiveness: AIAggressiveness.TIGHT,
    thinkingTime: 800,
    bluffFrequency: 0.1,
    raiseFrequency: 0.2,
    callThreshold: 0.5
  },
  [AIAggressiveness.LOOSE]: {
    aggressiveness: AIAggressiveness.LOOSE,
    thinkingTime: 600,
    bluffFrequency: 0.3,
    raiseFrequency: 0.4,
    callThreshold: 0.35
  },
  [AIAggressiveness.CONSERVATIVE]: {
    aggressiveness: AIAggressiveness.CONSERVATIVE,
    thinkingTime: 900,
    bluffFrequency: 0.1,
    raiseFrequency: 0.15,
    callThreshold: 0.55
  },
  [AIAggressiveness.AGGRESSIVE]: {
    aggressiveness: AIAggressiveness.AGGRESSIVE,
    thinkingTime: 500,
    bluffFrequency: 0.4,
    raiseFrequency: 0.6,
    callThreshold: 0.3
  },
  [AIAggressiveness.BALANCED]: {
    aggressiveness: AIAggressiveness.BALANCED,
    thinkingTime: 700,
    bluffFrequency: 0.25,
    raiseFrequency: 0.35,
    callThreshold: 0.4
  }
};

// AI 玩家接口
export interface AIAgent {
  playerId: string;
  config: AIConfig;
  decide(gameState: PokerGameState): Promise<{ action: ActionType; amount: number }>;
}

// 创建 AI 代理
export function createAIAgent(playerId: string, personality?: AIAggressiveness): AIAgent {
  const config = AI_CONFIGS[personality || AIAggressiveness.BALANCED];
  
  return {
    playerId,
    config,
    async decide(gameState: PokerGameState): Promise<{ action: ActionType; amount: number }> {
      // 模拟思考时间
      await new Promise(resolve => setTimeout(resolve, config.thinkingTime));
      
      const player = gameState.players.find(p => p.id === playerId);
      if (!player || player.status === "folded" || player.chips === 0) {
        return { action: "fold", amount: 0 };
      }
      
      // 构建 AI 上下文
      const context = buildAIContext(player, gameState);
      
      // 计算手牌强度
      const handStrength = estimateHandStrength(
        player.cards,
        gameState.communityCards,
        countActiveOpponents(gameState)
      );
      
      // 根据游戏阶段选择策略
      let action: ActionType;
      let amount: number;
      
      switch (gameState.phase) {
        case "preflop":
          ({ action, amount } = decidePreflop(player, gameState, config, context));
          break;
        case "flop":
        case "turn":
        case "river":
          ({ action, amount } = decidePostflop(player, gameState, config, handStrength, context));
          break;
        default:
          action = "check";
          amount = 0;
      }
      
      return { action, amount };
    }
  };
}

// 构建 AI 决策上下文
function buildAIContext(player: PokerPlayer, gameState: PokerGameState): AIContEXT {
  const activePlayers = gameState.players.filter(p => p.status === "playing" && p.chips > 0);
  const playerIndex = gameState.players.findIndex(p => p.id === player.id);
  
  return {
    handStrength: { rank: 0, outs: 0, potOdds: 0, impliedOdds: 0 },
    position: playerIndex,
    remainingPlayers: activePlayers.length,
    potSize: gameState.pot,
    currentBet: gameState.currentBet,
    chipsToCall: gameState.currentBet - player.currentBet,
    playerChips: player.chips,
    bettingHistory: [],
    communityCards: gameState.communityCards,
    holeCards: player.cards
  };
}

// preflop 决策
function decidePreflop(
  player: PokerPlayer, 
  gameState: PokerGameState, 
  config: AIConfig,
  context: AIContEXT
): { action: ActionType; amount: number } {
  const chipsToCall = gameState.currentBet - player.currentBet;
  const bigBlind = gameState.bigBlind;
  const minRaise = gameState.minRaise;
  
  // 计算起手牌强度
  const card1 = player.cards[0];
  const card2 = player.cards[1];
  const startingStrength = getStartingHandStrength(card1, card2);
  const preflopWinRate = getPreflopWinRate(card1, card2, countActiveOpponents(gameState));
  
  // 小盲位和大盲位处理
  const isSmallBlind = player.currentBet === gameState.smallBlind / 2;
  const isBigBlind = player.currentBet === gameState.bigBlind;
  const hasActed = player.currentBet > 0;
  
  // 激进玩家更愿意玩边缘牌
  const strengthModifier = config.aggressiveness === AIAggressiveness.LOOSE ? 0.1 : 
                          config.aggressiveness === AIAggressiveness.TIGHT ? -0.1 : 0;
  
  const adjustedStrength = preflopWinRate + strengthModifier;
  
  // 决策逻辑
  if (chipsToCall === 0) {
    // 没有人加注，可以选择跟盲或加注
    if (adjustedStrength > 0.6 && Math.random() < config.raiseFrequency) {
      const raiseAmount = bigBlind * (2 + Math.floor(Math.random() * 2));
      return { action: "raise", amount: Math.min(raiseAmount, player.chips) };
    }
    return { action: "check", amount: 0 };
  }
  
  // 需要跟注
  const potOdds = chipsToCall / (gameState.pot + chipsToCall);
  
  // 强牌: 加注
  if (adjustedStrength > 0.7 && chipsToCall <= player.chips * 0.3) {
    const raiseAmount = chipsToCall + bigBlind * (1 + Math.floor(Math.random() * 2));
    return { action: "raise", amount: Math.min(raiseAmount, player.chips) };
  }
  
  // 中等强度: 跟注或弃牌
  if (adjustedStrength > config.callThreshold) {
    // 根据赔率决定
    if (potOdds < 0.25 || chipsToCall <= bigBlind * 2) {
      return { action: "call", amount: chipsToCall };
    }
    // 紧玩家可能弃牌
    if (config.aggressiveness === AIAggressiveness.TIGHT && adjustedStrength < 0.5) {
      return { action: "fold", amount: 0 };
    }
  }
  
  // 弱牌: 弃牌 (除非底池赔率极高)
  if (adjustedStrength < 0.35 && potOdds > 0.4) {
    return { action: "call", amount: chipsToCall };
  }
  
  if (adjustedStrength < 0.3) {
    return { action: "fold", amount: 0 };
  }
  
  // 默认跟注
  return { action: "call", amount: Math.min(chipsToCall, player.chips) };
}

// postflop 决策
function decidePostflop(
  player: PokerPlayer, 
  gameState: PokerGameState, 
  config: AIConfig,
  handStrength: HandStrength,
  context: AIContEXT
): { action: ActionType; amount: number } {
  const chipsToCall = gameState.currentBet - player.currentBet;
  const bigBlind = gameState.bigBlind;
  const currentPot = gameState.pot + gameState.currentBet;
  
  // 计算手牌强度
  const result = evaluateHand(player.cards, gameState.communityCards);
  const strengthValue = result.handRankValue / 10000000000;
  
  // 计算底池赔率
  const potOdds = chipsToCall > 0 ? chipsToCall / (currentPot + chipsToCall) : 0;
  
  // 分析对手行为
  const opponentActions = analyzeOpponentActions(gameState, player.id);
  
  // 决策
  if (chipsToCall === 0) {
    // 没人下注，可以下注或过牌
    
    // 强牌: 下注
    if (strengthValue >= 5) { // 同花顺及以上
      const betAmount = calculateBetAmount(gameState, player, 1.5);
      return { action: "raise", amount: Math.min(betAmount, player.chips) };
    }
    
    if (strengthValue >= 3) { // 三条及以上
      if (Math.random() < config.raiseFrequency * 1.5) {
        const betAmount = calculateBetAmount(gameState, player, 1);
        return { action: "raise", amount: Math.min(betAmount, player.chips) };
      }
      return { action: "check", amount: 0 };
    }
    
    // 中等强度: 过牌，偶往下注
    if (strengthValue >= 1 && Math.random() < config.raiseFrequency * 0.5) {
      const betAmount = calculateBetAmount(gameState, player, 0.5);
      return { action: "raise", amount: Math.min(betAmount, player.chips) };
    }
    
    // 弱牌: 过牌
    return { action: "check", amount: 0 };
  }
  
  // 需要跟注/加注
  // 强牌: 加注
  if (strengthValue >= 6) {
    const raiseAmount = calculateBetAmount(gameState, player, 1.2);
    return { action: "raise", amount: Math.min(raiseAmount, player.chips) };
  }
  
  // 中等强度
  if (strengthValue >= 2) {
    // 根据赔率判断
    if (potOdds < 0.3 && Math.random() < config.callThreshold) {
      return { action: "call", amount: Math.min(chipsToCall, player.chips) };
    }
    // 如果对手示弱，考虑加注
    if (opponentActions.isPassive && Math.random() < config.raiseFrequency * 0.7) {
      const raiseAmount = calculateBetAmount(gameState, player, 0.8);
      return { action: "raise", amount: Math.min(raiseAmount, player.chips) };
    }
  }
  
  // 听牌: 根据赔率决定
  const outs = handStrength.outs;
  if (outs >= 8) {
    if (potOdds > 0.2 || chipsToCall <= player.chips * 0.1) {
      return { action: "call", amount: Math.min(chipsToCall, player.chips) };
    }
  }
  
  // 弱牌: 考虑弃牌或诈唬
  if (strengthValue < 1) {
    // 诈唬机会
    if (opponentActions.isPassive && Math.random() < config.bluffFrequency) {
      const bluffAmount = calculateBetAmount(gameState, player, 0.7);
      return { action: "raise", amount: Math.min(bluffAmount, player.chips) };
    }
    
    if (potOdds > 0.35) {
      return { action: "call", amount: Math.min(chipsToCall, player.chips) };
    }
    
    return { action: "fold", amount: 0 };
  }
  
  // 默认跟注
  return { action: "call", amount: Math.min(chipsToCall, player.chips) };
}

// 计算下注金额
function calculateBetAmount(
  gameState: PokerGameState, 
  player: PokerPlayer,
  multiplier: number
): number {
  const pot = gameState.pot;
  const baseBet = pot * multiplier;
  const variance = baseBet * (0.5 + Math.random() * 0.5);
  
  return Math.max(gameState.minRaise, Math.floor(baseBet + variance));
}

// 分析对手行为
function analyzeOpponentActions(gameState: PokerGameState, excludePlayerId: string): {
  isPassive: boolean;
  isAggressive: boolean;
  avgBet: number;
} {
  const activePlayers = gameState.players.filter(p => p.id !== excludePlayerId && p.status === "playing");
  
  if (activePlayers.length === 0) {
    return { isPassive: true, isAggressive: false, avgBet: 0 };
  }
  
  const bets = activePlayers.map(p => p.currentBet);
  const avgBet = bets.reduce((a, b) => a + b, 0) / bets.length;
  
  // 根据平均下注判断
  const isAggressive = avgBet > gameState.bigBlind * 3;
  const isPassive = avgBet < gameState.bigBlind;
  
  return { isPassive, isAggressive, avgBet };
}

// 统计活跃对手数
function countActiveOpponents(gameState: PokerGameState): number {
  return gameState.players.filter(p => 
    p.status === "playing" && p.chips > 0
  ).length - 1;
}

// 获取加注选项
export function getRaiseOptions(
  player: PokerPlayer,
  gameState: PokerGameState
): RaiseOption[] {
  const minRaise = gameState.minRaise;
  const maxRaise = Math.min(player.chips, gameState.pot * 3);
  
  if (maxRaise < minRaise) return [];
  
  const options: RaiseOption[] = [
    { amount: minRaise, label: `${minRaise}` }
  ];
  
  if (maxRaise >= minRaise * 2) {
    options.push({ amount: minRaise * 2, label: `${minRaise * 2}` });
  }
  
  if (maxRaise >= gameState.pot * 0.5) {
    const halfPot = Math.floor(gameState.pot * 0.5);
    if (halfPot >= minRaise) {
      options.push({ amount: halfPot, label: "半池" });
    }
  }
  
  if (maxRaise >= gameState.pot) {
    const fullPot = gameState.pot;
    options.push({ amount: fullPot, label: "一池" });
  }
  
  if (maxRaise >= gameState.pot * 1.5) {
    const pot150 = Math.floor(gameState.pot * 1.5);
    options.push({ amount: pot150, label: "1.5池" });
  }
  
  if (player.chips > gameState.pot * 2) {
    const allIn = player.chips;
    options.push({ amount: allIn, label: "全下" });
  }
  
  return options;
}

// 选择 AI 性格
export function selectAIPersonality(seatPosition: number): AIAggressiveness {
  const personalities: AIAggressiveness[] = [
    AIAggressiveness.TIGHT,
    AIAggressiveness.BALANCED,
    AIAggressiveness.AGGRESSIVE,
    AIAggressiveness.CONSERVATIVE,
    AIAggressiveness.LOOSE
  ];
  
  return personalities[seatPosition % personalities.length];
}