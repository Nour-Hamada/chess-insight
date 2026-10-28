import { Chess } from 'chess.js';
import { getPieceSvg } from './pieces.js';
import './style.css';

const START_FEN = new Chess().fen();
const DEMO = `[Event "Chess Insight Demo"]
[Site "Local analysis"]
[Date "2026.10.28"]
[White "White Player"]
[Black "Black Player"]
[Result "1-0"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# 1-0`;

const LABELS = [
  ['brilliant', 'عبقرية (Brilliant)', '!!', '#21bcc7'],
  ['great', 'رائعة (Great)', '!', '#5b8bb0'],
  ['book', 'افتتاحية (Book)', '📖', '#d5a47e'],
  ['best', 'الأفضل (Best)', '★', '#81b64c'],
  ['excellent', 'ممتازة (Excellent)', '👍', '#96bc76'],
  ['good', 'جيدة (Good)', '✓', '#86b59b'],
  ['inaccuracy', 'عدم دقة (Inaccuracy)', '?!', '#f7c631'],
  ['mistake', 'خطأ (Mistake)', '?', '#ffa459'],
  ['miss', 'إضاعة فرصة (Miss)', '✖', '#fa7069'],
  ['blunder', 'هفوة فادحة (Blunder)', '??', '#fa412d'],
];

const byId = id => document.getElementById(id);
let game = null;
let currentPgn = '';
let position = 0;
let flipped = false;
let worker = null;
let readyPromise = null;
let runId = 0;
let abortRequested = false;
let analyses = null;
let currentHint = null; // { fen, uci, from, to, san, cpText }

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const formatNum = n => Number.isFinite(n) ? n.toFixed(1) : '—';
const pause = ms => new Promise(res => setTimeout(res, ms));

function status(text, type = 'info') {
  const el = byId('status');
  if (el) {
    el.textContent = text;
    el.dataset.type = type;
  }
}

function uciToSan(fen, uci) {
  if (!uci || uci === '(none)') return null;
  try {
    const c = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.slice(4, 5) || undefined;
    const m = c.move({ from, to, promotion });
    return m ? m.san : uci;
  } catch {
    return uci;
  }
}

function computeGames(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const moves = chess.history({ verbose: true });
  if (!moves.length) throw new Error('لم يتم العثور على نقلات صحيحة في ملف PGN.');
  if (moves.length > 500) throw new Error('هذه النسخة تدعم حتى 500 نصف نقلة في المباراة الواحدة.');
  const headers = chess.getHeaders ? chess.getHeaders() : (chess.header ? chess.header() : {});
  return {
    moves,
    headers,
    fens: [moves[0].before, ...moves.map(m => m.after)]
  };
}

function resetResults() {
  analyses = null;
  currentHint = null;
  for (const color of ['white', 'black']) {
    byId(`${color}-accuracy`).innerHTML = '—<small>%</small>';
    byId(`${color}-mini-score`).textContent = '—';
    byId(`${color}-accuracy-sub`).textContent = 'لم يُحلّل بعد';
    byId(`${color}-meter`).style.width = '0%';
  }
  byId('chart-wrap').innerHTML = '<div class="chart-empty"><span>↗</span> سيظهر المنحنى بعد التحليل</div>';
  byId('coach-bubble').textContent = 'المباراة جاهزة للعرض. اضغط على «ابدأ التحليل» وسنستعرض دقة النقلات وتصنيفاتها بالكامل.';
  const hintBanner = byId('hint-banner');
  if (hintBanner) {
    hintBanner.hidden = true;
    hintBanner.textContent = '';
  }
  updateEvalBar(0);
  renderStats();
}

function loadGame(pgn) {
  if (worker && abortRequested === false && readyPromise) cancelAnalysis();
  game = computeGames(pgn);
  currentPgn = pgn.trim();
  runId++;
  position = 0;
  flipped = false;
  resetResults();

  const whiteName = game.headers.White || 'الأبيض';
  const blackName = game.headers.Black || 'الأسود';
  byId('white-name').textContent = whiteName;
  byId('black-name').textContent = blackName;
  byId('report-white-name').textContent = whiteName;
  byId('report-black-name').textContent = blackName;
  byId('white-elo').textContent = game.headers.WhiteElo ? `ELO ${game.headers.WhiteElo}` : 'WHITE';
  byId('black-elo').textContent = game.headers.BlackElo ? `ELO ${game.headers.BlackElo}` : 'BLACK';
  byId('input-hint').textContent = `تم تحميل ${game.moves.length} نصف نقلة بنجاح.`;
  status('المباراة جاهزة. اضغط «ابدأ التحليل» لتشغيل Stockfish.', 'success');
  renderAll();
}

