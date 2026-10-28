import { Chess } from 'chess.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const winChance = cp => 100 / (1 + Math.exp(-0.00368208 * clamp(cp, -10000, 10000)));
export const accuracyFromLoss = loss => loss <= 0 ? 100 : clamp(103.1668 * Math.exp(-0.04354 * loss) - 3.1669, 0, 100);
export const toUci = move => move.from + move.to + (move.promotion || '');

// A small, position-aware opening repertoire. A matching coordinate move alone
// is not sufficient: the full board position must be in a known opening line.
const OPENINGS = [
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3',
  'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5',
  'e4 e5 Nf3 Nc6 d4 exd4 Nxd4',
  'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3',
  'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4',
  'e4 c6 d4 d5 Nc3 dxe4 Nxe4',
  'e4 e6 d4 d5 Nc3 Nf6',
  'e4 d6 d4 Nf6 Nc3 g6',
  'd4 d5 c4 e6 Nc3 Nf6',
  'd4 d5 c4 c6 Nf3 Nf6',
  'd4 Nf6 c4 e6 Nc3 Bb4',
  'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6',
  'c4 e5 Nc3 Nf6 g3',
  'Nf3 d5 g3 Nf6 Bg2',
];
const positionKey = fen => fen.split(' ').slice(0, 4).join(' ');
const book = new Set();
for (const line of OPENINGS) {
  const board = new Chess();
  for (const san of line.split(' ')) {
    const before = positionKey(board.fen());
    const move = board.move(san);
    book.add(`${before}|${toUci(move)}`);
  }
}
export const isBookMove = (fen, uci) => book.has(`${positionKey(fen)}|${uci}`);

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
// Legal static exchanges include pins and defended pieces; normal equal trades
// must not count as sacrifices. Stop early rather than awarding an uncertain tag.
function exchangeGain(board, square, depth = 0) {
  if (depth >= 12) return 0;
  let best = 0;
  for (const candidate of board.moves({ verbose: true })) {
    if (candidate.to !== square || !candidate.captured) continue;
    const move = board.move(toUciObject(candidate));
    const gain = VALUE[move.captured] + (move.promotion ? VALUE[move.promotion] - VALUE.p : 0);
    best = Math.max(best, gain - exchangeGain(board, square, depth + 1));
    board.undo();
  }
  return best;
}
const toUciObject = move => ({ from: move.from, to: move.to, promotion: move.promotion });
export function hasSoundSacrifice(move) {
  if (!move || !['n', 'b', 'r', 'q'].includes(move.piece) || move.promotion) return false;
  const board = new Chess(move.after);
  // Immediate mate is already decisive; a last-move capture is not proof of sacrifice.
  if (board.isGameOver()) return false;
  const offeredMaterial = exchangeGain(board, move.to);
  const gainedMaterial = VALUE[move.captured] || 0;
  return offeredMaterial - gainedMaterial >= 150;
}

// Our transparent approximation; these are not Chess.com's proprietary labels.
export function classifyMove({ move, best, played, second = null, previous = null }) {
  const mover = move.color === 'w' ? 1 : -1;
  const uci = toUci(move);
  const top = best.best === uci;
  const beforeWin = winChance(best.cpWhite * mover);
  const afterWin = winChance(played.cpWhite * mover);
  // The very same root move cannot lose points just because a separate search
  // reached a different score. Both scores below come from the pre-move root.
  const winLoss = top ? 0 : Math.max(0, beforeWin - afterWin);
  const cpLoss = top ? 0 : Math.round(Math.max(0, mover * (best.cpWhite - played.cpWhite)));
  let category;
  if (isBookMove(move.before, uci) && winLoss < 2) category = 'book';
  else if (top && beforeWin <= 75 && afterWin >= 50 && hasSoundSacrifice(move)) category = 'brilliant';
  else {
    const secondWin = second ? winChance(second.cpWhite * mover) : null;
    const onlyGoodMove = top && secondWin !== null && beforeWin - secondWin >= 15
      && ((beforeWin >= 50 && secondWin < 40) || (beforeWin >= 70 && secondWin < 55));
    const missedOpportunity = previous && winChance(previous.cpWhite * mover) <= 55
      && beforeWin >= 65 && afterWin <= 55 && winLoss >= 10;
    if (onlyGoodMove) category = 'great';
    else if (top || winLoss <= 0.5) category = 'best';
    else if (winLoss < 2) category = 'excellent';
    else if (winLoss < 5) category = 'good';
    else if (missedOpportunity) category = 'miss';
    else if (winLoss < 10) category = 'inaccuracy';
    else if (winLoss < 20) category = 'mistake';
    else category = 'blunder';
  }
  return { category, cpLoss, winLoss, accuracy: accuracyFromLoss(winLoss) };
}

// UCI scores are relative to the side to move. Only accept exact scores with a
// principal variation; bounded aspiration-search lines must not become verdicts.
export function parseEngineLine(line, fen) {
  if (!line.startsWith('info ') || /\b(?:lowerbound|upperbound)\b/.test(line)) return null;
  const match = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  const pv = line.match(/\bpv\s+(.+)$/)?.[1].trim().split(/\s+/);
  const depth = Number(line.match(/\bdepth\s+(\d+)/)?.[1] || 0);
  if (!match || !pv?.length || !depth) return null;
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  const score = Number(match[2]);
  const mate = match[1] === 'mate' ? score : null;
  const cp = mate === null ? score : (mate === 0 ? -10000 : Math.sign(mate) * (10000 - Math.min(100, Math.abs(mate)) * 50));
  return { depth, multiPv: Number(line.match(/\bmultipv\s+(\d+)/)?.[1] || 1),
    cpWhite: sign * cp, mateWhite: mate === null ? null : sign * mate, best: pv[0], pv };
}
