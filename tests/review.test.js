import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { classifyMove, hangingMaterial, hasSoundSacrifice, isBookMove, parseEngineLine, toUci } from '../src/review.js';

const play = (fen, san) => new Chess(fen).move(san);
const quietMove = play('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1', 'Ra2');
const classify = (move, before, after, extra = {}) => classifyMove({ move,
  best: { cpWhite: before, best: 'a1a8' }, played: { cpWhite: after }, ...extra });

test('a routine best capture or check does not earn brilliant or great', () => {
  const move = play('4k3/8/8/8/8/4p3/4R3/4K3 w - - 0 1', 'Rxe3+');
  assert.equal(hasSoundSacrifice(move), false);
  assert.equal(classify(move, 100, 100, {best:{cpWhite:100,best:toUci(move)},second:{cpWhite:90}}).category, 'best');
});
test('a change from +20 to +17 is not a blunder', () => {
  const result = classify(quietMove, 2000, 1700);
  assert.equal(result.category, 'best');
  assert.ok(result.accuracy > 99);
});
test('loss from equality to a lost position is a blunder for either color', () => {
  assert.equal(classify(quietMove, 0, -500).category, 'blunder');
  const blackMove = play('4k3/4r3/8/8/8/8/8/4K3 b - - 0 1', 'Ra7');
  assert.equal(classify(blackMove, 0, 500).category, 'blunder');
});
test('the engine top move has zero loss despite different search evaluations', () => {
  const result=classify(quietMove, 30, -80, {best:{cpWhite:30,best:toUci(quietMove)}});
  assert.equal(result.cpLoss, 0); assert.equal(result.winLoss, 0); assert.equal(result.accuracy,100);
});
test('a slower forced mate is not penalized as a centipawn loss', () => {
  assert.equal(classify(quietMove, 9950, 9800).category, 'best');
});
test('an offered knight is a sacrifice, an equal exchange is not', () => {
  const sacrifice=play('6k1/5ppp/8/6N1/8/8/8/6K1 w - - 0 1','Nxh7');
  assert.equal(hasSoundSacrifice(sacrifice),true);
  const extra={best:{cpWhite:100,best:toUci(sacrifice)}};
  assert.equal(classify(sacrifice,100,100,extra).category,'brilliant');
  assert.notEqual(classify(sacrifice,100,-100,{best:{cpWhite:-100,best:toUci(sacrifice)}}).category,'brilliant');
  assert.notEqual(classify(sacrifice,700,700,{best:{cpWhite:700,best:toUci(sacrifice)}}).category,'brilliant');
  const exchange=play('6k1/5bpp/8/8/2B5/8/8/6K1 w - - 0 1','Bxf7+');
  assert.equal(hasSoundSacrifice(exchange),false);
});
test('great requires evidence that the next best move is substantially worse', () => {
  const best={cpWhite:0,best:toUci(quietMove)};
  assert.equal(classify(quietMove,0,0,{best}).category,'best');
  assert.equal(classify(quietMove,0,0,{best,second:{cpWhite:-500}}).category,'great');
  assert.equal(classify(quietMove,0,0,{best,second:{cpWhite:-20}}).category,'best');
});
test('book classification is position-aware', () => {
  assert.equal(isBookMove(new Chess().fen(),'e2e4'),true);
  assert.equal(isBookMove('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1','e2e4'),false);
});
test('a miss requires an actual new opportunity from the opponent', () => {
  assert.equal(classify(quietMove,300,0,{previous:{cpWhite:0}}).category,'miss');
  assert.equal(classify(quietMove,300,0,{previous:{cpWhite:300}}).category,'blunder');
});
test('parse exact UCI scores with the correct color and MultiPV index', () => {
  const fen=new Chess().fen().replace(' w ',' b ');
  assert.deepEqual(parseEngineLine('info depth 16 multipv 2 score cp 30 pv e7e5 g1f3',fen),
    {depth:16,multiPv:2,cpWhite:-30,mateWhite:null,best:'e7e5',pv:['e7e5','g1f3']});
  assert.equal(parseEngineLine('info depth 16 score cp 20 lowerbound pv e7e5',fen),null);
  assert.equal(parseEngineLine('info depth 16 score cp 20',fen),null);
  assert.equal(parseEngineLine('info depth 16 score mate -3 pv e7e5',fen).cpWhite,9850);
});

test('leaving ANY piece to be taken for free counts as a sacrifice, not just the moved piece', () => {
  // The bishop steps aside and exposes the queen on d1 to the rook: the offered piece is not the mover.
  const discovered = play('3r2k1/8/8/8/8/3B4/8/3Q2K1 w - - 0 1', 'Be4');
  assert.equal(hangingMaterial(discovered.after), 900);
  assert.equal(hasSoundSacrifice(discovered), true);
  const best = { cpWhite: 200, best: toUci(discovered) };
  assert.equal(classify(discovered, 200, 200, { best }).category, 'brilliant');
});
test('a piece that was already attacked before the move is not a new sacrifice', () => {
  // The c6 pawn already attacks the bishop on b5; an unrelated pawn push is not a sacrifice.
  const unrelated = play('6k1/8/2p5/1B6/8/8/P7/6K1 w - - 0 1', 'a4');
  assert.equal(hasSoundSacrifice(unrelated), false);
});
test('a protected piece or an even trade is not offered for free', () => {
  const protectedMove = play('6k1/8/8/8/8/2N5/1P6/6K1 w - - 0 1', 'Nd5');
  assert.equal(hasSoundSacrifice(protectedMove), false);
});
test('an already winning position still earns brilliant when the sacrifice raises the advantage', () => {
  const sacrifice = play('6k1/5ppp/8/6N1/8/8/8/6K1 w - - 0 1', 'Nxh7');
  const best = { cpWhite: 700, best: toUci(sacrifice) };
  assert.equal(classify(sacrifice, 700, 700, { best, second: { cpWhite: 400 } }).category, 'brilliant');
  assert.notEqual(classify(sacrifice, 700, 700, { best, second: { cpWhite: 650 } }).category, 'brilliant');
  assert.notEqual(classify(sacrifice, 1300, 1300, { best: { cpWhite: 1300, best: toUci(sacrifice) }, second: { cpWhite: 100 } }).category, 'brilliant');
});
test('a near-best sacrifice (within one win-percent) is still brilliant, a clear drop is not', () => {
  const sacrifice = play('6k1/5ppp/8/6N1/8/8/8/6K1 w - - 0 1', 'Nxh7');
  const bestElsewhere = { cpWhite: 110, best: 'g5f7' };
  assert.equal(classify(sacrifice, 110, 100, { best: bestElsewhere }).category, 'brilliant');
  assert.notEqual(classify(sacrifice, 300, 100, { best: { cpWhite: 300, best: 'g5f7' } }).category, 'brilliant');
});