function updateEvalBar(cp) {
  const barFill = byId('eval-bar-fill');
  const barScore = byId('eval-bar-score');
  if (!barFill || !barScore) return;

  if (cp === null || cp === undefined) {
    barFill.style.height = '50%';
    barScore.textContent = '0.0';
    barScore.className = 'eval-bar-score';
    return;
  }

  let pct = 50;
  let text = '0.0';

  if (Math.abs(cp) >= 9000) {
    const distance = Math.round((10000 - Math.abs(cp)) / 50);
    const sign = cp > 0 ? '' : '-';
    text = `M${sign}${Math.max(1, distance)}`;
    pct = cp > 0 ? 98 : 2;
  } else {
    pct = 50 + 50 * (2 / (1 + Math.exp(-0.0035 * cp)) - 1);
    pct = Math.max(3, Math.min(97, pct));
    const val = (Math.abs(cp) / 100).toFixed(1);
    text = cp > 0 ? `+${val}` : (cp < 0 ? `-${val}` : '0.0');
  }

  const finalPct = flipped ? (100 - pct) : pct;
  barFill.style.height = `${finalPct}%`;
  barScore.textContent = text;

  if (finalPct >= 50) {
    barScore.className = 'eval-bar-score white-adv';
  } else {
    barScore.className = 'eval-bar-score black-adv';
  }
}

function boardCells(fen) {
  const chess = new Chess(fen);
  const checked = chess.inCheck();
  const turn = chess.turn();
  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const file = 'abcdefgh'[c];
      const rank = 8 - r;
      const square = `${file}${rank}`;
      const piece = chess.get(square);
      const isCheckedKing = checked && piece && piece.type === 'k' && piece.color === turn;
      cells.push({ r, c, square, piece, isCheckedKing });
    }
  }
  return cells;
}

function renderBoard() {
  const grid = byId('board');
  grid.replaceChildren();
  const fen = game ? game.fens[position] : START_FEN;
  const last = game && position > 0 ? game.moves[position - 1] : null;
  const cells = boardCells(fen);
  const view = flipped ? [...cells].reverse() : cells;

  view.forEach((entry, i) => {
    const sq = document.createElement('div');
    sq.className = `square ${(entry.r + entry.c) % 2 === 0 ? 'light' : 'dark'}`;

    if (last && (last.from === entry.square || last.to === entry.square)) {
      sq.classList.add('last-move');
    }
    if (entry.isCheckedKing) {
      sq.classList.add('check');
    }

    // Best move hint highlights
    if (currentHint && currentHint.fen === fen) {
      if (entry.square === currentHint.from) sq.classList.add('hint-from');
      if (entry.square === currentHint.to) sq.classList.add('hint-to');
    }

    const file = flipped ? 'hgfedcba'[i % 8] : 'abcdefgh'[i % 8];
    const rank = flipped ? (1 + Math.floor(i / 8)) : (8 - Math.floor(i / 8));

    if (i % 8 === 0) {
      const axis = document.createElement('span');
      axis.className = 'rank-label';
      axis.textContent = rank;
      sq.appendChild(axis);
    }
    if (i >= 56) {
      const axis = document.createElement('span');
      axis.className = 'file-label';
      axis.textContent = file;
      sq.appendChild(axis);
    }

    // Render Chess.com style vector piece SVG (Large & Crisp - 95%)
    if (entry.piece) {
      const svgCode = getPieceSvg(entry.piece.color, entry.piece.type);
      if (svgCode) {
        const pieceWrap = document.createElement('div');
        pieceWrap.className = 'piece-svg-wrap';
        pieceWrap.innerHTML = svgCode;
        sq.appendChild(pieceWrap);
      }
    }

    // Move classification badge on the target square of the last move (Chess.com style)
    if (last && last.to === entry.square && analyses && position > 0) {
      const moveInfo = analyses.moves[position - 1];
      if (moveInfo && moveInfo.category) {
        const catMeta = LABELS.find(x => x[0] === moveInfo.category);
        if (catMeta) {
          const badge = document.createElement('div');
          badge.className = `square-badge badge-${moveInfo.category}`;
          badge.textContent = catMeta[2];
          badge.title = `${catMeta[1]}`;
          sq.appendChild(badge);
        }
      }
    }

    grid.appendChild(sq);
  });

  byId('move-counter').textContent = `${position} / ${game?.moves.length || 0}`;

  let desc = 'بداية المباراة';
  if (game && position > 0) {
    const m = game.moves[position - 1];
    desc = `${Math.floor((position - 1) / 2) + 1}${m.color === 'w' ? '.' : '...'} ${m.san}`;
    const info = analyses?.moves[position - 1];
    if (info) {
      const lbl = LABELS.find(x => x[0] === info.category);
      desc += ` · ${lbl?.[1] || ''} · دقة ${formatNum(info.accuracy)}%`;
      if (info.best && info.best !== info.uci && info.bestSan) {
        desc += ` · المحرك يفضّل ${info.bestSan} (${info.best})`;
      } else if (info.best && info.best !== info.uci) {
        desc += ` · المحرك يفضّل ${info.best}`;
      }
    }
  }
  byId('move-description').textContent = desc;

  // Update evaluation bar for current position
  const curEval = analyses?.evals?.[position]?.cpWhite ?? (currentHint?.fen === fen ? currentHint.cp : 0);
  updateEvalBar(curEval);

  // Update hint banner
  const hintBanner = byId('hint-banner');
  if (hintBanner) {
    if (currentHint && currentHint.fen === fen) {
      hintBanner.hidden = false;
      hintBanner.innerHTML = currentHint.text;
    } else {
      hintBanner.hidden = true;
      hintBanner.textContent = '';
    }
  }

  byId('first-btn').disabled = position === 0;
  byId('prev-btn').disabled = position === 0;
  byId('next-btn').disabled = !game || position === game.moves.length;
  byId('last-btn').disabled = !game || position === game.moves.length;
}

