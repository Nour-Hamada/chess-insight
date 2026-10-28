import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { classifyMove, hasSoundSacrifice, isBookMove, parseEngineLine, toUci } from '../src/review.js';

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
