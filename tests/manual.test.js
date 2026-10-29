import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualSession, positionSummary } from '../src/manual.js';

test('manual input accepts SAN and coordinates, alternating colors legally', () => {
  const session=new ManualSession();session.play('e4');session.play('e7e5');session.play('Nf3');
  assert.equal(session.cursor,3);assert.equal(session.board().turn(),'b');assert.equal(session.board().get('f3').type,'n');
  assert.match(session.positionCommand,/moves e2e4 e7e5 g1f3$/);
});
test('an illegal move preserves the current position and redo line', () => {
  const session=new ManualSession();session.play('e4');session.play('e5');session.jump(1);
  const fen=session.fen;assert.throws(()=>session.play('e1e8'));
  assert.equal(session.fen,fen);assert.equal(session.moves.length,2);session.jump(2);assert.equal(session.board().get('e5').color,'b');
});
test('playing a new legal branch replaces only the future line', () => {
  const session=new ManualSession();session.play('e4');session.play('e5');session.play('Nf3');session.jump(1);session.play('c5');
  assert.deepEqual(session.moves.map(m=>m.san),['e4','c5']);assert.equal(session.cursor,2);
});
test('castling moves the king and rook and can be undone and redone', () => {
  const session=new ManualSession('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');session.play('O-O');
  assert.equal(session.board().get('g1').type,'k');assert.equal(session.board().get('f1').type,'r');
  session.jump(0);assert.equal(session.board().get('h1').type,'r');session.jump(1);assert.equal(session.board().get('f1').type,'r');
});
test('en passant is legal with preserved move history', () => {
  const session=new ManualSession();for(const m of ['e4','a6','e5','d5','exd6'])session.play(m);
  assert.equal(session.board().get('d5'),undefined);assert.equal(session.board().get('d6').color,'w');
});
test('promotion offers all four choices and honors underpromotion', () => {
  const session=new ManualSession('8/P7/8/8/8/8/7k/4K3 w - - 0 1');
  assert.deepEqual(session.legalMoves('a7').map(m=>m.promotion).sort(),['b','n','q','r']);
  session.play({from:'a7',to:'a8',promotion:'n'});assert.equal(session.board().get('a8').type,'n');
  assert.equal(positionSummary(session.board()).title,'الموقف تعادل');
});
test('checkmate prevents additional moves and identifies the winning side', () => {
  const session=new ManualSession();for(const m of ['f3','e5','g4','Qh4#'])session.play(m);
  assert.equal(positionSummary(session.board()).title,'الأسود فاز بالكش مات');assert.throws(()=>session.play('e4'));
  session.jump(3);assert.equal(session.board().isCheckmate(),false);
});
test('repetition detection survives navigating the line', () => {
  const session=new ManualSession();for(const m of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8'])session.play(m);
  assert.equal(session.board().isThreefoldRepetition(),true);session.jump(6);assert.equal(session.board().isThreefoldRepetition(),false);session.jump(8);assert.equal(session.board().isThreefoldRepetition(),true);
});
test('evaluation summaries use White-relative signs correctly', () => {
  const board=new ManualSession().board();assert.equal(positionSummary(board,{cpWhite:200}).title,'الأبيض متفوق');
  assert.equal(positionSummary(board,{cpWhite:-200}).title,'الأسود متفوق');assert.equal(positionSummary(board,{cpWhite:10}).tone,'equal');
  assert.equal(positionSummary(board).tone,'pending');
});