function renderMoves() {
  const root = byId('moves-list');
  root.replaceChildren();
  if (!game) {
    root.innerHTML = '<div class="empty-moves">لنبدأ بإدخال مباراتك.</div>';
    return;
  }

  for (let i = 0; i < game.moves.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const num = document.createElement('span');
    num.className = 'move-number';
    num.textContent = `${Math.floor(i / 2) + 1}.`;
    row.appendChild(num);

    for (let j = i; j < Math.min(i + 2, game.moves.length); j++) {
      const m = game.moves[j];
      const info = analyses?.moves[j];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'move-chip' + (position === j + 1 ? ' active' : '');
      btn.title = info
        ? `دقة تقديرية ${formatNum(info.accuracy)}% · فقد ${info.cpLoss} سنتيبون`
        : 'انقر لعرض هذه النقلة';

      btn.addEventListener('click', () => {
        position = j + 1;
        renderBoard();
        updateActiveMove();
        renderChart();
      });

      const label = document.createElement('span');
      label.textContent = m.san;
      btn.appendChild(label);

      if (info) {
        const lbl = LABELS.find(x => x[0] === info.category);
        if (lbl) {
          const marker = document.createElement('b');
          marker.className = 'move-mark';
          marker.style.color = lbl[3];
          marker.textContent = lbl[2];
          btn.appendChild(marker);
          btn.title = `${lbl[1]} · دقة ${formatNum(info.accuracy)}% · فقد ${info.cpLoss} سنتيبون`;
        }
      }
      row.appendChild(btn);
    }
    root.appendChild(row);
  }

  updateActiveMove();
}

// Internal-Only Scroll for Move List: NEVER Scrolls the Outer Window
function updateActiveMove() {
  const root = byId('moves-list');
  if (!root) return;
  const container = root.closest('.tab-content-container');
  const chips = root.querySelectorAll('.move-chip');

  chips.forEach((btn, idx) => {
    const isActive = position === idx + 1;
    btn.classList.toggle('active', isActive);
    if (isActive && container) {
      const btnTop = btn.offsetTop;
      const btnBottom = btnTop + btn.offsetHeight;
      const cTop = container.scrollTop;
      const cHeight = container.clientHeight;
      if (btnTop < cTop + 10) {
        container.scrollTop = Math.max(0, btnTop - 10);
      } else if (btnBottom > cTop + cHeight - 10) {
        container.scrollTop = btnBottom - cHeight + 10;
      }
    }
  });
}

function renderStats() {
  const root = byId('stats');
  if (!root) return;
  root.replaceChildren();

  for (const [cat, name, icon, color] of LABELS) {
    const line = document.createElement('div');
    line.className = 'stat-row';

    const w = document.createElement('strong');
    w.className = 'stat-count-w';
    w.textContent = analyses ? String(analyses.counts.w[cat] ?? 0) : '—';
    if (analyses && (analyses.counts.w[cat] ?? 0) > 0) w.style.color = color;

    const center = document.createElement('div');
    center.className = 'stat-badge-center';

    const badge = document.createElement('span');
    badge.className = `stat-circle-icon badge-${cat}`;
    badge.textContent = icon;
    badge.style.background = color;

    const title = document.createElement('span');
    title.className = 'stat-type-title';
    title.textContent = name;

    center.append(badge, title);

    const b = document.createElement('strong');
    b.className = 'stat-count-b';
    b.textContent = analyses ? String(analyses.counts.b[cat] ?? 0) : '—';
    if (analyses && (analyses.counts.b[cat] ?? 0) > 0) b.style.color = color;

    line.append(w, center, b);
    root.appendChild(line);
  }
}

