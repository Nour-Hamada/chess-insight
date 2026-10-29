import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { parseHTML } from 'linkedom';
import { readBoardState } from '../extension/src/board-state.js';
import { positionFromPieces, PositionTracker, placementOf, visibleEnPassant } from '../extension/src/position.js';
import { readVisibleTurn } from '../extension/src/detect.js';

test('read position directly from the visible board when no history exists', () => {
  const board = new Chess(); for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) board.move(san);
  const { document } = parseHTML('<wc-chess-board id="visible"></wc-chess-board><wc-chess-board id="hidden"></wc-chess-board>');
  const visible = document.getElementById('visible'), hidden = document.getElementById('hidden');
  visible.getBoundingClientRect = () => ({ width: 480, height: 480 });
  hidden.getBoundingClientRect = () => ({ width: 0, height: 0 });
  visible.game = { getFEN: () => board.fen() };
  hidden.game = { getFEN: () => { throw new Error('Must not inspect a hidden board'); } };
  const read = readBoardState(document, 'visible');
  assert.equal(read.fen, board.fen()); assert.equal(read.method, 'board.game.getFEN');
  const result = new PositionTracker().resolve({ placement: placementOf(board.fen()), fullFen: read.fen });
  assert.equal(result.fen, board.fen());
});
test('direct adapter tolerates a missing API and ignores non-FEN values', () => {
  const { document } = parseHTML('<wc-chess-board id="board"></wc-chess-board>');
  const node = document.getElementById('board'); node.getBoundingClientRect = () => ({ width: 480, height: 480 });
  node.game = { getFEN: () => 'not a FEN', getFen: () => { throw Error('Unsupported'); } };
  assert.equal(readBoardState(document, 'board').fen, null);
  node.dataset.fen = new Chess().fen();
  assert.equal(readBoardState(document, 'board').fen, new Chess().fen());
  assert.equal(readBoardState(document, 'another-board').fen, null);
});
test('explicit current-board setup requires the side to move and preserves chosen castling', () => {
  const placement = placementOf(new Chess().fen());
  assert.throws(() => positionFromPieces(placement, { turn: '' }), /اختر صاحب الدور/);
  assert.equal(positionFromPieces(placement, { turn: 'b', castling: 'KQkq' }), placement + ' b KQkq - 0 1');
  assert.equal(positionFromPieces(placement, { turn: 'w', castling: '-' }).split(' ')[2], '-');
});
test('explicit setup rejects unavailable castling and retains legal en passant', () => {
  const placement = '8/8/3k4/8/4Q3/8/8/4K3';
  assert.throws(() => positionFromPieces(placement, { turn: 'b', castling: 'K' }), /لا يطابق/);
  const board = new Chess(); for (const san of ['e4', 'a6', 'e5', 'd5']) board.move(san);
  const fen = positionFromPieces(placementOf(board.fen()), { turn: 'w', castling: 'KQkq', epSquare: 'd6' });
  assert.ok(new Chess(fen).moves().includes('exd6'));
  assert.throws(() => positionFromPieces(placement, { turn: 'b', epSquare: 'd9' }), /مربع الأخذ/);
});
test('a bad trailing annotation cannot discard a previously matching legal history', () => {
  const board = new Chess(); board.move('e4'); board.move('e5');
  const result = new PositionTracker().resolve({ placement: placementOf(board.fen()), sans: ['e4', 'e5', 'unsupported-tail'] });
  assert.equal(result.fen, board.fen());
});
test('visual turn comes from the active clock with correct colors after flipping', () => {
  const { document } = parseHTML('<div class="round__app"><cg-board></cg-board><div class="rclock rclock-top running">5:00</div></div>');
  const board = document.querySelector('cg-board'), clock = document.querySelector('.rclock');
  clock.getBoundingClientRect = () => ({ width: 100, height: 40 });
  assert.equal(readVisibleTurn(document, board, false).turn, 'b');
  assert.equal(readVisibleTurn(document, board, true).turn, 'w');
  clock.className = 'clock-white clock-player-turn';
  assert.equal(readVisibleTurn(document, board, true).turn, 'w');
});
test('visible last-move markers identify next side and double-pawn en passant', () => {
  const { document } = parseHTML('<wc-chess-board></wc-chess-board>');
  const board = document.querySelector('wc-chess-board');
  const lastMove = { from: 'd7', to: 'd5', piece: 'bp' };
  assert.equal(readVisibleTurn(document, board, false, lastMove).turn, 'w');
  assert.equal(visibleEnPassant(lastMove, 'w'), 'd6');
  assert.equal(visibleEnPassant({ from: 'd6', to: 'd5', piece: 'bp' }, 'w'), '-');
  assert.equal(visibleEnPassant(lastMove, 'b'), '-');
  assert.equal(readVisibleTurn(document, board, false).turn, null);
});
