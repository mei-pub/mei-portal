"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────
interface Card {
  suit: number; // 0=♠ 1=♥ 2=♣ 3=♦
  rank: number; // 1(A) .. 13(K)
  faceUp: boolean;
}

interface GameState {
  columns: Card[][];
  stock: Card[];
  completed: number;
  score: number;
  moves: number;
}

interface Selection {
  col: number;
  idx: number; // card index within the column
}

interface HintMove {
  col: number;
  idx: number;
  target: number;
}

interface HighScore {
  score: number;
  moves: number;
  time: number;
  suits: number;
  date: string;
}

// ─── Constants ───────────────────────────────────────────────────
const SUIT_SYM = ["♠", "♥", "♣", "♦"];
const SUIT_CLR: Record<number, string> = { 0: "#1a1a2e", 1: "#dc2626", 2: "#1a1a2e", 3: "#dc2626" };
const RANK_SYM = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

// ─── localStorage helpers ────────────────────────────────────────
const STORAGE_KEYS = {
  GAME: "spider-save",
  SUITS: "spider-suits",
  TIMER: "spider-timer",
  SCORES: "spider-scores",
};

function saveGameToStorage(state: GameState, suitCount: number, timer: number) {
  try {
    localStorage.setItem(STORAGE_KEYS.GAME, JSON.stringify(state));
    localStorage.setItem(STORAGE_KEYS.SUITS, String(suitCount));
    localStorage.setItem(STORAGE_KEYS.TIMER, String(timer));
  } catch {}
}

function loadGameFromStorage(): { state: GameState; suitCount: number; timer: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GAME);
    if (!raw) return null;
    return {
      state: JSON.parse(raw),
      suitCount: parseInt(localStorage.getItem(STORAGE_KEYS.SUITS) || "1"),
      timer: parseInt(localStorage.getItem(STORAGE_KEYS.TIMER) || "0"),
    };
  } catch { return null; }
}

function clearSavedGame() {
  try {
    localStorage.removeItem(STORAGE_KEYS.GAME);
    localStorage.removeItem(STORAGE_KEYS.SUITS);
    localStorage.removeItem(STORAGE_KEYS.TIMER);
  } catch {}
}

function loadHighScores(): HighScore[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SCORES);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHighScore(entry: HighScore) {
  const scores = loadHighScores();
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  try {
    localStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(scores.slice(0, 10)));
  } catch {}
}