function renderChart() {
  const wrap = byId('chart-wrap');
  if (!analyses?.evals) return;
  const values = analyses.evals.map(e => e.cpWhite);
  const width = 800, height = 60, pad = 6, mid = 30, usable = width - pad * 2;
  const x = i => pad + usable * i / Math.max(1, values.length - 1);
  const y = cp => mid - 24 * Math.tanh(cp / 320);
  const points = values.map((v, i) => [x(i), y(v)]);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const area = `${path}L ${x(values.length - 1)},${mid} L ${x(0)},${mid}Z`;
  const cx = x(position), cy = y(values[position]);

  const curVal = values[position];
  let bubbleText = '0.00';
  if (curVal !== undefined) {
    if (Math.abs(curVal) >= 9000) {
      bubbleText = curVal > 0 ? 'M' : '-M';
    } else {
      bubbleText = (curVal >= 0 ? '+' : '') + (curVal / 100).toFixed(2);
    }
  }
  const bubbleX = clamp(cx, 28, width - 28);
  const bubbleY = clamp(cy - 12, 12, height - 12);

  const maxDots = 55;
  const step = Math.max(1, Math.ceil(analyses.moves.length / maxDots));
  const markers = analyses.moves.map((m, i) => {
    if (i % step && i !== position - 1) return '';
    const meta = LABELS.find(l => l[0] === m.category);
    return `<circle cx="${x(i + 1)}" cy="${y(values[i + 1])}" r="${position === i + 1 ? 5 : 2.6}" fill="${meta?.[3] || '#9daaa0'}" stroke="#f3f4f2" stroke-width="0.8"><title>${i + 1} · ${m.san}: ${meta?.[1] || ''}</title></circle>`;
  }).join('');

  wrap.innerHTML = `<svg class="eval-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="منحنى تقييم المباراة، انقر على نقطة للانتقال إليها">
    <defs>
      <linearGradient id="eval-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#a8b1aa" stop-opacity=".92"/>
        <stop offset="100%" stop-color="#747e79" stop-opacity=".65"/>
      </linearGradient>
    </defs>
    <line x1="0" y1="${mid}" x2="${width}" y2="${mid}" stroke="#9ea6a0" stroke-width="1.2"/>
    <path d="${area}" fill="url(#eval-fill)"/>
    <path d="${path}" fill="none" stroke="#46544d" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
    ${markers}
    <line x1="${cx}" y1="0" x2="${cx}" y2="${height}" stroke="#397153" stroke-width="1.6" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    <circle cx="${cx}" cy="${cy}" r="4.5" fill="#437c5a" stroke="#fff" stroke-width="1.5"/>
    <g transform="translate(${bubbleX.toFixed(1)}, ${bubbleY.toFixed(1)})" pointer-events="none">
      <rect x="-22" y="-12" width="44" height="15" rx="3.5" fill="#182026" stroke="#485966" stroke-width="0.9"/>
      <polygon points="-3,3 3,3 0,6" fill="#182026"/>
      <text x="0" y="-1.5" fill="#f0f6fc" font-size="9" font-weight="800" font-family="system-ui, -apple-system, sans-serif" text-anchor="middle">${bubbleText}</text>
    </g>
  </svg>`;

  const svg = wrap.querySelector('svg');
  const jumpToClientX = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    position = Math.round(ratio * (values.length - 1));
    renderBoard();
    updateActiveMove();
    renderChart();
  };

  svg.addEventListener('click', ev => jumpToClientX(ev.clientX));

  let dragging = false;
  svg.addEventListener('pointerdown', ev => {
    dragging = true;
    svg.setPointerCapture(ev.pointerId);
    jumpToClientX(ev.clientX);
  });
  svg.addEventListener('pointermove', ev => {
    if (dragging) jumpToClientX(ev.clientX);
  });
  svg.addEventListener('pointerup', ev => {
    dragging = false;
    try { svg.releasePointerCapture(ev.pointerId); } catch {}
  });
  svg.addEventListener('pointercancel', () => { dragging = false; });
}

function renderAll() {
  renderBoard();
  renderMoves();
  renderStats();
  renderChart();
}

function parseUciEval(line, fen) {
  const match = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  if (!match || /\b(?:lowerbound|upperbound)\b/.test(line)) return null;
  let cp;
  if (match[1] === 'cp') {
    cp = Number(match[2]);
  } else {
    const distance = Number(match[2]);
    cp = distance === 0 ? -10000 : Math.sign(distance) * (10000 - Math.min(100, Math.abs(distance)) * 50);
  }
  const turn = fen.split(' ')[1];
  return (turn === 'w' ? 1 : -1) * cp;
}

function parseUciEvalFallback(line, fen) {
  const match = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  if (!match) return null;
  let cp;
  if (match[1] === 'cp') {
    cp = Number(match[2]);
  } else {
    const distance = Number(match[2]);
    cp = distance === 0 ? -10000 : Math.sign(distance) * (10000 - Math.min(100, Math.abs(distance)) * 50);
  }
  const turn = fen.split(' ')[1];
  return (turn === 'w' ? 1 : -1) * cp;
}

