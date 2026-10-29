import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlacement } from '../src/screenshot-recognition.js';

const valid = '4k3/8/8/8/8/8/8/4K3';
test('accepts a valid minimal chess placement', () => {
  assert.equal(validatePlacement(valid).ok, true);
});
test('rejects missing or duplicated kings; never invents them', () => {
  assert.equal(validatePlacement('8/8/8/8/8/8/8/4K3').ok, false);
  assert.equal(validatePlacement('4k3/8/8/8/8/8/8/4KK2').ok, false);
});
test('rejects malformed grids and invalid piece symbols', () => {
  for (const fen of [
    '4k3/8/8/8/8/8/8/4K2',
    '4k3/8/8/8/8/8/8/3XK3',
    '4k3/8/8/8/8/8/4K3',
  ]) assert.equal(validatePlacement(fen).ok, false, fen);
});
test('rejects impossible pawn ranks and oversized armies', () => {
  assert.equal(validatePlacement('P3k3/8/8/8/8/8/8/4K3').ok, false);
  assert.equal(validatePlacement('4k3/PPPPPPPP/PPPPPPPP/8/8/8/8/4K3').ok, false);
});
test('rejects mutually adjacent kings', () => {
  assert.equal(validatePlacement('8/8/8/8/8/4k3/4K3/8').ok, false);
});

test('accepts the actual position from the regression screenshot', () => {
  const placement = 'rnb1k1nr/3pb1pp/p1p5/1p2p3/4P3/2N1B3/PPP1QPPP/2KR1B1R';
  assert.equal(validatePlacement(placement).ok, true);
});
test('rejects bishop explosion from the former overlay-detection heuristic', () => {
  assert.equal(validatePlacement('rbbqkbnr/pppppppp/b1b1b1b1/8/8/8/PPPPPPPP/RNBQKBNR').ok, false);
});
test('permits a real promoted piece only if a pawn has disappeared', () => {
  assert.equal(validatePlacement('4k3/8/8/8/8/8/PPPPPPP1/RNBQKBBR').ok, true);
  assert.equal(validatePlacement('4k3/8/8/8/8/8/PPPPPPPP/RNBQKBBR').ok, false);
});
