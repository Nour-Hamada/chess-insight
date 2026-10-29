import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { Chess } from 'chess.js';
import { readMoveHistory, sanText } from '../extension/src/detect.js';
import { PositionTracker, placementOf } from '../extension/src/position.js';

const line = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 c4 c6 Nc3 Qc7'.split(' ');
function notation(san) {
  if (/^[KQRBN]/.test(san)) return `<span data-figurine="${san[0]}"></span>${san.slice(1)}`;
  return san.replaceAll('O', '0');
}
function fixture(sans = line, selected = sans.length) {
  const { document } = parseHTML(`<wc-chess-board id="live-board"></wc-chess-board><wc-simple-move-list board-id="live-board">${sans.map((san, i) => `<div class="main-line-ply ${i % 2 ? 'black' : 'white'}-move" data-node="0-${i}"><span class="node-highlight-content ${i + 1 === selected ? 'selected' : ''}">${notation(san)}<span class="annotation">!!</span></span><span class="timestamp">0:12</span></div>`).join('')}</wc-simple-move-list>`);
  return document;
}
function expected(sans) { const board = new Chess(); for (const san of sans) board.move(san); return board; }

test('opening extension at ply 24 reads the play-page list without previous observations', () => {
  const document = fixture(), board = expected(line);
  const history = readMoveHistory(document, 'Chess.com', document.querySelector('wc-chess-board'));
  assert.deepEqual(history.sans, line); assert.equal(history.selectedPly, 24);
  const result = new PositionTracker().resolve({ placement: placementOf(board.fen()), ...history });
  assert.equal(result.fen, board.fen());
  assert.equal(result.history.length, 24); assert.equal(result.fen.split(' ')[2], '-');
});
test('midgame activation restores en passant and the correct side to move', () => {
  const sans = ['e4', 'a6', 'e5', 'd5'], board = expected(sans), document = fixture(sans);
  const history = readMoveHistory(document, 'Chess.com', document.querySelector('wc-chess-board'));
  const result = new PositionTracker().resolve({ placement: placementOf(board.fen()), ...history });
  assert.equal(result.fen, board.fen()); assert.equal(result.fen.split(' ')[3], 'd6');
});
test('selected earlier ply is restored even when later moves are present', () => {
  const document = fixture(line, 17), board = expected(line.slice(0, 17));
  const history = readMoveHistory(document, 'Chess.com', document.querySelector('wc-chess-board'));
  assert.equal(history.selectedPly, 17);
  assert.equal(new PositionTracker().resolve({ placement: placementOf(board.fen()), ...history }).fen, board.fen());
});
test('history is scoped to the detected board and variations are excluded', () => {
  const document = fixture();
  const decoy = document.createElement('wc-move-list'); decoy.setAttribute('board-id', 'other-board');
  decoy.innerHTML = '<div class="main-line-ply"><span class="node-highlight-content">d4</span></div>'.repeat(40);
  document.body.appendChild(decoy);
  const variation = document.createElement('div'); variation.innerHTML = '<div class="main-line-ply" data-node="1-0"><span class="node-highlight-content">a4</span></div>';
  document.querySelector('wc-simple-move-list').appendChild(variation);
  assert.deepEqual(readMoveHistory(document, 'Chess.com', document.querySelector('wc-chess-board')).sans, line);
});
test('legacy live move-list containers work without main-line wrappers', () => {
  const { document } = parseHTML('<wc-chess-board id="live"></wc-chess-board><div id="live-game-tab-scroll-container"><span class="node-highlight-content">e4</span><span class="node-highlight-content">e5</span><span class="node-highlight-content"><span class="icon-font-chess knight-white"></span>f3</span><div class="variation"><span class="node-highlight-content">a4</span></div></div>');
  assert.deepEqual(readMoveHistory(document, 'Chess.com', document.querySelector('wc-chess-board')).sans, ['e4', 'e5', 'Nf3']);
});
test('piece figurines, pawn icons, annotations and castling are normalized legally', () => {
  const { document } = parseHTML('<div></div>'); const element = document.querySelector('div');
  for (const [html, san] of [
    ['17... ♞f6?!<span class="timestamp">0:20</span>', 'Nf6'],
    ['<span data-figurine="p"></span>exd6 e.p.', 'exd6'],
    ['0-0-0+', 'O-O-O+'],
    ['<span data-figurine="Q"></span>\u200eh7#<span data-nag="3">!!</span>', 'Qh7#']
  ]) { element.innerHTML = html; assert.equal(sanText(element), san); }
});
test('Lichess round history survives changing custom tag names and draw markers', () => {
  const { document } = parseHTML(`<div class="round__app"><cg-board></cg-board><new-list><move-index>1</move-index>${line.map((san, i) => `<unknown-ply class="${i === 23 ? 'a1t' : ''}">${san}${i === 0 ? '<draw>½?</draw>' : ''}</unknown-ply>`).join('')}</new-list><time>12:05</time></div>`);
  const history = readMoveHistory(document, 'Lichess', document.querySelector('cg-board'));
  assert.deepEqual(history.sans, line); assert.equal(history.selectedPly, 24);
  const board = expected(line);
  assert.equal(new PositionTracker().resolve({ placement: placementOf(board.fen()), ...history }).fen, board.fen());
});