function waitForEngine(target, command, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('لم يستجب محرك Stockfish. تأكد أن ملفات المحرك موجودة على الخادم وتم تشغيل خادم محلي.'));
    }, timeoutMs);

    const listener = e => {
      for (const line of String(e.data || '').split(/\r?\n/)) {
        if (target(line)) {
          cleanup();
          resolve(line);
          return;
        }
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      worker?.removeEventListener('message', listener);
    };

    worker.addEventListener('message', listener);
    worker.postMessage(command);
  });
}

async function ensureEngine() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const workerUrl = new URL('./engine/stockfish-19-lite-single.js', window.location.href);
    const wasmUrl = new URL('./engine/stockfish-19-lite-single.wasm', window.location.href);
    worker = new Worker(`${workerUrl.href}#${encodeURIComponent(wasmUrl.href)}`);

    let engineFailed = false;
    worker.onerror = (err) => {
      engineFailed = true;
      console.error('Stockfish Worker Error:', err);
      status('فشل تحميل المحرك أو ملف WebAssembly. شغّل خادم التطوير عبر npm run dev.', 'error');
    };

    await waitForEngine(s => s.includes('uciok'), 'uci', 45000);
    if (engineFailed) throw new Error('فشل محرك Stockfish أثناء التهيئة.');
    await waitForEngine(s => s.includes('readyok'), 'isready', 15000);
    worker.postMessage('setoption name Hash value 16');
    worker.postMessage('ucinewgame');
  })();

  try {
    await readyPromise;
  } catch (err) {
    worker?.terminate();
    worker = null;
    readyPromise = null;
    throw err;
  }
}

