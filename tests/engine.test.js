import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Chess } from 'chess.js';
import { parseEngineLine, classifyMove, toUci } from '../src/review.js';

test('real Stockfish: MultiPV and forced played moves compare the same root', {timeout:30000}, async t => {
  const engine=spawn(process.execPath,['node_modules/stockfish/bin/stockfish-19-lite-single.js'],{stdio:['pipe','pipe','pipe']});
  t.after(()=>engine.kill());
  let pending='';const listeners=new Set();
  engine.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines) for(const listener of listeners) listener(line)});
  const send=command=>engine.stdin.write(command+'\n');
  const wait=(target,commands)=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{listeners.delete(listener);reject(Error('Engine timeout'))},20000);const listener=line=>{if(target(line)){clearTimeout(timeout);listeners.delete(listener);resolve(line)}};listeners.add(listener);send(commands)});
  await wait(line=>line==='uciok','uci');
  await wait(line=>line==='readyok','isready');
  const search=async(fen,move=null)=>{const infos=[];const record=line=>{const parsed=parseEngineLine(line,fen);if(parsed)infos.push(parsed)};listeners.add(record);await wait(line=>line.startsWith('bestmove '),`setoption name MultiPV value ${move?1:2}\nposition fen ${fen}\ngo depth 12${move?' searchmoves '+move:''}`);listeners.delete(record);return infos;};
  const fen=new Chess().fen();
  const all=await search(fen);const depth12=all.filter(line=>line.depth===12);
  assert.ok(depth12.some(line=>line.multiPv===1));assert.ok(depth12.some(line=>line.multiPv===2));
  const before=new Chess();before.loadPgn('1. e4 e5 2. Bc4 Nc6 3. Qh5');
  const root=before.fen();const topLines=await search(root);const best=topLines.filter(l=>l.multiPv===1).at(-1);
  const forced=await search(root,'g8f6');const played=forced.at(-1);
  assert.equal(played.best,'g8f6');
  const move=before.move('Nf6');assert.equal(toUci(move),'g8f6');
  const result=classifyMove({move,best,played});
  assert.equal(result.category,'blunder');assert.ok(result.winLoss>=20);
  assert.notEqual(best.best,'g8f6');
});