// ─── Deck helpers ────────────────────────────────────────────────
function makeDeck(suitCount: number): Card[] {
  const deck: Card[] = [];
  const suits = [0, 1, 2, 3].slice(0, suitCount);
  const decksNeeded = Math.ceil(104 / (suits.length * 13));
  for (let d = 0; d < decksNeeded; d++) {
    for (const s of suits) {
      for (let r = 1; r <= 13; r++) {
        deck.push({ suit: s, rank: r, faceUp: false });
      }
    }
  }
  return deck.slice(0, 104);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function initGame(suitCount: number): GameState {
  const deck = shuffle(makeDeck(suitCount));
  const columns: Card[][] = Array.from({ length: 10 }, () => []);
  let idx = 0;
  for (let col = 0; col < 10; col++) {
    const count = col < 4 ? 6 : 5;
    for (let i = 0; i < count; i++) {
      columns[col].push(deck[idx++]);
    }
    columns[col][columns[col].length - 1].faceUp = true;
  }
  const stock = deck.slice(idx);
  return { columns, stock, completed: 0, score: 500, moves: 0 };
}

// ─── Game logic helpers ──────────────────────────────────────────
function isValidSequence(col: Card[], startIdx: number): boolean {
  for (let i = startIdx; i < col.length - 1; i++) {
    if (!col[i].faceUp) return false;
    if (col[i].suit !== col[i + 1].suit) return false;
    if (col[i].rank !== col[i + 1].rank + 1) return false;
  }
  return col[startIdx].faceUp;
}

function canPlace(targetCol: Card[], movingRank: number): boolean {
  if (targetCol.length === 0) return true;
  const top = targetCol[targetCol.length - 1];
  return top.faceUp && top.rank === movingRank + 1;
}

function checkComplete(col: Card[]): { newCol: Card[]; removed: boolean } {
  if (col.length < 13) return { newCol: col, removed: false };
  const start = col.length - 13;
  const suit = col[start].suit;
  if (col[start].rank !== 13) return { newCol: col, removed: false };
  for (let i = 0; i < 12; i++) {
    const c = col[start + i];
    if (!c.faceUp || c.suit !== suit || c.rank !== 13 - i) {
      return { newCol: col, removed: false };
    }
  }
  const newCol = col.slice(0, start);
  if (newCol.length > 0 && !newCol[newCol.length - 1].faceUp) {
    newCol[newCol.length - 1] = { ...newCol[newCol.length - 1], faceUp: true };
  }
  return { newCol, removed: true };
}

// ─── Find ALL valid hints, separated by non-splitting vs splitting ──
interface HintsResult {
  nonSplit: HintMove[]; // moves that take entire face-up run (no sequence broken)
  split: HintMove[];    // moves that break an existing run
}

function findAllHints(columns: Card[][]): HintsResult {
  const nonSplit: HintMove[] = [];
  const split: HintMove[] = [];
  for (let srcCol = 0; srcCol < 10; srcCol++) {
    const col = columns[srcCol];
    // Find the first face-up card index in this column
    let firstFaceUp = col.length;
    for (let i = 0; i < col.length; i++) {
      if (col[i].faceUp) { firstFaceUp = i; break; }
    }
    for (let si = col.length - 1; si >= 0; si--) {
      if (!col[si].faceUp) break;
      if (!isValidSequence(col, si)) continue;
      const topRank = col[si].rank;
      // Is this a non-splitting move? (takes the entire face-up run)
      const isNonSplit = si === firstFaceUp;
      // Non-empty targets
      for (let tCol = 0; tCol < 10; tCol++) {
        if (tCol === srcCol) continue;
        const target = columns[tCol];
        if (target.length > 0 && canPlace(target, topRank)) {
          const targetTop = target[target.length - 1];
          const isSameSuit = targetTop.suit === col[si].suit;
          const move: HintMove = { col: srcCol, idx: si, target: tCol };
          const bucket = isNonSplit ? nonSplit : split;
          if (isSameSuit) bucket.unshift(move); else bucket.push(move);
        }
      }
      // Empty targets
      for (let tCol = 0; tCol < 10; tCol++) {
        if (tCol === srcCol) continue;
        if (columns[tCol].length === 0) {
          if (si === 0) continue;
          const move: HintMove = { col: srcCol, idx: si, target: tCol };
          (isNonSplit ? nonSplit : split).push(move);
        }
      }
    }
  }
  return { nonSplit, split };
}

// ─── Props ───────────────────────────────────────────────────────
interface Props {
  onNewGameNickname: (nickname: string) => void;
}

// ─── Component ───────────────────────────────────────────────────
export default function SpiderSolitaire({ onNewGameNickname }: Props) {
  const [suitCount, setSuitCount] = useState(1);
  const [game, setGame] = useState<GameState>(() => initGame(1));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [history, setHistory] = useState<GameState[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [nickname, setNickname] = useState("");
  const [dialogSuits, setDialogSuits] = useState(1);
  const [timer, setTimer] = useState(0);
  const [won, setWon] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hint state
  const [hintTarget, setHintTarget] = useState<number | null>(null);
  const [hintPulse, setHintPulse] = useState(false);

  // Drag state
  const [dragging, setDragging] = useState<{
    col: number;
    idx: number;
    cards: Card[];
    offsetX: number;
    offsetY: number;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gameAreaRef = useRef<HTMLDivElement>(null);

  // Landscape mode
  const [landscape, setLandscape] = useState(false);

  // Resume saved game
  const [showResume, setShowResume] = useState(false);
  const [savedSnap, setSavedSnap] = useState<{ state: GameState; suitCount: number; timer: number } | null>(null);

  // High scores dialog
  const [showScores, setShowScores] = useState(false);

  // Auto-play
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef(false);

  // ── Timer ──
  useEffect(() => {
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Check saved game on mount ──
  useEffect(() => {
    const saved = loadGameFromStorage();
    if (saved) {
      setSavedSnap(saved);
      setShowResume(true);
    }
  }, []);

  // ── Auto-save on every move ──
  useEffect(() => {
    if (won) { clearSavedGame(); return; }
    if (game.moves > 0 || game.stock.length < 50) {
      saveGameToStorage(game, suitCount, timer);
    }
  }, [game, suitCount, timer, won]);

  // ── Win detection ──
  useEffect(() => {
    if (game.completed >= 8 && !won) {
      setWon(true);
      if (timerRef.current) clearInterval(timerRef.current);
      saveHighScore({ score: game.score, moves: game.moves, time: timer, suits: suitCount, date: new Date().toLocaleDateString() });
    }
  }, [game.completed, won]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  function pushHistory(state: GameState) {
    setHistory(h => [...h.slice(-30), state]);
  }

  // ── Actions ──
  function doMove(sel: Selection, targetCol: number) {
    const srcCol = game.columns[sel.col];
    const movingCards = srcCol.slice(sel.idx);
    if (!isValidSequence(srcCol, sel.idx)) { setSelection(null); return; }
    if (!canPlace(game.columns[targetCol], movingCards[0].rank)) { setSelection(null); return; }
    if (sel.col === targetCol) { setSelection(null); return; }

    pushHistory(game);
    const newCols = game.columns.map(c => [...c.map(cd => ({ ...cd }))]);
    const newSrc = newCols[sel.col].slice(0, sel.idx);
    if (newSrc.length > 0 && !newSrc[newSrc.length - 1].faceUp) {
      newSrc[newSrc.length - 1] = { ...newSrc[newSrc.length - 1], faceUp: true };
    }
    newCols[sel.col] = newSrc;
    newCols[targetCol] = [...newCols[targetCol], ...movingCards];

    let completed = game.completed;
    let score = game.score + 1;
    const { newCol, removed } = checkComplete(newCols[targetCol]);
    if (removed) {
      newCols[targetCol] = newCol;
      completed++;
      score += 100;
    }

    setGame({ ...game, columns: newCols, completed, score, moves: game.moves + 1 });
    setSelection(null);
  }

  const handleClick = useCallback((colIdx: number, cardIdx: number) => {
    if (won) return;
    const col = game.columns[colIdx];
    const card = col[cardIdx];
    if (!card.faceUp) { setSelection(null); return; }

    if (!selection) {
      if (isValidSequence(col, cardIdx)) {
        setSelection({ col: colIdx, idx: cardIdx });
      }
      return;
    }
    if (selection.col === colIdx && selection.idx === cardIdx) {
      setSelection(null);
      return;
    }
    if (selection.col === colIdx) {
      if (isValidSequence(col, cardIdx)) {
        setSelection({ col: colIdx, idx: cardIdx });
      } else {
        setSelection(null);
      }
      return;
    }
    doMove(selection, colIdx);
  }, [selection, game, won]);

  function handleEmptyColClick(colIdx: number) {
    if (!selection) return;
    doMove(selection, colIdx);
  }

  function dealFromStock() {
    if (game.stock.length === 0) return;
    if (game.columns.some(c => c.length === 0)) return;
    pushHistory(game);
    const newCols = game.columns.map(c => c.map(cd => ({ ...cd })));
    const newStock = game.stock.map(cd => ({ ...cd }));
    for (let i = 0; i < 10; i++) {
      const card = newStock.pop()!;
      card.faceUp = true;
      newCols[i].push(card);
    }
    let completed = game.completed;
    for (let i = 0; i < 10; i++) {
      const { newCol, removed } = checkComplete(newCols[i]);
      if (removed) { newCols[i] = newCol; completed++; }
    }
    setGame({ ...game, columns: newCols, stock: newStock, completed, moves: game.moves + 1 });
    setSelection(null);
  }

  function undo() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setGame(prev);
    setSelection(null);
  }

  function handleNewGame() {
    if (nickname.trim()) {
      onNewGameNickname(nickname.trim());
    }
    clearSavedGame();
    setSuitCount(dialogSuits);
    setGame(initGame(dialogSuits));
    setSelection(null);
    setHistory([]);
    setTimer(0);
    setWon(false);
    setNickname("");
    setShowDialog(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
  }

  function restartCurrent() {
    clearSavedGame();
    setGame(initGame(suitCount));
    setSelection(null);
    setHistory([]);
    setTimer(0);
    setWon(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
  }

  function resumeGame() {
    if (savedSnap) {
      setGame(savedSnap.state);
      setSuitCount(savedSnap.suitCount);
      setTimer(savedSnap.timer);
      setHistory([]);
      setSelection(null);
      setWon(false);
    }
    setShowResume(false);
    setSavedSnap(null);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
  }

  function startFresh() {
    clearSavedGame();
    setShowResume(false);
    setSavedSnap(null);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
  }

  // ── Hint: find random valid move from all possible ──
  function showHint() {
    const { nonSplit, split } = findAllHints(game.columns);
    const pool = nonSplit.length > 0 ? nonSplit : split;
    if (pool.length === 0) return;
    const hint = pool[Math.floor(Math.random() * pool.length)];
    setSelection({ col: hint.col, idx: hint.idx });
    setHintTarget(hint.target);
    setHintPulse(true);
    setTimeout(() => { setHintTarget(null); setHintPulse(false); }, 2000);
  }

  // ── Auto-play: cost-benefit evaluation engine ──
  // Cost = number of cards moved. Benefit depends on what the move achieves.
  function evaluateMove(move: HintMove, columns: Card[][]): { score: number; priority: number } {
    const srcCol = columns[move.col];
    const tgtCol = columns[move.target];
    const cardsMoved = srcCol.length - move.idx; // cost
    const movingCard = srcCol[move.idx];

    // Determine first face-up index for source column
    let srcFirstFaceUp = srcCol.length;
    for (let i = 0; i < srcCol.length; i++) { if (srcCol[i].faceUp) { srcFirstFaceUp = i; break; } }
    const isNonSplit = move.idx === srcFirstFaceUp;

    let benefit = 0;
    let priority = 4; // default: same-suit sequence building

    // ── P1: Completes a K→A sequence (+100, overrides cost) ──
    if (wouldComplete(move, columns)) {
      benefit = 100 + cardsMoved; // completion always covers cost
      priority = 1;
      return { score: benefit, priority };
    }

    // ── P2: Reveals face-down card (information gain) ──
    const revealsFaceDown = move.idx > 0 && !srcCol[move.idx - 1].faceUp;
    if (revealsFaceDown) {
      // Count remaining face-down cards in source column after move
      const remainingFaceDown = srcFirstFaceUp; // cards before firstFaceUp
      const isLastFaceDown = remainingFaceDown === 1; // only 1 face-down left
      benefit = 50 + (isLastFaceDown ? 20 : 0);
      priority = 2;
      // Subtract cost for split moves that reveal
      if (!isNonSplit) benefit -= cardsMoved;
      // Only proceed if net positive (for non-split, always positive)
      if (benefit <= 0) { priority = 99; benefit = -999; }
      return { score: benefit, priority };
    }

    // ── P3: Empty column creation/usage ──
    const createsEmpty = isNonSplit && move.idx === 0; // moving ALL cards from source
    const targetsEmpty = tgtCol.length === 0;
    if (createsEmpty || targetsEmpty) {
      // Empty column: strategic value, but only if immediate benefit
      // Low priority unless combined with face-down reveal or completion
      benefit = 5; // minimal value
      priority = 5;
      // Penalize moving to empty column without good reason (don't waste on isolated K)
      if (targetsEmpty && cardsMoved < 3) {
        benefit = -cardsMoved; // waste of empty column
        priority = 6;
      }
      // Creating empty column by moving everything away: check if we have purpose
      if (createsEmpty) {
        benefit = 10; // modest value — could be useful
        priority = 5;
      }
      return { score: benefit, priority };
    }

    // ── P4: Same-suit sequence building ──
    if (tgtCol.length > 0) {
      const tgtTop = tgtCol[tgtCol.length - 1];
      if (tgtTop.suit === movingCard.suit) {
        // Calculate same-suit run length after move
        const existingRun = countSameSuitRun(tgtCol);
        const newRunLen = existingRun + cardsMoved;
        // Future savings estimate: longer runs are exponentially more valuable
        // 2 cards: +0.3, 3: +0.6, 4: +0.9, etc.
        benefit = Math.max(0, (newRunLen - 1) * 0.3 - (isNonSplit ? 0 : cardsMoved * 0.5));
        if (isNonSplit) benefit += 5; // non-split same-suit is great
        priority = 4;
        // Non-split always preferred
        if (isNonSplit) {
          benefit = 10 + newRunLen * 0.5;
          priority = 4;
        }
        return { score: benefit, priority };
      }

      // ── P5: Off-suit move (cautious compromise) ──
      // Only when net benefit > 0: revealing face-down or enabling future moves
      if (tgtTop.suit !== movingCard.suit) {
        // Off-suit is costly — only acceptable for non-split with some benefit
        if (isNonSplit) {
          benefit = 1; // marginal positive
          priority = 5;
        } else {
          benefit = -cardsMoved; // split + off-suit = bad
          priority = 6;
        }
        return { score: benefit, priority };
      }
    }

    return { score: isNonSplit ? 1 : -cardsMoved, priority: isNonSplit ? 5 : 6 };
  }

  // Count the length of the same-suit descending run at the bottom of a column
  function countSameSuitRun(col: Card[]): number {
    if (col.length === 0) return 0;
    let count = 1;
    for (let i = col.length - 2; i >= 0; i--) {
      if (!col[i].faceUp) break;
      if (col[i].suit !== col[i + 1].suit) break;
      if (col[i].rank !== col[i + 1].rank + 1) break;
      count++;
    }
    return count;
  }

  // Count face-down cards in all columns
  function countFaceDown(columns: Card[][]): number {
    let total = 0;
    for (const col of columns) {
      for (const c of col) { if (!c.faceUp) total++; }
    }
    return total;
  }

  // Count empty columns
  function countEmpty(columns: Card[][]): number {
    return columns.filter(c => c.length === 0).length;
  }

  // Check if a split move would complete a K→A sequence on the target
  function wouldComplete(move: HintMove, columns: Card[][]): boolean {
    const srcCol = columns[move.col];
    const tgtCol = columns[move.target];
    const newTgtLen = tgtCol.length + (srcCol.length - move.idx);
    if (newTgtLen < 13) return false;
    const simTgt = [...tgtCol, ...srcCol.slice(move.idx)];
    const start = simTgt.length - 13;
    const suit = simTgt[start].suit;
    if (simTgt[start].rank !== 13) return false;
    for (let i = 0; i < 12; i++) {
      const c = simTgt[start + i];
      if (!c.faceUp || c.suit !== suit || c.rank !== 13 - i) return false;
    }
    return true;
  }

  // ── Core decision: find the best move using priority-based evaluation ──
  function findBestMove(columns: Card[][]): HintMove | null {
    const { nonSplit, split } = findAllHints(columns);
    const allMoves = [...nonSplit, ...split];

    if (allMoves.length === 0) return null;

    // Evaluate all moves
    interface EvalMove extends HintMove { score: number; priority: number }
    const evaluated: EvalMove[] = allMoves.map(m => {
      const { score, priority } = evaluateMove(m, columns);
      return { ...m, score, priority };
    });

    // Filter: reject all negative-benefit moves (net benefit must be > 0)
    // Exception: priority 1 (completion) always accepted
    const acceptable = evaluated.filter(m => m.priority === 1 || m.score > 0);

    if (acceptable.length === 0) return null; // no beneficial moves — prefer dealing

    // Sort by priority (lower = better), then by score (higher = better)
    acceptable.sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : b.score - a.score);

    return acceptable[0];
  }

  // ── Deadlock prevention: check if we should force-deal ──
  function shouldForceDeal(columns: Card[][]): boolean {
    const empty = countEmpty(columns);
    const { nonSplit, split } = findAllHints(columns);
    const allMoves = [...nonSplit, ...split];

    // If there are no empty columns and all moves have net benefit <= -3
    if (empty === 0 && allMoves.length > 0) {
      let allBad = true;
      for (const m of allMoves) {
        const ev = evaluateMove(m, columns);
        if (ev.score > -3 || ev.priority <= 2) { allBad = false; break; }
      }
      if (allBad) return true;
    }
    return false;
  }

  function toggleAutoPlay() {
    autoPlayRef.current = !autoPlayRef.current;
    setAutoPlay(autoPlayRef.current);
  }

  // ── Auto-play loop driven by game state changes ──
  useEffect(() => {
    if (!autoPlayRef.current || won) return;
    const timer = setTimeout(() => {
      if (!autoPlayRef.current) return;
      const best = findBestMove(game.columns);
      if (best) {
        doMove({ col: best.col, idx: best.idx }, best.target);
      } else if (game.stock.length > 0) {
        // No beneficial moves — try to deal
        // dealFromStock requires no empty columns
        if (!game.columns.some(c => c.length === 0)) {
          dealFromStock();
        } else {
          // Has empty columns: must fill them before dealing
          // Find any move that fills an empty column (even low-value)
          const { nonSplit } = findAllHints(game.columns);
          const fillMove = nonSplit.find(m => game.columns[m.target].length === 0);
          if (fillMove) {
            doMove({ col: fillMove.col, idx: fillMove.idx }, fillMove.target);
          } else {
            // Can't fill empty cols and can't deal — stuck
            autoPlayRef.current = false;
            setAutoPlay(false);
          }
        }
      } else {
        // No moves and no stock — stop auto-play
        autoPlayRef.current = false;
        setAutoPlay(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [game, autoPlay, won]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (showDialog || won || showResume || showScores || autoPlay) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "h" || e.key === "H") { e.preventDefault(); showHint(); }
      else if (e.key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
      else if (e.key === "d" || e.key === "D") { e.preventDefault(); dealFromStock(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showDialog, won, game, history, showResume, showScores]);

  // ── Drag handlers (mouse + touch) ──
  const handleDragStart = useCallback((clientX: number, clientY: number, target: HTMLElement, colIdx: number, cardIdx: number) => {
    if (won) return;
    const col = game.columns[colIdx];
    const card = col[cardIdx];
    if (!card.faceUp) return;
    if (!isValidSequence(col, cardIdx)) return;

    const rect = target.getBoundingClientRect();
    setDragging({
      col: colIdx,
      idx: cardIdx,
      cards: col.slice(cardIdx),
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      mouseX: clientX,
      mouseY: clientY,
    });
    setSelection({ col: colIdx, idx: cardIdx });
  }, [game, won]);

  useEffect(() => {
    if (!dragging) return;
    function updatePos(clientX: number, clientY: number) {
      setDragging(prev => prev ? { ...prev, mouseX: clientX, mouseY: clientY } : null);
    }
    function finishDrag(clientX: number) {
      if (!dragging) return;
      let targetCol = -1;
      let minDist = Infinity;
      columnRefs.current.forEach((ref, idx) => {
        if (!ref) return;
        const rect = ref.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const dist = Math.abs(clientX - cx);
        if (dist < minDist && dist < rect.width * 1.2) {
          minDist = dist;
          targetCol = idx;
        }
      });
      if (targetCol >= 0 && targetCol !== dragging.col) {
        doMove({ col: dragging.col, idx: dragging.idx }, targetCol);
      } else {
        setSelection(null);
      }
      setDragging(null);
    }
    function onMouseMove(e: MouseEvent) { updatePos(e.clientX, e.clientY); }
    function onMouseUp(e: MouseEvent) { finishDrag(e.clientX); }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const t = e.touches[0];
      updatePos(t.clientX, t.clientY);
    }
    function onTouchEnd(e: TouchEvent) {
      const t = e.changedTouches[0];
      finishDrag(t.clientX);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [dragging, game]);

  // ── Render ──
  const isSelected = (colIdx: number, cardIdx: number) =>
    selection !== null && selection.col === colIdx && cardIdx >= selection.idx;

  const stockDeals = Math.ceil(game.stock.length / 10);

  const gameContent = (
    <div className="h-dvh select-none flex flex-col overflow-hidden" style={{ background: "linear-gradient(180deg, #1a6b30 0%, #0e4a1e 100%)" }}>
      {/* ─── Header Bar ─── */}
      <div className="bg-[#1b5e2e] border-b border-green-900/60 px-2 sm:px-3 py-1 sm:py-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 sm:gap-2">
          <span className="text-white text-sm sm:text-base mr-0.5 sm:mr-1">♠</span>
          <span className="text-white font-bold text-xs sm:text-sm hidden sm:inline">蜘蛛纸牌</span>
          <div className="flex items-center gap-0.5 ml-1 sm:ml-3">
            <button onClick={() => setShowDialog(true)} className="px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] text-white/80 hover:bg-white/10 rounded transition-colors">游戏</button>
            <button onClick={undo} className="px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] text-white/80 hover:bg-white/10 rounded transition-colors" title="撤销 (Ctrl+Z)">撤销</button>
            <button onClick={showHint} className="px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] text-white/80 hover:bg-white/10 rounded transition-colors" title="提示 (H)">提示</button>
            <button onClick={dealFromStock} disabled={game.stock.length === 0 || game.columns.some(c => c.length === 0)}
              className="px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] text-white/80 hover:bg-white/10 rounded transition-colors disabled:opacity-30" title="发牌 (D)">发牌</button>
            <button onClick={toggleAutoPlay}
              className={`px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] rounded transition-colors ${autoPlay ? "bg-yellow-500/80 text-white" : "text-white/80 hover:bg-white/10"}`}
              title="自动游玩">
              {autoPlay ? "停止" : "自动"}
            </button>
            <button onClick={() => setLandscape(!landscape)} className="px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] text-white/80 hover:bg-white/10 rounded transition-colors" title="切换横屏/竖屏">
              {landscape ? "竖屏" : "横屏"}
            </button>
            <button onClick={() => setShowScores(true)} className="px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] text-white/80 hover:bg-white/10 rounded transition-colors">排行</button>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-[11px] text-white/60">
          <span className="hidden sm:inline">得分: {game.score}</span>
          <span>{game.score}分</span>
          <span className="hidden xs:inline">步数: {game.moves}</span>
          <span>{fmt(timer)}</span>
          <span>{game.completed}/8</span>
        </div>
      </div>

      {/* ─── Game Area ─── */}
      <div className="flex-1 overflow-auto py-1.5 sm:py-3 px-1 sm:px-2" ref={gameAreaRef}>
        <div className="w-full max-w-[1200px] mx-auto">
          <div className="grid grid-cols-10 gap-[4px] sm:gap-[8px]" style={{ paddingBottom: "80px" }}>
            {game.columns.map((col, colIdx) => (
              <div
                key={colIdx}
                ref={el => { columnRefs.current[colIdx] = el; }}
                className="relative cursor-pointer"
                style={{ minHeight: "100px" }}
                onClick={() => { if (col.length === 0) handleEmptyColClick(colIdx); }}
              >
                {/* Empty slot */}
                {col.length === 0 && (
                  <div className={`w-full aspect-[5/7] rounded-md border-2 border-dashed transition-all duration-300 ${
                    hintTarget === colIdx
                      ? "border-yellow-400 bg-yellow-400/20 shadow-[0_0_12px_4px_rgba(234,179,8,0.4)]"
                      : "border-white/15"
                  }`} />
                )}

                {/* Cards */}
                {col.map((card, cardIdx) => {
                  const selected = isSelected(colIdx, cardIdx);
                  const isBeingDragged = dragging !== null && dragging.col === colIdx && cardIdx >= dragging.idx;
                  // Is this the last card on the hint target column?
                  const isHintDest = hintTarget === colIdx && cardIdx === col.length - 1;
                  const isHintSource = hintPulse && selection !== null && selection.col === colIdx && cardIdx >= selection.idx;

                  let top = 0;
                  for (let k = 0; k < cardIdx; k++) {
                    top += col[k].faceUp ? 24 : 10;
                  }

                  // Hide dragged cards from original position
                  if (isBeingDragged && dragging) {
                    return (
                      <div
                        key={cardIdx}
                        className="absolute w-full"
                        style={{ top: `${top}px`, zIndex: cardIdx, opacity: 0.15 }}
                      >
                        <FaceUpCard card={card} />
                      </div>
                    );
                  }

                  return (
                    <div
                      key={cardIdx}
                      className="absolute w-full"
                      style={{ top: `${top}px`, zIndex: cardIdx }}
                      onClick={(e) => { e.stopPropagation(); handleClick(colIdx, cardIdx); }}
                      onMouseDown={(e) => {
                        if (e.button === 0) handleDragStart(e.clientX, e.clientY, e.currentTarget, colIdx, cardIdx);
                      }}
                      onTouchStart={(e) => {
                        const t = e.touches[0];
                        handleDragStart(t.clientX, t.clientY, e.currentTarget, colIdx, cardIdx);
                      }}
                    >
                      {card.faceUp ? (
                        <div
                          className={`aspect-[5/7] rounded-[3px] sm:rounded-[5px] border sm:border-2 flex flex-col justify-between p-0.5 sm:p-1.5 transition-all duration-200 ${
                            isHintSource
                              ? "bg-blue-100 border-blue-500 shadow-[0_0_14px_4px_rgba(59,130,246,0.6)] scale-105"
                              : isHintDest
                              ? "bg-yellow-50 border-yellow-400 shadow-[0_0_14px_4px_rgba(234,179,8,0.6)] scale-105"
                              : selected
                              ? "bg-blue-50 border-blue-400 shadow-[0_0_10px_3px_rgba(59,130,246,0.5)]"
                              : "bg-white border-gray-300 shadow-sm hover:shadow-md"
                          }`}
                          style={{
                            cursor: selected ? "grabbing" : "grab",
                            animation: (isHintSource || isHintDest) ? "hintPulse 0.6s ease-in-out 3" : undefined,
                          }}
                        >
                          <div className="leading-none" style={{ color: SUIT_CLR[card.suit] }}>
                            <div className="text-[9px] sm:text-sm font-bold leading-none">{RANK_SYM[card.rank]}</div>
                            <div className="text-[7px] sm:text-xs leading-none">{SUIT_SYM[card.suit]}</div>
                          </div>
                          <div className="text-center text-sm sm:text-2xl" style={{ color: SUIT_CLR[card.suit] }}>
                            {SUIT_SYM[card.suit]}
                          </div>
                          <div className="leading-none text-right self-end" style={{ color: SUIT_CLR[card.suit], transform: "rotate(180deg)" }}>
                            <div className="text-[9px] sm:text-sm font-bold leading-none">{RANK_SYM[card.rank]}</div>
                            <div className="text-[7px] sm:text-xs leading-none">{SUIT_SYM[card.suit]}</div>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="aspect-[5/7] rounded-[4px]"
                          style={{
                            background: "linear-gradient(145deg, #2563eb 0%, #1d4ed8 40%, #1e3a8a 100%)",
                            border: "1px solid #1e40af",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
                          }}
                        >
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-[70%] h-[80%] border border-white/20 rounded-[2px]" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Drag Ghost ─── */}
      {dragging && (
        <div
          className="fixed pointer-events-none z-[500]"
          style={{
            left: dragging.mouseX - dragging.offsetX,
            top: dragging.mouseY - dragging.offsetY,
            width: columnRefs.current[0]?.offsetWidth || 80,
          }}
        >
          {dragging.cards.map((card, i) => (
            <div key={i} style={{ position: "relative", top: i > 0 ? `${24 * i}px` : undefined, marginTop: i > 0 ? "-100%" : 0 }}>
              <div
                className="aspect-[5/7] rounded-[3px] sm:rounded-[5px] border-2 bg-blue-50 border-blue-400 shadow-[0_4px_16px_rgba(0,0,0,0.3)] flex flex-col justify-between p-0.5 sm:p-1.5"
                style={{ width: columnRefs.current[0]?.offsetWidth || 80 }}
              >
                <div className="leading-none" style={{ color: SUIT_CLR[card.suit] }}>
                  <div className="text-[9px] sm:text-sm font-bold leading-none">{RANK_SYM[card.rank]}</div>
                  <div className="text-[7px] sm:text-xs leading-none">{SUIT_SYM[card.suit]}</div>
                </div>
                <div className="text-center text-sm sm:text-2xl" style={{ color: SUIT_CLR[card.suit] }}>
                  {SUIT_SYM[card.suit]}
                </div>
                <div className="leading-none text-right self-end" style={{ color: SUIT_CLR[card.suit], transform: "rotate(180deg)" }}>
                  <div className="text-[9px] sm:text-sm font-bold leading-none">{RANK_SYM[card.rank]}</div>
                  <div className="text-[7px] sm:text-xs leading-none">{SUIT_SYM[card.suit]}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Bottom Bar ─── */}
      <div className="shrink-0 bg-[#1b5e2e]/80 border-t border-green-900/50 px-2 sm:px-4 py-1 sm:py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={dealFromStock}
            disabled={game.stock.length === 0 || game.columns.some(c => c.length === 0)}
            className="relative group"
            title={game.columns.some(c => c.length === 0) ? "所有列都必须有牌才能发牌" : `发牌 (D) (剩余${stockDeals}次)`}
          >
            {game.stock.length > 0 ? (
              <>
                {stockDeals > 1 && (
                  <div className="absolute top-[2px] left-[2px] w-[36px] sm:w-[52px] h-[48px] sm:h-[70px] rounded-[4px]"
                    style={{ background: "linear-gradient(145deg, #2563eb, #1e3a8a)", border: "1px solid #1e40af" }} />
                )}
                <div className="relative w-[36px] sm:w-[52px] h-[48px] sm:h-[70px] rounded-[4px] sm:rounded-[5px] group-hover:brightness-110 transition-all group-disabled:opacity-40 group-disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(145deg, #2563eb 0%, #1d4ed8 40%, #1e3a8a 100%)", border: "1px solid #1e40af" }}>
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-[70%] h-[80%] border border-white/25 rounded-[2px] flex items-center justify-center text-white/40 text-[10px] sm:text-sm font-bold">
                      {stockDeals}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="w-[36px] sm:w-[52px] h-[48px] sm:h-[70px] rounded-[4px] sm:rounded-[5px] border-2 border-dashed border-white/10" />
            )}
          </button>
          <span className="text-white/50 text-[10px] sm:text-xs">{game.stock.length}张</span>
        </div>

        <div className="flex gap-1 sm:gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`w-[36px] sm:w-[52px] h-[48px] sm:h-[70px] rounded-[4px] sm:rounded-[5px] border flex items-center justify-center text-base sm:text-2xl ${
                i < game.completed
                  ? "bg-white/90 border-white/40"
                  : "border-white/10 bg-white/[0.03]"
              }`}
              style={{ color: i < game.completed ? SUIT_CLR[0] : "transparent" }}
            >
              {i < game.completed ? SUIT_SYM[0] : ""}
            </div>
          ))}
        </div>
      </div>

      {/* ─── Hint pulse animation style ─── */}
      <style jsx>{`
        @keyframes hintPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>

      {/* ─── Win Overlay ─── */}
      {won && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-xl shadow-2xl p-8 text-center max-w-sm mx-4">
            <div className="text-4xl mb-3">🎉</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">恭喜通关!</h2>
            <p className="text-sm text-gray-500 mb-1">得分: {game.score}</p>
            <p className="text-sm text-gray-500 mb-1">步数: {game.moves}</p>
            <p className="text-sm text-gray-500 mb-4">用时: {fmt(timer)}</p>
            <button
              onClick={restartCurrent}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
            >
              再来一局
            </button>
          </div>
        </div>
      )}

      {/* ─── New Game Dialog ─── */}
      {showDialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setShowDialog(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-lg shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">新游戏</h2>
              <button onClick={() => setShowDialog(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">游戏昵称</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleNewGame(); }}
                  className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="输入你的昵称"
                  autoFocus
                />
                <p className="text-[10px] text-gray-400 mt-1">输入昵称开始新游戏</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">难度</label>
                <div className="flex gap-2">
                  {([1, 2, 4] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setDialogSuits(s)}
                      className={`flex-1 py-2 text-xs rounded-md transition-colors ${
                        dialogSuits === s
                          ? "border-2 border-green-600 bg-green-50 text-green-700 font-medium"
                          : "border border-gray-200 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {s} 花色
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleNewGame} className="flex-1 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors">
                  开始游戏
                </button>
                <button onClick={() => setShowDialog(false)} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Resume Dialog ─── */}
      {showResume && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 text-center">
            <div className="text-3xl mb-3">🃏</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">发现存档</h2>
            <p className="text-sm text-gray-500 mb-1">上次进度: {savedSnap?.state.completed ?? 0}/8 完成</p>
            <p className="text-sm text-gray-500 mb-1">得分: {savedSnap?.state.score ?? 0} | 步数: {savedSnap?.state.moves ?? 0}</p>
            <p className="text-sm text-gray-500 mb-4">用时: {fmt(savedSnap?.timer ?? 0)}</p>
            <div className="flex gap-3">
              <button onClick={resumeGame} className="flex-1 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors">
                继续游戏
              </button>
              <button onClick={startFresh} className="flex-1 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
                新游戏
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Scores Dialog ─── */}
      {showScores && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/50" onClick={() => setShowScores(false)}>
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">积分排名</h2>
              <button onClick={() => setShowScores(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            {loadHighScores().length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">暂无记录</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {loadHighScores().map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0 ? "bg-yellow-400 text-white" : i === 1 ? "bg-gray-300 text-white" : i === 2 ? "bg-orange-400 text-white" : "bg-gray-200 text-gray-600"
                      }`}>{i + 1}</span>
                      <span className="font-medium">{s.score}分</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {s.suits}花色 | {s.moves}步 | {fmt(s.time)} | {s.date}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // ── Landscape wrapper ──
  if (landscape) {
    return (
      <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", overflow: "hidden", zIndex: 9999, background: "#000" }}>
        <div style={{ transform: "rotate(90deg) translateY(-100%)", transformOrigin: "top left", width: "100vh", height: "100vw" }}>
          {gameContent}
        </div>
      </div>
    );
  }
  return gameContent;
}

// ─── Face-up card sub-component for drag ghost ───
function FaceUpCard({ card }: { card: Card }) {
  return (
    <div className="aspect-[5/7] rounded-[3px] sm:rounded-[5px] border sm:border-2 bg-white border-gray-300 flex flex-col justify-between p-0.5 sm:p-1.5">
      <div className="leading-none" style={{ color: SUIT_CLR[card.suit] }}>
        <div className="text-[9px] sm:text-sm font-bold leading-none">{RANK_SYM[card.rank]}</div>
        <div className="text-[7px] sm:text-xs leading-none">{SUIT_SYM[card.suit]}</div>
      </div>
      <div className="text-center text-sm sm:text-2xl" style={{ color: SUIT_CLR[card.suit] }}>
        {SUIT_SYM[card.suit]}
      </div>
      <div className="leading-none text-right self-end" style={{ color: SUIT_CLR[card.suit], transform: "rotate(180deg)" }}>
        <div className="text-[9px] sm:text-sm font-bold leading-none">{RANK_SYM[card.rank]}</div>
        <div className="text-[7px] sm:text-xs leading-none">{SUIT_SYM[card.suit]}</div>
      </div>
    </div>
  );
}
