import { spawn } from 'node:child_process';
import { Chess } from 'chess.js';
import { parseEngineLine, classifyMove, toUci } from '../../src/review.js';

// Mirrors the browser pipeline (MultiPV 2, forced played-move search) against real Stockfish.
export async function reviewPgn(pgn, depth = 12) {
  const engine = spawn(process.execPath, ['node_modules/stockfish/bin/stockfish-19-lite-single.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = ''; const listeners = new Set();
  engine.stdout.on('data', chunk => { pending += chunk; const lines = pending.split(/\r?\n/); pending = lines.pop(); for (const l of lines) for (const f of listeners) f(l); });
  const send = c => engine.stdin.write(c + '\n');
  const wait = (target, cmd) => new Promise((res, rej) => { const t = setTimeout(() => rej(Error('timeout')), 60000); const f = l => { if (target(l)) { clearTimeout(t); listeners.delete(f); res(l); } }; listeners.add(f); send(cmd); });
  await wait(l => l === 'uciok', 'uci'); await wait(l => l === 'readyok', 'isready');
  const search = async (fen, { multiPv = 1, move = null } = {}) => {
    const lines = new Map();
    const rec = l => { const p = parseEngineLine(l, fen); if (p) { const o = lines.get(p.multiPv); if (!o || p.depth >= o.depth) lines.set(p.multiPv, p); } };
    listeners.add(rec);
    const bm = await wait(l => l.startsWith('bestmove '), `setoption name MultiPV value ${multiPv}\nposition fen ${fen}\ngo depth ${depth}${move ? ' searchmoves ' + move : ''}`);
    listeners.delete(rec);
    const best = bm.split(/\s+/)[1];
    const primary = [...lines.values()].find(x => x.best === best);
    return { ...primary, best, lines: [...lines.values()].filter(x => x.depth === primary.depth) };
  };
  const game = new Chess(); game.loadPgn(pgn);
  const moves = game.history({ verbose: true });
  const evals = [];
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const best = await search(m.before, { multiPv: 2 });
    evals.push(best);
    let played = best.lines.find(l => l.best === toUci(m));
    if (!played) played = await search(m.before, { move: toUci(m) });
    const second = best.lines.find(l => l.best !== best.best) || null;
    const r = classifyMove({ move: m, best, played, second, previous: i ? evals[i - 1] : null });
    out.push({ n: Math.floor(i / 2) + 1, color: m.color, san: m.san, cat: r.category, best: best.cpWhite, played: played.cpWhite, second: second?.cpWhite, pv: best.pv.slice(0, 6).join(' ') });
  }
  engine.kill();
  return out;
}

if (process.argv[1].endsWith('review-harness.mjs')) {
  const pgn = process.argv[2];
  for (const r of await reviewPgn(pgn)) console.log(`${r.n}${r.color === 'w' ? '.' : '...'} ${r.san.padEnd(7)} ${r.cat.padEnd(10)} best=${r.best} played=${r.played} second=${r.second}`);
}