function analyzePosition(fen, depth) {
  const board = new Chess(fen);
  if (board.isCheckmate()) {
    return Promise.resolve({
      cpWhite: board.turn() === 'w' ? -10000 : 10000,
      best: '(none)',
      bestSan: null,
      depth
    });
  }
  if (board.isDraw()) {
    return Promise.resolve({
      cpWhite: 0,
      best: '(none)',
      bestSan: null,
      depth
    });
  }

  return new Promise((resolve, reject) => {
    let cp = null;
    let fallbackCp = null;
    let best = null;
    let receivedDepth = 0;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('انتهى وقت التحليل لهذه الوضعية.'));
    }, 60000);

    const cleanup = () => {
      clearTimeout(timeout);
      worker?.removeEventListener('message', listener);
    };

    const listener = e => {
      for (const line of String(e.data || '').split(/\r?\n/)) {
        if (line.startsWith('info ') && /\bscore\b/.test(line) && !/\bmultipv\s+([2-9]|\d{2,})\b/.test(line)) {
          const score = parseUciEval(line, fen);
          if (score !== null) {
            cp = score;
            receivedDepth = Number(line.match(/\bdepth\s+(\d+)/)?.[1] || 0);
          } else {
            const fallback = parseUciEvalFallback(line, fen);
            if (fallback !== null) fallbackCp = fallback;
          }
        }
        if (line.startsWith('bestmove ')) {
          best = line.split(/\s+/)[1];
          cleanup();
          const finalCp = cp !== null ? cp : (fallbackCp !== null ? fallbackCp : 0);
          const bestSan = uciToSan(fen, best);
          resolve({ cpWhite: finalCp, best: best || '(none)', bestSan, depth: receivedDepth || depth });
          return;
        }
      }
    };

    worker.addEventListener('message', listener);
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${depth}`);
  });
}

// Interactive Best Move Calculation for Current Position
async function showBestMoveHint() {
  if (!game) return;
  const fen = game.fens[position];
  const board = new Chess(fen);
  if (board.isGameOver()) {
    status('المباراة منتهية في هذه الوضعية.', 'info');
    return;
  }

  const turnName = board.turn() === 'w' ? 'الأبيض' : 'الأسود';
  const hintBanner = byId('hint-banner');
  if (hintBanner) {
    hintBanner.hidden = false;
    hintBanner.textContent = `💡 جارٍ حساب أفضل نقلة لـ ${turnName} عبر Stockfish 19…`;
  }

  try {
    await ensureEngine();
    const depth = Number(byId('depth-select').value) || 12;
    const res = await analyzePosition(fen, depth);

    if (res.best && res.best !== '(none)') {
      const from = res.best.slice(0, 2);
      const to = res.best.slice(2, 4);
      const san = res.bestSan || res.best;
      const evalText = res.cpWhite !== null
        ? (res.cpWhite > 0 ? `+${(res.cpWhite / 100).toFixed(1)}` : `${(res.cpWhite / 100).toFixed(1)}`)
        : '';

      currentHint = {
        fen,
        uci: res.best,
        from,
        to,
        san,
        cp: res.cpWhite,
        text: `💡 أفضل نقلة لـ ${turnName}: <strong>${san}</strong> (${from} → ${to}) ${evalText ? `· التقييم: ${evalText}` : ''}`
      };

      updateEvalBar(res.cpWhite);
      renderBoard();
      status(`أفضل نقلة لـ ${turnName}: ${san} (${from} إلى ${to})`, 'success');
    } else {
      if (hintBanner) hintBanner.textContent = 'لا توجد نقلات قانونية متاحة.';
    }
  } catch (err) {
    if (hintBanner) hintBanner.textContent = 'تعذر حساب أفضل نقلة: ' + err.message;
  }
}

function winChance(cp) {
  return 100 / (1 + Math.exp(-0.00368208 * clamp(cp, -10000, 10000)));
}

function moveAccuracy(before, after, mover) {
  const drop = Math.max(0, winChance(before * mover) - winChance(after * mover));
  return clamp(103.1668 * Math.exp(-0.04354 * drop) - 3.1669, 0, 100);
}

const COMMON_BOOK_MOVES = new Set([
  'e2e4', 'e7e5', 'd2d4', 'd7d5', 'c2c4', 'c7c5', 'g1f3', 'b8c6',
  'g8f6', 'c7c6', 'e7e6', 'g2g3', 'g7g6', 'b1c3', 'f1g2', 'f8g7',
  'e1g1', 'e8g8', 'd2d3', 'd7d6', 'f2f4', 'f7f5', 'b2b3', 'b7b6',
  'c1b2', 'c8b7', 'f1e1', 'f8e8', 'a2a3', 'a7a5', 'd1c2', 'd8c7'
]);

function assignCategory(cpLoss, isEngineTopMove, mover, before, after, moveIndex, uci, san) {
  // 1. Opening Book
  if (moveIndex < 8 && cpLoss <= 30 && COMMON_BOOK_MOVES.has(uci)) {
    return 'book';
  }

  // 2. Brilliant: Piece sacrifice or winning combination with great outcome
  if (isEngineTopMove && cpLoss <= 0 && mover * after > 160 && (san.includes('x') || san.includes('+')) && moveIndex > 5) {
    return 'brilliant';
  }

  // 3. Great: Critical saving or breakthrough move in difficult/sharp position
  if (isEngineTopMove && cpLoss <= 8 && Math.abs(after) > 180 && moveIndex > 4) {
    return 'great';
  }

  // 4. Best Move
  if (isEngineTopMove || cpLoss <= 12) return 'best';

  // 5. Excellent Move
  if (cpLoss <= 28) return 'excellent';

  // 6. Good Move
  if (cpLoss <= 65) return 'good';

  // 7. Inaccuracy
  if (cpLoss <= 130) return 'inaccuracy';

  // 8. Mistake
  if (cpLoss <= 250) return 'mistake';

  // 9. Miss: Blew away a winning advantage (was > +1.8, dropped to drawn or losing)
  if (mover * before >= 180 && mover * after < 60) {
    return 'miss';
  }

  // 10. Blunder
  return 'blunder';
}

function aggregateAccuracy(moves, evals, color) {
  const own = moves.filter(m => m.color === color);
  if (!own.length) return null;
  const accs = own.map(m => m.accuracy);
  const harmonic = own.length / accs.reduce((sum, x) => sum + 1 / Math.max(1, x), 0);
  const windowSize = clamp(Math.round(moves.length / 10), 2, 8);
  const volatility = own.map(m => {
    const around = evals.slice(Math.max(0, m.index - windowSize + 1), Math.min(evals.length, m.index + windowSize + 1)).map(e => winChance(e.cpWhite));
    const avg = around.reduce((a, b) => a + b, 0) / around.length;
    return clamp(Math.sqrt(around.reduce((a, b) => a + (b - avg) ** 2, 0) / around.length), 0.5, 12);
  });
  const weights = volatility.reduce((a, b) => a + b, 0);
  const weighted = accs.reduce((sum, a, i) => sum + a * volatility[i], 0) / weights;
  return clamp((harmonic + weighted) / 2, 0, 100);
}

function buildResult(evals) {
  const counts = {
    w: Object.fromEntries(LABELS.map(([k]) => [k, 0])),
    b: Object.fromEntries(LABELS.map(([k]) => [k, 0]))
  };

  const moves = game.moves.map((m, i) => {
    const mover = m.color === 'w' ? 1 : -1;
    const before = evals[i].cpWhite;
    const after = evals[i + 1].cpWhite;
    const cpLoss = Math.round(Math.max(0, mover * (before - after)));
    const uci = m.from + m.to + (m.promotion || '');
    const isTopMove = evals[i].best === uci;
    const category = assignCategory(cpLoss, isTopMove, mover, before, after, i, uci, m.san);
    counts[m.color][category]++;
    return {
      index: i,
      color: m.color,
      san: m.san,
      uci,
      category,
      cpLoss,
      accuracy: moveAccuracy(before, after, mover),
      best: evals[i].best,
      bestSan: evals[i].bestSan
    };
  });

  return {
    moves,
    evals,
    counts,
    white: aggregateAccuracy(moves, evals, 'w'),
    black: aggregateAccuracy(moves, evals, 'b')
  };
}

function displayResults() {
  for (const [word, code] of [['white', 'white'], ['black', 'black']]) {
    const score = analyses?.[word];
    byId(`${code}-accuracy`).innerHTML = `${formatNum(score)}<small>%</small>`;
    byId(`${code}-mini-score`).textContent = `${formatNum(score)}%`;
    byId(`${code}-accuracy-sub`).textContent = `${game.moves.filter(m => m.color === (code === 'white' ? 'w' : 'b')).length} نقلة محلّلة`;
    byId(`${code}-meter`).style.width = Number.isFinite(score) ? `${score}%` : '0%';
  }

  const diff = (analyses.white ?? 0) - (analyses.black ?? 0);
  const winner = diff > 0 ? (game.headers.White || 'الأبيض') : (game.headers.Black || 'الأسود');
  const lead = Math.abs(diff);
  const alertCount = (analyses.counts.w.blunder || 0) + (analyses.counts.b.blunder || 0) +
                     (analyses.counts.w.mistake || 0) + (analyses.counts.b.mistake || 0);

  byId('coach-bubble').textContent = lead < 2
    ? 'مباراة متقاربة جداً في الدقة! تصفّح النقلات الملوّنة لتعرف أين تحولت الأفضلية في اللحظات الحاسمة.'
    : `كانت دقة ${winner} أعلى بفارق ${lead.toFixed(1)} نقطة مئوية. ${alertCount ? `وجدنا ${alertCount} خطأ أو هفوة تستحق المراجعة.` : 'لم تظهر أخطاء أو هفوات فادحة.'} انقر على أي نقلة لمعرفة التفاصيل.`;

  renderAll();
}

function setAnalyzing(active) {
  byId('analyze-btn').hidden = active;
  byId('cancel-btn').hidden = !active;
  byId('load-btn').disabled = active;
  byId('demo-btn').disabled = active;
  byId('pgn-file').disabled = active;
  byId('progress-wrap').hidden = !active;
}

function updateProgress(done, total) {
  const pct = Math.round(done / total * 100);
  byId('progress-text').textContent = `تحليل الوضعية ${done} من ${total}`;
  byId('progress-value').textContent = `${pct}%`;
  byId('progress-bar').style.width = `${pct}%`;
}

async function startAnalysis() {
  const text = byId('pgn-text').value.trim();
  if (!text) {
    status('أدخل نص PGN صحيحاً أولاً.', 'error');
    openModal();
    return;
  }

  if (!game || text !== currentPgn) {
    try {
      loadGame(text);
    } catch (err) {
      status('PGN غير صحيح: ' + err.message, 'error');
      openModal();
      return;
    }
  }

  const gameSnapshot = game;
  const id = ++runId;
  abortRequested = false;
  const depth = Number(byId('depth-select').value);

  setAnalyzing(true);
  updateProgress(0, gameSnapshot.fens.length);
  status('يتم الآن تجهيز محرك Stockfish 19 داخل المتصفح…');

  try {
    await ensureEngine();
    if (abortRequested || id !== runId) return;

    worker.postMessage('ucinewgame');
    const evals = [];

    for (let i = 0; i < gameSnapshot.fens.length; i++) {
      if (abortRequested || id !== runId) break;
      const turnName = gameSnapshot.fens[i].split(' ')[1] === 'w' ? 'الأبيض' : 'الأسود';
      const moveNum = Math.floor(i / 2) + 1;
      status(`جارٍ تحليل نقلة ${moveNum} (${turnName}) · الوضعية ${i + 1} من ${gameSnapshot.fens.length} (العمق ${depth})…`);
      evals.push(await analyzePosition(gameSnapshot.fens[i], depth));
      updateProgress(i + 1, gameSnapshot.fens.length);
      await pause(0);
    }

    if (abortRequested || id !== runId) {
      status('تم إيقاف التحليل. يمكنك إعادة المحاولة في أي وقت.', 'warning');
      return;
    }

    analyses = buildResult(evals);
    displayResults();
    status(`اكتمل تحليل ${gameSnapshot.moves.length} نصف نقلة بنجاح عند عمق ${depth}.`, 'success');
  } catch (err) {
    status(err.message || 'حدث خطأ أثناء التحليل.', 'error');
    console.error(err);
  } finally {
    if (id === runId) setAnalyzing(false);
  }
}

function cancelAnalysis() {
  abortRequested = true;
  worker?.postMessage('stop');
  setAnalyzing(false);
  status('تم إيقاف التحليل.', 'warning');
}

// Modal handling
const modal = byId('pgn-modal');
function openModal() {
  if (typeof modal.showModal === 'function') {
    modal.showModal();
  } else {
    modal.setAttribute('open', '');
  }
}

function closeModal() {
  if (typeof modal.close === 'function') {
    modal.close();
  } else {
    modal.removeAttribute('open');
  }
}

byId('open-pgn-btn').addEventListener('click', openModal);
byId('close-pgn-btn').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

// Tab Switcher Handling
const tabMovesBtn = byId('tab-moves-btn');
const tabReviewBtn = byId('tab-review-btn');
const paneMoves = byId('pane-moves');
const paneReview = byId('pane-review');

function setTab(tab) {
  if (tab === 'moves') {
    tabMovesBtn.classList.add('active');
    tabMovesBtn.setAttribute('aria-selected', 'true');
    tabReviewBtn.classList.remove('active');
    tabReviewBtn.setAttribute('aria-selected', 'false');
    paneMoves.removeAttribute('hidden');
    paneReview.setAttribute('hidden', '');
    updateActiveMove();
  } else {
    tabReviewBtn.classList.add('active');
    tabReviewBtn.setAttribute('aria-selected', 'true');
    tabMovesBtn.classList.remove('active');
    tabMovesBtn.setAttribute('aria-selected', 'false');
    paneReview.removeAttribute('hidden');
    paneMoves.setAttribute('hidden', '');
  }
}

tabMovesBtn.addEventListener('click', () => setTab('moves'));
tabReviewBtn.addEventListener('click', () => setTab('review'));

// Demo Button
byId('demo-btn').addEventListener('click', () => {
  byId('pgn-text').value = DEMO;
  try {
    loadGame(DEMO);
    closeModal();
  } catch (err) {
    status(err.message, 'error');
  }
});

// Load Button
byId('load-btn').addEventListener('click', () => {
  const text = byId('pgn-text').value.trim();
  if (!text) {
    status('الرجاء إدخال نص PGN.', 'error');
    return;
  }
  try {
    loadGame(text);
    closeModal();
  } catch (err) {
    status('PGN غير صحيح: ' + err.message, 'error');
  }
});

// File Inputs
function handleFileInput(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    status('الملف كبير جداً. الحد الأقصى 2MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const content = reader.result;
    byId('pgn-text').value = content;
    try {
      loadGame(content);
      closeModal();
    } catch (err) {
      status('PGN غير صحيح: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

byId('pgn-file').addEventListener('change', handleFileInput);
byId('pgn-modal-file').addEventListener('change', handleFileInput);

// Action buttons
byId('analyze-btn').addEventListener('click', startAnalysis);
byId('cancel-btn').addEventListener('click', cancelAnalysis);
byId('hint-btn').addEventListener('click', showBestMoveHint);

byId('first-btn').addEventListener('click', () => {
  position = 0;
  currentHint = null;
  renderBoard();
  updateActiveMove();
  renderChart();
});

byId('prev-btn').addEventListener('click', () => {
  position = Math.max(0, position - 1);
  currentHint = null;
  renderBoard();
  updateActiveMove();
  renderChart();
});

byId('next-btn').addEventListener('click', () => {
  position = Math.min(game?.moves.length || 0, position + 1);
  currentHint = null;
  renderBoard();
  updateActiveMove();
  renderChart();
});

byId('last-btn').addEventListener('click', () => {
  position = game?.moves.length || 0;
  currentHint = null;
  renderBoard();
  updateActiveMove();
  renderChart();
});

byId('flip-btn').addEventListener('click', () => {
  flipped = !flipped;
  renderBoard();
});

// Keyboard Navigation - Intercepts Arrow Keys to Prevent Window Scroll
window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (!game) return;

  const navKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', ' '];
  if (navKeys.includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
  }

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    position = Math.min(game.moves.length, position + 1);
    currentHint = null;
    renderBoard();
    updateActiveMove();
    renderChart();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    position = Math.max(0, position - 1);
    currentHint = null;
    renderBoard();
    updateActiveMove();
    renderChart();
  } else if (e.key === 'Home') {
    position = 0;
    currentHint = null;
    renderBoard();
    updateActiveMove();
    renderChart();
  } else if (e.key === 'End') {
    position = game.moves.length;
    currentHint = null;
    renderBoard();
    updateActiveMove();
    renderChart();
  }
}, { passive: false });

// Startup initialization
byId('pgn-text').value = DEMO;
loadGame(DEMO);
