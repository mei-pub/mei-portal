"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { 
  Card, 
  PokerPlayer, 
  PokerGameState, 
  ActionType, 
  GamePhase, 
  PokerGameConfig,
  HandResult,
  SUIT_SYMBOLS,
  SUIT_COLORS,
  RANK_SYMBOLS
} from "./poker/PokerTypes";
import { 
  createDeck, 
  shuffleDeck, 
  dealCards, 
  evaluateHand 
} from "./poker/HandEvaluator";
import { 
  createAIAgent, 
  AIAgent, 
  getRaiseOptions, 
  AIAggressiveness,
  selectAIPersonality 
} from "./poker/AIAgent";

// 游戏状态
type PokerStatus = "betting" | "ai_thinking" | "showdown" | "gameover";

// 发牌动画状态
interface DealAnimation {
  active: boolean;
  phase: number;
}

export default function PokerGame({ config }: { config: PokerGameConfig }) {
  // 游戏状态
  const [gameState, setGameState] = useState<PokerGameState | null>(null);
  const [status, setStatus] = useState<PokerStatus>("betting");
  const [currentHumanPlayerId, setCurrentHumanPlayerId] = useState<string | null>(null);
  const [showAllCards, setShowAllCards] = useState(false);
  const [gameResult, setGameResult] = useState<{
    winner: string;
    hand: HandResult;
    amount: number;
  } | null>(null);
  
  // AI 代理
  const aiAgentsRef = useRef<Map<string, AIAgent>>(new Map());
  
  // 发牌动画
  const [dealAnimation, setDealAnimation] = useState<DealAnimation>({ active: false, phase: 0 });
  
  // 下注对话框
  const [showBetDialog, setShowBetDialog] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);
  
  // 当前下注玩家
  const [actingPlayerId, setActingPlayerId] = useState<string | null>(null);
  
  const bigBlind = config.bigBlind || 20;
  const smallBlind = Math.floor(bigBlind / 2);
  
  // 初始化游戏
  const initGame = useCallback(() => {
    const deck = shuffleDeck(createDeck());
    
    // 创建玩家: 1 个人类玩家 + AI 对手
    const players: PokerPlayer[] = [];
    const aiNames = ["小智", "小红", "阿强", "老王", "赌神"];
    
    // 人类玩家 (庄家位右侧)
    const humanPlayer: PokerPlayer = {
      id: "human",
      name: config.nickname,
      chips: config.initialChips ?? 1000,
      initialChips: config.initialChips ?? 1000,
      cards: [],
      isAI: false,
      isHuman: true,
      status: "playing",
      currentBet: 0,
      lastAction: "none",
      position: config.aiCount
    };
    players.push(humanPlayer);
    
    // AI 玩家
    for (let i = 0; i < config.aiCount; i++) {
      const aiPlayer: PokerPlayer = {
        id: `ai_${i}`,
        name: aiNames[i % aiNames.length],
        chips: config.initialChips ?? 1000,
        initialChips: config.initialChips ?? 1000,
        cards: [],
        isAI: true,
        isHuman: false,
        status: "playing",
        currentBet: 0,
        lastAction: "none",
        position: i
      };
      players.push(aiPlayer);
      
      // 创建 AI 代理
      const agent = createAIAgent(aiPlayer.id, selectAIPersonality(i));
      aiAgentsRef.current.set(aiPlayer.id, agent);
    }
    
    // 初始状态
    const initialState: PokerGameState = {
      players,
      communityCards: [],
      pot: 0,
      currentBet: 0,
      minRaise: bigBlind,
      dealerIndex: config.aiCount, // 人类玩家是庄家
      currentPlayerIndex: 0,
      phase: "preflop",
      bigBlind,
      smallBlind,
      roundBets: 0,
      potShared: false
    };
    
    // 开始第一轮下注
    startNewHand(initialState);
  }, [config]);
  
  // 开始新一轮发牌
  const startNewHand = useCallback((state: PokerGameState) => {
    // 重置玩家状态
    const resetPlayers = state.players.map(p => ({
      ...p,
      cards: [],
      currentBet: 0,
      lastAction: "none" as ActionType,
      status: p.chips > 0 ? "playing" as const : "bust" as const
    }));
    
    // 移动庄家位置
    let nextDealer = (state.dealerIndex + 1) % state.players.length;
    while (resetPlayers[nextDealer].status === "bust") {
      nextDealer = (nextDealer + 1) % state.players.length;
    }
    
    // 洗牌发牌
    const deck = shuffleDeck(createDeck());
    const holeCards: Card[][] = [];
    let deckIdx = 0;
    
    for (let i = 0; i < state.players.length; i++) {
      holeCards.push([deck[deckIdx], deck[deckIdx + 1]]);
      deckIdx += 2;
    }
    
    // 更新玩家手牌
    resetPlayers.forEach((p: PokerPlayer, idx: number) => {
      (p as any).cards = holeCards[idx];
    });
    
    // 设置大小盲注
    const smallBlindIdx = nextDealer;
    let bigBlindIdx = (nextDealer + 1) % state.players.length;
    while (resetPlayers[bigBlindIdx].status === "bust") {
      bigBlindIdx = (bigBlindIdx + 1) % state.players.length;
    }
    
    resetPlayers[smallBlindIdx].currentBet = smallBlind;
    resetPlayers[bigBlindIdx].currentBet = bigBlind;
    
    const newState: PokerGameState = {
      ...state,
      players: resetPlayers,
      communityCards: [],
      pot: smallBlind + bigBlind,
      currentBet: bigBlind,
      minRaise: bigBlind,
      dealerIndex: nextDealer,
      currentPlayerIndex: bigBlindIdx + 1,
      phase: "preflop",
      roundBets: smallBlind + bigBlind
    };
    
    // 跳过已破产玩家
    while (newState.players[newState.currentPlayerIndex]?.status === "bust") {
      newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
      if (newState.currentPlayerIndex === bigBlindIdx) break;
    }
    
    setGameState(newState);
    setShowAllCards(false);
    setGameResult(null);
    
    // 设置当前行动玩家
    const actingPlayer = newState.players[newState.currentPlayerIndex];
    setActingPlayerId(actingPlayer?.id || null);
    
    // 如果是人类玩家，显示操作按钮
    if (actingPlayer?.isHuman) {
      setCurrentHumanPlayerId(actingPlayer.id);
      setStatus("betting");
    } else if (actingPlayer?.isAI) {
      setStatus("ai_thinking");
      handleAIAction(actingPlayer.id);
    }
  }, []);
  
  // 处理 AI 行动
  const handleAIAction = useCallback(async (playerId: string) => {
    const agent = aiAgentsRef.current.get(playerId);
    if (!agent || !gameState) return;
    
    const result = await agent.decide(gameState);
    
    // 更新游戏状态
    setGameState(prev => {
      if (!prev) return prev;
      
      const player = prev.players.find(p => p.id === playerId);
      if (!player) return prev;
      
      const chipsToCall = prev.currentBet - player.currentBet;
      
      let newChips = player.chips;
      let newBet = player.currentBet;
      let newPot = prev.pot;
      
      switch (result.action) {
        case "fold":
          player.status = "folded";
          break;
        case "call":
          const callAmount = Math.min(chipsToCall, player.chips);
          newChips -= callAmount;
          newBet += callAmount;
          newPot += callAmount;
          if (newChips === 0) player.status = "all-in";
          break;
        case "raise":
          const raiseAmount = Math.min(result.amount, player.chips);
          newChips -= raiseAmount;
          newBet += raiseAmount;
          newPot += raiseAmount;
          if (newChips === 0) player.status = "all-in";
          // 更新当前下注额
          prev.currentBet = newBet;
          prev.minRaise = raiseAmount - chipsToCall + prev.currentBet - player.currentBet;
          break;
        case "check":
          break;
        case "all-in":
          const allInAmount = player.chips;
          newChips = 0;
          newBet += allInAmount;
          newPot += allInAmount;
          player.status = "all-in";
          prev.currentBet = Math.max(prev.currentBet, newBet);
          prev.minRaise = newBet - player.currentBet;
          break;
      }
      
      player.chips = newChips;
      player.currentBet = newBet;
      player.lastAction = result.action;
      
      return { ...prev, pot: newPot };
    });
    
    // 延迟后继续游戏流程
    setTimeout(() => {
      proceedToNextPlayer();
    }, 800);
  }, [gameState]);
  
  // 继续到下一个玩家
  const proceedToNextPlayer = useCallback(() => {
    if (!gameState) return;
    
    // 找到下一个活跃玩家
    let nextIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    let attempts = 0;
    
    while (attempts < gameState.players.length) {
      const nextPlayer = gameState.players[nextIndex];
      
      if (nextPlayer.status !== "bust" && nextPlayer.status !== "folded") {
        // 检查是否所有人都已下注相同金额
        const activePlayers = gameState.players.filter(p => p.status === "playing" || p.status === "all-in");
        const allBetsEqual = activePlayers.every(p => 
          p.currentBet === activePlayers[0].currentBet
        ) || activePlayers.length === 1;
        
        if (allBetsEqual || nextPlayer.currentBet === gameState.currentBet) {
          setGameState(prev => prev ? { ...prev, currentPlayerIndex: nextIndex } : prev);
          setActingPlayerId(nextPlayer.id);
          
          if (nextPlayer.isHuman) {
            setCurrentHumanPlayerId(nextPlayer.id);
            setStatus("betting");
          } else {
            setCurrentHumanPlayerId(null);
            setStatus("ai_thinking");
            handleAIAction(nextPlayer.id);
          }
          return;
        }
      }
      
      nextIndex = (nextIndex + 1) % gameState.players.length;
      attempts++;
    }
    
    // 所有玩家都已下注，进入下一阶段
    advanceToNextPhase();
  }, [gameState, handleAIAction]);
  
  // 进入下一阶段
  const advanceToNextPhase = useCallback(() => {
    if (!gameState) return;
    
    // 重置下注
    const resetPlayers = gameState.players.map((p: PokerPlayer) => ({
      ...p,
      currentBet: 0
    }));
    
    let nextPhase: GamePhase;
    let newCommunityCards: Card[] = [...gameState.communityCards];
    
    switch (gameState.phase) {
      case "preflop":
        nextPhase = "flop";
        // 发3张公共牌
        const deckForFlop = shuffleDeck(createDeck());
        newCommunityCards = deckForFlop.slice(0, 3);
        break;
      case "flop":
        nextPhase = "turn";
        // 发第4张公共牌
        const deckForTurn = shuffleDeck(createDeck());
        newCommunityCards = [...gameState.communityCards, deckForTurn[0]];
        break;
      case "turn":
        nextPhase = "river";
        // 发第5张公共牌
        const deckForRiver = shuffleDeck(createDeck());
        newCommunityCards = [...gameState.communityCards, deckForRiver[0]];
        break;
      case "river":
        nextPhase = "showdown";
        break;
      default:
        return;
    }
    
    const newState: PokerGameState = {
      ...gameState,
      players: resetPlayers,
      communityCards: newCommunityCards,
      currentBet: 0,
      phase: nextPhase,
      currentPlayerIndex: (gameState.dealerIndex + 1) % gameState.players.length
    };
    
    setGameState(newState);
    
    if (nextPhase === "showdown") {
      showDown();
    } else {
      // 找到第一个需要行动的活跃玩家
      let startIndex = newState.currentPlayerIndex;
      let attempts = 0;
      while (attempts < newState.players.length) {
        const player = newState.players[startIndex];
        if (player.status === "playing" || player.status === "all-in") {
          setActingPlayerId(player.id);
          if (player.isHuman) {
            setCurrentHumanPlayerId(player.id);
            setStatus("betting");
          } else {
            setCurrentHumanPlayerId(null);
            setStatus("ai_thinking");
            handleAIAction(player.id);
          }
          return;
        }
        startIndex = (startIndex + 1) % newState.players.length;
        attempts++;
      }
    }
  }, [gameState]);
  
  // 摊牌
  const showDown = useCallback(() => {
    if (!gameState) return;
    
    setShowAllCards(true);
    setStatus("showdown");
    
    // 评估所有玩家手牌
    const results: { player: PokerPlayer; hand: HandResult }[] = [];
    
    for (const player of gameState.players) {
      if (player.status !== "folded") {
        const hand = evaluateHand(player.cards, gameState.communityCards);
        results.push({ player, hand });
      }
    }
    
    // 排序找出赢家
    results.sort((a, b) => {
      if (b.hand.handRankValue !== a.hand.handRankValue) {
        return b.hand.handRankValue - a.hand.handRankValue;
      }
      // 比较 kickers
      for (let i = 0; i < Math.max(a.hand.kickers.length, b.hand.kickers.length); i++) {
        const diff = (b.hand.kickers[i] || 0) - (a.hand.kickers[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
    
    const winner = results[0];
    const winnerName = winner.player.name;
    const winAmount = Math.floor(gameState.pot / (results.filter(r => 
      r.hand.handRankValue === winner.hand.handRankValue
    ).length));
    
    setGameResult({
      winner: winnerName,
      hand: winner.hand,
      amount: winAmount
    });
    
    // 更新玩家筹码
    setGameState(prev => {
      if (!prev) return prev;
      const updatedPlayers = prev.players.map((p: PokerPlayer) => {
        if (p.name === winnerName) {
          return { ...p, chips: p.chips + winAmount };
        }
        return p;
      });
      return { ...prev, players: updatedPlayers };
    });
    
    // 5秒后可以开始下一局
    setTimeout(() => {
      setStatus("gameover");
    }, 5000);
  }, [gameState]);
  
  // 人类玩家行动
  const handleHumanAction = useCallback((action: ActionType, amount?: number) => {
    if (!gameState || !currentHumanPlayerId) return;
    
    const player = gameState.players.find((p: PokerPlayer) => p.id === currentHumanPlayerId);
    if (!player) return;
    
    const chipsToCall = gameState.currentBet - player.currentBet;
    
    let newChips = player.chips;
    let newBet = player.currentBet;
    let newPot = gameState.pot;
    
    switch (action) {
      case "fold":
        player.status = "folded";
        break;
      case "call":
        const callAmount = Math.min(chipsToCall, player.chips);
        newChips -= callAmount;
        newBet += callAmount;
        newPot += callAmount;
        if (newChips === 0) player.status = "all-in";
        break;
      case "raise":
        const raiseAmount = Math.min(amount || 0, player.chips);
        newChips -= raiseAmount;
        newBet += raiseAmount;
        newPot += raiseAmount;
        if (newChips === 0) player.status = "all-in";
        gameState.currentBet = newBet;
        gameState.minRaise = raiseAmount;
        break;
      case "check":
        break;
    }
    
    player.chips = newChips;
    player.currentBet = newBet;
    player.lastAction = action;
    
    setGameState({ ...gameState, pot: newPot });
    
    setTimeout(() => {
      proceedToNextPlayer();
    }, 500);
  }, [gameState, currentHumanPlayerId, proceedToNextPlayer]);
  
  // 开始新游戏
  const startNewGame = () => {
    aiAgentsRef.current.clear();
    initGame();
  };
  
  // 初始化
  useEffect(() => {
    initGame();
  }, [initGame]);
  
  // 渲染纸牌（key 由调用方提供）
  const renderCard = (card: Card, faceUp: boolean, className: string = "") => {
    if (!faceUp) {
      return (
        <div className={`w-12 h-16 sm:w-16 sm:h-24 rounded-lg bg-gradient-to-br from-blue-700 to-blue-900 border-2 border-blue-600 shadow-md ${className}`}>
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-10 h-14 border border-white/30 rounded" />
          </div>
        </div>
      );
    }
    
    const suitSymbol = SUIT_SYMBOLS[card.suit];
    const suitColor = SUIT_COLORS[card.suit] === "red" ? "text-red-600" : "text-gray-900";
    const rankSymbol = RANK_SYMBOLS[card.rank];
    
    return (
      <div className={`w-12 h-16 sm:w-16 sm:h-24 rounded-lg bg-white border-2 border-gray-300 shadow-md flex flex-col justify-between p-1 ${className}`}>
        <div className={`leading-none font-bold text-xs ${suitColor}`}>
          <div>{rankSymbol}</div>
          <div className="text-[10px]">{suitSymbol}</div>
        </div>
        <div className={`text-center text-xl ${suitColor}`}>{suitSymbol}</div>
        <div className={`leading-none font-bold text-xs text-right ${suitColor} rotate-180`}>
          <div>{rankSymbol}</div>
          <div className="text-[10px]">{suitSymbol}</div>
        </div>
      </div>
    );
  };
  
  // 渲染玩家
  const renderPlayer = (player: PokerPlayer, index: number) => {
    const isActing = actingPlayerId === player.id;
    const isHuman = player.isHuman;
    const cards = player.cards;
    
    return (
      <div 
        key={player.id}
        className={`flex flex-col items-center p-2 rounded-lg transition-all ${
          isActing ? "bg-yellow-100 ring-2 ring-yellow-400" : "bg-white/50"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          {isHuman && <span className="text-xs bg-blue-500 text-white px-1 rounded">你</span>}
          <span className="font-medium text-sm">{player.name}</span>
          {player.status === "all-in" && <span className="text-xs bg-orange-500 text-white px-1 rounded">All-in</span>}
          {player.status === "folded" && <span className="text-xs bg-gray-400 text-white px-1 rounded">弃牌</span>}
        </div>
        <div className="flex gap-1 mb-1">
          {cards.length > 0 && cards.map((card, i) => (
            <span key={`${player.id}-${i}`}>
              {renderCard(card, showAllCards || isHuman || player.status === "folded", "w-8 h-12 sm:w-10 sm:h-14")}
            </span>
          ))}
          {cards.length === 0 && (
            <div className="w-8 h-12 sm:w-10 sm:h-14 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400">
              ?
            </div>
          )}
        </div>
        <div className="text-sm font-medium text-gray-700">
          {player.chips} 筹码
        </div>
        {player.currentBet > 0 && (
          <div className="text-xs text-green-600 font-medium mt-1">
            下注: {player.currentBet}
          </div>
        )}
      </div>
    );
  };
  
  // 渲染公共牌
  const renderCommunityCards = () => {
    const cards = gameState?.communityCards || [];
    const phaseCards = gameState?.phase === "flop" ? 3 : 
                       gameState?.phase === "turn" ? 4 :
                       gameState?.phase === "river" ? 5 : 0;
    
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="text-sm text-gray-600">
          {gameState?.phase === "preflop" ? "发牌阶段" :
           gameState?.phase === "flop" ? "翻牌圈" :
           gameState?.phase === "turn" ? "转牌圈" :
           gameState?.phase === "river" ? "河牌圈" :
           gameState?.phase === "showdown" ? "摊牌" : ""}
        </div>
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i}>
              {i < cards.length ? (
                <span key={`community-${i}`}>
                  {renderCard(cards[i], true, "w-12 h-16 sm:w-16 sm:h-24")}
                </span>
              ) : (
                <div className="w-12 h-16 sm:w-16 sm:h-24 rounded-lg bg-gray-200 border-2 border-dashed border-gray-300" />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };
  
  // 渲染操作按钮
  const renderActionButtons = () => {
    if (!gameState || !currentHumanPlayerId) return null;
    
    const player = gameState.players.find(p => p.id === currentHumanPlayerId);
    if (!player || player.status === "folded" || player.status === "bust") return null;
    
    const chipsToCall = gameState.currentBet - player.currentBet;
    const canCheck = chipsToCall === 0;
    const canCall = chipsToCall > 0 && player.chips >= chipsToCall;
    const canRaise = player.chips > chipsToCall;
    
    const raiseOptions = getRaiseOptions(player, gameState);
    
    return (
      <div className="flex flex-col items-center gap-3 p-4 bg-white rounded-xl shadow-lg">
        <div className="text-sm text-gray-600">
          底池: <span className="font-bold text-green-600">{gameState.pot}</span>
        </div>
        
        <div className="flex gap-2 flex-wrap justify-center">
          <button
            onClick={() => handleHumanAction("fold")}
            className="px-6 py-3 bg-gray-500 text-white font-medium rounded-lg hover:bg-gray-600 transition-colors"
          >
            弃牌
          </button>
          
          {canCheck && (
            <button
              onClick={() => handleHumanAction("check")}
              className="px-6 py-3 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors"
            >
              过牌
            </button>
          )}
          
          {canCall && (
            <button
              onClick={() => handleHumanAction("call")}
              className="px-6 py-3 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 transition-colors"
            >
              跟注 ({chipsToCall})
            </button>
          )}
          
          {canRaise && (
            <div className="flex gap-2">
              {raiseOptions.slice(0, 3).map(opt => (
                <button
                  key={opt.amount}
                  onClick={() => handleHumanAction("raise", opt.amount)}
                  className="px-4 py-3 bg-red-500 text-white font-medium rounded-lg hover:bg-red-600 transition-colors"
                >
                  加注 {opt.label}
                </button>
              ))}
            </div>
          )}
          
          <button
            onClick={() => handleHumanAction("all-in")}
            disabled={player.chips === 0}
            className="px-6 py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            全下 ({player.chips})
          </button>
        </div>
      </div>
    );
  };
  
  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-700 to-red-900">
        <div className="text-white text-xl">加载中...</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-950 p-4">
      {/* 顶部信息栏 */}
      <div className="max-w-4xl mx-auto mb-4">
        <div className="flex items-center justify-between bg-white/10 rounded-lg px-4 py-2 text-white">
          <div className="flex items-center gap-4">
            <span className="text-2xl">🃋</span>
            <span className="font-bold">德州扑克</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span>盲注: {smallBlind}/{bigBlind}</span>
            <span>底池: {gameState.pot}</span>
          </div>
          <button 
            onClick={startNewGame}
            className="px-3 py-1 bg-white/20 rounded hover:bg-white/30 transition-colors"
          >
            新游戏
          </button>
        </div>
      </div>
      
      {/* 公共牌 */}
      <div className="max-w-4xl mx-auto mb-6">
        {renderCommunityCards()}
      </div>
      
      {/* 玩家区域 */}
      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-3 gap-4">
          {gameState.players.map((player, idx) => renderPlayer(player, idx))}
        </div>
      </div>
      
      {/* 操作区域 */}
      <div className="fixed bottom-4 left-0 right-0 flex justify-center">
        {status === "betting" && currentHumanPlayerId ? (
          renderActionButtons()
        ) : status === "ai_thinking" ? (
          <div className="bg-white/90 rounded-xl px-8 py-4 shadow-lg flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-700">AI 思考中...</span>
          </div>
        ) : status === "showdown" && gameResult ? (
          <div className="bg-white/90 rounded-xl px-8 py-4 shadow-lg text-center">
            <div className="text-2xl mb-2">🎉</div>
            <div className="font-bold text-lg text-gray-800">{gameResult.winner} 获胜!</div>
            <div className="text-sm text-gray-600">{gameResult.hand.name}</div>
            <div className="text-sm text-green-600 font-medium">+{gameResult.amount} 筹码</div>
          </div>
        ) : status === "gameover" ? (
          <div className="bg-white/90 rounded-xl px-8 py-4 shadow-lg">
            <button
              onClick={startNewGame}
              className="px-6 py-3 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 transition-colors"
            >
              开始下一局
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}