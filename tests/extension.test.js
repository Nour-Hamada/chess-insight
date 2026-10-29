import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { PositionTracker, placementOf, makePlacement, START, scoreLabel } from '../extension/src/position.js';
import { arrowPoints } from '../extension/src/detect.js';

test('detected placement requires known turn; explicit FEN must match', () => {
  const tracker = new PositionTracker();
  const board = new Chess(); board.move('e4');
  const reading = { placement: placementOf(board.fen()) };
  assert.equal(tracker.resolve(reading), null);
  assert.throws(() => tracker.resolve(reading, START), /لا يطابق/);
  assert.equal(tracker.resolve(reading, board.fen()).fen, board.fen());
});
test('main-line history reconstructs browsed earlier position including castling rights', () => {
  const tracker = new PositionTracker();
  const sans = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7'.split(' ');
  const board = new Chess(); for (const move of sans.slice(0, 9)) board.move(move);
  const result = tracker.resolve({ placement: placementOf(board.fen()), sans });
  assert.equal(result.fen, board.fen()); assert.equal(result.history.length, 9);
  assert.match(result.position, /moves e2e4 e7e5/);
  assert.equal(result.fen.split(' ')[2], 'kq');
});
test('automatic tracking handles en passant, capture, undo and a new branch', () => {
  const tracker = new PositionTracker(), board = new Chess();
  tracker.resolve({ placement: placementOf(board.fen()) });
  const history = [];
  for (const san of ['e4', 'a6', 'e5', 'd5', 'exd6']) {
    board.move(san); history.push(board.fen());
    assert.equal(tracker.resolve({ placement: placementOf(board.fen()) }).fen, board.fen());
  }
  board.undo(); assert.equal(tracker.resolve({ placement: placementOf(board.fen()) }).fen, history[3]);
  board.move('Nf3'); assert.equal(tracker.resolve({ placement: placementOf(board.fen()) }).fen, board.fen());
});
test('selected ply distinguishes repeated positions with different move counters', () => {
  const tracker = new PositionTracker();
  const sans = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];
  const board = new Chess(); for (const san of sans.slice(0, 4)) board.move(san);
  const resolved = tracker.resolve({ placement: placementOf(board.fen()), sans, selectedPly: 4 });
  assert.equal(resolved.fen, board.fen());
  assert.equal(resolved.history.length, 4);
});
test('tracking handles promotion and terminal scoring', () => {
  const board = new Chess('8/P7/8/8/8/8/7k/4K3 w - - 0 1'), tracker = new PositionTracker();
  tracker.resolve({ placement: placementOf(board.fen()), fullFen: board.fen() });
  board.move('a8=N'); assert.equal(tracker.resolve({ placement: placementOf(board.fen()) }).fen, board.fen());
  assert.match(scoreLabel({ cpWhite: -10000, terminal: 'mate' }).title, /الأسود/);
  assert.match(scoreLabel({ cpWhite: 9500, mate: 10 }).score, /M10/);
  assert.match(scoreLabel({ cpWhite: -125 }).title, /الأسود/);
});
test('board coordinates and green arrow reverse correctly when flipped', () => {
  const board = new Chess(), pieces = new Map();
  for (const row of board.board()) for (const p of row) if (p) pieces.set(p.square, p.color + p.type);
  assert.equal(makePlacement(pieces), placementOf(START));
  const normal = arrowPoints('e2e4'), flipped = arrowPoints('e2e4', true);
  assert.ok(normal.to.y < normal.from.y); assert.ok(flipped.to.y > flipped.from.y);
  assert.equal(normal.to.x + flipped.to.x, 100);
});
