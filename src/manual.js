import { Chess } from 'chess.js';
import { toUci } from './review.js';

export class ManualSession {
  constructor(fen = new Chess().fen()) {
    this.initialFen = new Chess(fen).fen();
    this.moves = [];
    this.cursor = 0;
  }
  get fen() { return this.cursor ? this.moves[this.cursor - 1].after : this.initialFen; }
  get lastMove() { return this.cursor ? this.moves[this.cursor - 1] : null; }
  board() {
    const board = new Chess(this.initialFen);
    for (const move of this.moves.slice(0, this.cursor)) board.move({ from: move.from, to: move.to, promotion: move.promotion });
    return board;
  }
  jump(cursor) { this.cursor = Math.max(0, Math.min(this.moves.length, cursor)); }
  legalMoves(square) { return this.board().moves({ square, verbose: true }); }
  play(input) {
    const board = this.board();
    if (board.isGameOver()) throw new Error('انتهت هذه الوضعية. تراجع عن نقلة أو ابدأ من جديد.');
    let normalized = input;
    if (typeof input === 'string') {
      const value = input.trim();
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(value)) {
        normalized = { from: value.slice(0, 2).toLowerCase(), to: value.slice(2, 4).toLowerCase(), promotion: value[4]?.toLowerCase() };
      } else normalized = value;
    }
    let move;
    try { move = board.move(normalized); } catch { throw new Error('نقلة غير قانونية. جرّب e4 أو Nf3 أو e2e4، أو حرّك قطعة على الرقعة.'); }
    // Truncate a future line only after the replacement move is legal.
    this.moves = [...this.moves.slice(0, this.cursor), move];
    this.cursor++;
    return move;
  }
  get positionCommand() {
    const history = this.moves.slice(0, this.cursor).map(toUci).join(' ');
    return `position fen ${this.initialFen}${history ? ` moves ${history}` : ''}`;
  }
}

export function positionSummary(board, evaluation = null) {
  if (board.isCheckmate()) return { title: `${board.turn() === 'w' ? 'الأسود' : 'الأبيض'} فاز بالكش مات`, score: 'مات', tone: board.turn() === 'w' ? 'black' : 'white' };
  if (board.isDraw()) return { title: 'الموقف تعادل', score: '0.0', tone: 'equal' };
  if (!evaluation) return { title: 'جارٍ تقييم الوضعية…', score: '…', tone: 'pending' };
  const cp = evaluation.cpWhite;
  if (Math.abs(cp) >= 9000) return { title: `${cp > 0 ? 'الأبيض' : 'الأسود'} لديه مات إجباري`, score: `M${Math.max(1, Math.round((10000 - Math.abs(cp)) / 50))}`, tone: cp > 0 ? 'white' : 'black' };
  return { title: Math.abs(cp) < 35 ? 'الموقف متوازن تقريبًا' : `${cp > 0 ? 'الأبيض' : 'الأسود'} متفوق`,
    score: `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`, tone: Math.abs(cp) < 35 ? 'equal' : cp > 0 ? 'white' : 'black' };
}
