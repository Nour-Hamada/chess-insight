import { Chess } from 'chess.js';

export const placementOf = fen => fen.split(' ')[0];
export const START = new Chess().fen();
export function makePlacement(pieces) {
  const ranks = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '', empty = 0;
    for (const file of 'abcdefgh') {
      const piece = pieces.get(file + rank);
      if (!piece) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += piece[0] === 'w' ? piece[1].toUpperCase() : piece[1];
    }
    ranks.push(row + (empty || ''));
  }
  return ranks.join('/');
}

export function positionFromPieces(placement, { turn, castling = '-', epSquare = '-' }) {
  if (!['w', 'b'].includes(turn)) throw new Error('اختر صاحب الدور أولًا.');
  if (!/^(?:-|K?Q?k?q?)$/.test(castling) || !castling) throw new Error('حقوق التبييت غير صالحة.');
  if (!/^(?:-|[a-h][36])$/.test(epSquare)) throw new Error('مربع الأخذ بالتجاوز يجب أن يكون مثل d6 أو -.');
  const board = new Chess(`${placement} ${turn} - - 0 1`);
  for (const [right, color, rook] of [['K', 'w', 'h1'], ['Q', 'w', 'a1'], ['k', 'b', 'h8'], ['q', 'b', 'a8']]) {
    if (!castling.includes(right)) continue;
    const king = board.get(color === 'w' ? 'e1' : 'e8'), piece = board.get(rook);
    if (king?.type !== 'k' || king.color !== color || piece?.type !== 'r' || piece.color !== color) throw new Error('التبييت المحدد لا يطابق مواضع الملك والرخ.');
  }
  return new Chess(`${placement} ${turn} ${castling} ${epSquare} 0 1`).fen();
}

export function visibleEnPassant(lastMove, turn) {
  if (!lastMove || lastMove.piece?.[1] !== 'p' || lastMove.piece[0] === turn || lastMove.from[0] !== lastMove.to[0]) return '-';
  const [from, to] = [Number(lastMove.from[1]), Number(lastMove.to[1])];
  if (lastMove.piece[0] === 'w' && from === 2 && to === 4) return lastMove.from[0] + '3';
  if (lastMove.piece[0] === 'b' && from === 7 && to === 5) return lastMove.from[0] + '6';
  return '-';
}

// Placement alone cannot tell whose turn it is or recover castling rights.
// Preserve a legal history whenever possible; otherwise require an explicit FEN.
export class PositionTracker {
  constructor() { this.reset(); }
  reset() { this.board = null; this.snapshots = []; this.source = ''; }
  remember(board, source) {
    this.board = board;
    this.source = source;
    const fen = board.fen();
    if (this.snapshots.at(-1) !== fen) this.snapshots.push(fen);
    this.snapshots = this.snapshots.slice(-500);
    return { fen, source, history: board.history(), position: this.command(board) };
  }
  command(board) {
    const moves = board.history({ verbose: true });
    const initial = moves[0]?.before || board.fen();
    return `position fen ${initial}${moves.length ? ' moves ' + moves.map(m => m.from + m.to + (m.promotion || '')).join(' ') : ''}`;
  }
  resolve(reading, override = null) {
    const { placement, fullFen, sans = [], initialFen = START, selectedPly = null } = reading;
    if (override) {
      const board = new Chess(override);
      if (placementOf(board.fen()) !== placement) throw new Error('FEN لا يطابق القطع الظاهرة على الرقعة.');
      return this.remember(board, 'FEN مُدخل');
    }
    if (fullFen) {
      try {
        const board = new Chess(fullFen);
        if (placementOf(board.fen()) === placement) {
          if (this.board?.fen() === board.fen()) return this.remember(this.board, this.source);
          return this.remember(board, 'FEN الرقعة');
        }
      } catch { /* Incomplete DOM update: try the legal history instead. */ }
    }
    if (sans.length) {
      try {
        const board = new Chess(initialFen);
        let match = placementOf(board.fen()) === placement ? new Chess(initialFen) : null;
        for (const san of sans.slice(0, selectedPly ?? sans.length)) {
          try { board.move(san); } catch { break; }
          if (placementOf(board.fen()) === placement) {
            match = new Chess(initialFen);
            for (const move of board.history()) match.move(move);
          }
        }
        if (match && (selectedPly == null || match.history().length === selectedPly)) return this.remember(match, 'سجل النقلات');
      } catch { /* A partial/unsupported move list is not grounds for guessing. */ }
    }
    if (this.board) {
      if (placementOf(this.board.fen()) === placement) return this.remember(this.board, this.source);
      const matches = this.board.moves({ verbose: true }).filter(m => placementOf(m.after) === placement);
      if (matches.length === 1) {
        this.board.move(matches[0]);
        return this.remember(this.board, 'متابعة النقلات');
      }
      const past = this.snapshots.findLast(fen => placementOf(fen) === placement);
      if (past) return this.remember(new Chess(past), 'وضعية سابقة');
    }
    if (placement === placementOf(START)) return this.remember(new Chess(), 'بداية المباراة');
    return null;
  }
}

export function scoreLabel(result) {
  if (result.terminal === 'mate') return { title: `${result.cpWhite > 0 ? 'الأبيض' : 'الأسود'} فاز بالكش مات`, score: 'مات' };
  if (result.terminal === 'draw') return { title: 'الموقف تعادل', score: '0.0' };
  if (result.mate != null) return { title: `${result.cpWhite > 0 ? 'الأبيض' : 'الأسود'} لديه مات إجباري`, score: `M${Math.abs(result.mate)}` };
  const cp = result.cpWhite;
  return { title: Math.abs(cp) < 35 ? 'الموقف متوازن تقريبًا' : `${cp > 0 ? 'الأبيض' : 'الأسود'} متفوق`, score: `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}` };
}
