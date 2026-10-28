import { Chess } from 'chess.js';
import { getPieceSvg } from './pieces.js';
import './style.css';
import { winChance, toUci, classifyMove, parseEngineLine } from './review.js';

const START_FEN = new Chess().fen();
const DEMO = `[Event "Chess Insight Demo"]
[Site "Local analysis"]
[Date "2026.10.28"]
[White "White Player"]
[Black "Black Player"]
[Result "1-0"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# 1-0`;

const LABELS = [
  ['brilliant', 'عبقرية', '!!', '#21bcc7'],
  ['great', 'رائعة', '!', '#5b8bb0'],
  ['book', 'افتتاحية', '📖', '#d5a47e'],
  ['best', 'الأفضل', '★', '#81b64c'],
  ['excellent', 'ممتازة', '👍', '#96bc76'],
  ['good', 'جيدة', '✓', '#86b59b'],
  ['inaccuracy', 'عدم دقة', '?!', '#f7c631'],
  ['mistake', 'خطأ', '?', '#ffa459'],
  ['miss', 'إضاعة فرصة', '✖', '#fa7069'],
  ['blunder', 'هفوة فادحة', '??', '#fa412d'],
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
let analysisRunning = false;
let hintRunning = false;
let searchRunning = false;
let currentHint = null; // { fen, uci, from, to, san, cpText }
let lastRenderedPosition = 0;
let audioContext = null;
let lastSoundTime = -Infinity;
const moveSoundBuffers = new Map();
let soundEnabled = true;
try { soundEnabled = localStorage.getItem('chess-insight-sound') !== 'off'; } catch {}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
// A full move consists of White's move and Black's reply. Keep ply indices
// internally so review navigation still visits each player's individual move.
const fullMoveCount = plies => Math.ceil(plies / 2);
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
  if (moves.length > 500) throw new Error('هذه النسخة تدعم حتى 250 نقلة كاملة في المباراة الواحدة.');
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
  if (analysisRunning) cancelAnalysis();
  game = computeGames(pgn);
  currentPgn = pgn.trim();
  runId++;
  position = 0;
  lastRenderedPosition = 0;
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
  byId('input-hint').textContent = `تم تحميل المباراة بنجاح · عدد النقلات: ${fullMoveCount(game.moves.length)}.`;
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

function drawMoveArrow(grid, from, to) {
  const center = square => {
    const file = 'abcdefgh'.indexOf(square[0]);
    const rank = Number(square[1]);
    const x = flipped ? 7 - file : file;
    const y = flipped ? rank - 1 : 8 - rank;
    return { x: (x + 0.5) * 12.5, y: (y + 0.5) * 12.5 };
  };
  const start = center(from), end = center(to);
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const ux = dx / length, uy = dy / length;
  const tip = { x: end.x - ux * 1.2, y: end.y - uy * 1.2 };
  const base = { x: tip.x - ux * 4.2, y: tip.y - uy * 4.2 };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('best-move-arrow');
  const line = document.createElementNS(svg.namespaceURI, 'line');
  line.setAttribute('x1', start.x); line.setAttribute('y1', start.y);
  line.setAttribute('x2', base.x); line.setAttribute('y2', base.y);
  const head = document.createElementNS(svg.namespaceURI, 'polygon');
  head.setAttribute('points', `${tip.x},${tip.y} ${base.x - uy * 2.8},${base.y + ux * 2.8} ${base.x + uy * 2.8},${base.y - ux * 2.8}`);
  svg.append(line, head);
  grid.appendChild(svg);
}

function updateSoundControl() {
  const button = byId('sound-toggle');
  button.textContent = soundEnabled ? '🔊' : '🔇';
  button.title = soundEnabled ? 'إيقاف صوت النقلات' : 'تشغيل صوت النقلات';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(soundEnabled));
}

// Original dry wooden-piece sounds, synthesized once and cached locally.
function createMoveSoundBuffer(context, capture = false) {
  const duration = capture ? 0.15 : 0.11;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = capture ? 9277 : 6173;
  let smoothNoise = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / context.sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = (seed >>> 0) / 2147483648 - 1;
    smoothNoise += 0.3 * (noise - smoothNoise);
    const attack = Math.min(1, t / 0.0007);
    const click = (noise - smoothNoise) * Math.exp(-t * 650) * 0.7;
    const wood = smoothNoise * Math.exp(-t * 95) * 0.8;
    const body = (Math.sin(2 * Math.PI * 740 * t) * 0.18
      + Math.sin(2 * Math.PI * 1260 * t) * 0.13
      + Math.sin(2 * Math.PI * 2130 * t) * 0.08) * Math.exp(-t * 115);
    // A quieter second contact gives captures a slightly heavier clack.
    const secondTap = capture && t > 0.025
      ? smoothNoise * Math.exp(-(t - 0.025) * 160) * 0.32 : 0;
    samples[i] = Math.tanh((click + wood + body + secondTap) * 1.5) * attack;
  }
  return buffer;
}

function playMoveSound(capture = false) {
  if (!soundEnabled) return;
  try {
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) return;
    audioContext ||= new AudioEngine();
    const now = audioContext.currentTime;
    if (now - lastSoundTime < 0.075) return;
    lastSoundTime = now;
    const play = () => {
      if (!soundEnabled || audioContext.state !== 'running') return;
      const key = capture ? 'capture' : 'move';
      if (!moveSoundBuffers.has(key)) moveSoundBuffers.set(key, createMoveSoundBuffer(audioContext, capture));
      const source = audioContext.createBufferSource();
      const volume = audioContext.createGain();
      source.buffer = moveSoundBuffers.get(key);
      volume.gain.value = 0.7;
      source.connect(volume).connect(audioContext.destination);
      source.onended = () => { source.disconnect(); volume.disconnect(); };
      source.start();
    };
    if (audioContext.state === 'suspended') audioContext.resume().then(play).catch(() => {});
    else play();
  } catch {} // Audio availability must never block board navigation.
}

function renderBoard() {
  if (position !== lastRenderedPosition) {
    const soundedMove = game?.moves[Math.max(position, lastRenderedPosition) - 1];
    playMoveSound(Boolean(soundedMove?.captured));
    lastRenderedPosition = position;
  }
  const grid = byId('board');
  grid.replaceChildren();
  const currentFen = game ? game.fens[position] : START_FEN;
  const info = position > 0 ? analyses?.moves[position - 1] : null;
  const alternative = info?.best && info.best !== info.uci && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(info.best) ? info.best : null;
  const hint = currentHint?.fen === currentFen ? currentHint : null;
  const fen = currentFen;
  const last = game && position > 0 ? game.moves[position - 1] : null;
  // Keep the played position visible. The arrow shows the alternative's original
  // source and destination without moving a piece or rewinding the board.
  const arrow = hint || (alternative ? { from: alternative.slice(0, 2), to: alternative.slice(2, 4) } : null);
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
    if (arrow) {
      if (entry.square === arrow.from) sq.classList.add('hint-from');
      if (entry.square === arrow.to) sq.classList.add('hint-to');
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

  if (arrow) drawMoveArrow(grid, arrow.from, arrow.to);
  byId('move-counter').textContent = `${fullMoveCount(position)} / ${fullMoveCount(game?.moves.length || 0)}`;

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
  const curEval = analyses?.evals?.[position]?.cpWhite ?? (hint ? hint.cp : 0);
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
        ? `دقة تقديرية ${formatNum(info.accuracy)}% · انخفاض فرص الفوز ${formatNum(info.winLoss)} نقطة مئوية`
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
          btn.title = `${lbl[1]} · دقة ${formatNum(info.accuracy)}% · انخفاض فرص الفوز ${formatNum(info.winLoss)} نقطة مئوية`;
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
  if (!analyses?.evals?.length) return;
  const values = analyses.evals.map(e => e.cpWhite);
  const width = Math.max(200, Math.round(wrap.clientWidth));
  const height = 74, pad = 5, mid = height / 2;
  const usable = width - pad * 2;
  const x = i => pad + usable * i / Math.max(1, values.length - 1);
  const y = cp => mid - (mid - pad) * Math.tanh(cp / 320);
  const points = values.map((value, i) => `${x(i).toFixed(2)},${y(value).toFixed(2)}`);
  const boundary = points.map((point, i) => `${i ? 'L' : 'M'}${point}`).join(' ');
  // White's share fills down to the bottom, with Black's share above it.
  const area = `${boundary} L${width},${y(values.at(-1)).toFixed(2)} L${width},${height} L0,${height} L0,${y(values[0]).toFixed(2)}Z`;
  const step = Math.max(1, Math.ceil(analyses.moves.length / 75));
  const markers = analyses.moves.map((move, i) => {
    const important = ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(move.category);
    if (i % step && i !== position - 1 && !important) return '';
    const meta = LABELS.find(label => label[0] === move.category);
    return `<circle cx="${x(i + 1)}" cy="${y(values[i + 1])}" r="3.5" fill="${meta?.[3] || '#99968f'}"><title>${Math.floor(i / 2) + 1}${move.color === 'w' ? '.' : '...'} ${move.san}: ${meta?.[1] || ''}</title></circle>`;
  }).join('');

  // Keep this SVG mounted while dragging so pointer capture remains intact.
  let svg = wrap.querySelector('.eval-chart');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('eval-chart');
    wrap.replaceChildren(svg);
  }
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', `منحنى تقييم المباراة: الأبيض أسفل المنحنى والأسود أعلاه. النقلة ${fullMoveCount(position)} من ${fullMoveCount(values.length - 1)}. انقر أو اسحب أو استخدم مفاتيح الأسهم للتنقل.`);
  svg.innerHTML = `
    <path d="${area}" fill="#fff"/>
    <line x1="0" y1="${mid}" x2="${width}" y2="${mid}" stroke="#ffffff" stroke-opacity=".19" stroke-width="1.4"/>
    ${markers}
    <line x1="${x(position)}" y1="0" x2="${x(position)}" y2="${height}" stroke="#c7c4bd" stroke-width="1" stroke-opacity=".42"/>
    <g class="chart-tooltip" visibility="hidden" pointer-events="none">
      <rect x="-25" y="-19" width="50" height="18" rx="3" fill="#242320"/>
      <text x="0" y="-6" text-anchor="middle" fill="#fff" font-size="11" font-family="system-ui" font-weight="700"></text>
    </g>`;

  const indexAt = clientX => {
    const rect = svg.getBoundingClientRect();
    const plotX = (clientX - rect.left) * width / rect.width;
    return Math.round(clamp((plotX - pad) / usable, 0, 1) * (values.length - 1));
  };
  const jumpTo = index => {
    if (position === index) return;
    position = index;
    currentHint = null;
    renderBoard();
    updateActiveMove();
    renderChart();
  };
  const showTooltip = index => {
    const value = values[index];
    const text = Math.abs(value) >= 9000 ? (value > 0 ? 'M' : '−M')
      : `${value >= 0 ? '+' : ''}${(value / 100).toFixed(1)}`;
    const tooltip = svg.querySelector('.chart-tooltip');
    tooltip.setAttribute('transform', `translate(${clamp(x(index), 27, width - 27)},${clamp(y(value), 22, height - 3)})`);
    tooltip.setAttribute('visibility', 'visible');
    tooltip.querySelector('text').textContent = text;
  };
  svg.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    svg.focus({ preventScroll: true });
    svg.setPointerCapture(event.pointerId);
    jumpTo(indexAt(event.clientX));
  };
  svg.onpointermove = event => {
    const index = indexAt(event.clientX);
    if (svg.hasPointerCapture(event.pointerId)) jumpTo(index);
    showTooltip(index);
  };
  svg.onpointerup = event => {
    if (svg.hasPointerCapture(event.pointerId)) {
      jumpTo(indexAt(event.clientX));
      svg.releasePointerCapture(event.pointerId);
    }
  };
  svg.onpointercancel = event => {
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };
  svg.onpointerleave = () => svg.querySelector('.chart-tooltip').setAttribute('visibility', 'hidden');
  svg.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1
      : clamp(position + (event.key === 'ArrowRight' ? 1 : -1), 0, values.length - 1);
    jumpTo(next);
    showTooltip(next);
  };
}

function renderAll() {
  renderBoard();
  renderMoves();
  renderStats();
  renderChart();
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

function analyzePosition(fen, depth, { multiPv = 1, searchMove = null, positionCommand = null } = {}) {
  if (searchRunning) return Promise.reject(new Error('المحرك مشغول بتحليل آخر.'));
  const board = new Chess(fen);
  if (board.isCheckmate() || board.isDraw()) {
    return Promise.resolve({ cpWhite: board.isCheckmate() ? (board.turn() === 'w' ? -10000 : 10000) : 0,
      best: '(none)', bestSan: null, depth, lines: [] });
  }
  searchRunning = true;
  return new Promise((resolve, reject) => {
    const lines = new Map();
    const cleanup = () => {
      clearTimeout(timeout);
      worker?.removeEventListener('message', listener);
      searchRunning = false;
    };
    const timeout = setTimeout(() => {
      cleanup();
      // A terminated search cannot leak a late bestmove into the next search.
      worker?.terminate(); worker = null; readyPromise = null;
      reject(new Error('انتهى وقت التحليل. جرّب العمق السريع أو مباراة أقصر.'));
    }, 120000);
    const listener = event => {
      for (const line of String(event.data || '').split(/\r?\n/)) {
        const parsed = parseEngineLine(line, fen);
        if (parsed) {
          const old = lines.get(parsed.multiPv);
          if (!old || parsed.depth >= old.depth) lines.set(parsed.multiPv, parsed);
        }
        if (line.startsWith('bestmove ')) {
          const best = line.split(/\s+/)[1];
          const primary = [...lines.values()].find(item => item.best === best);
          cleanup();
          if (!primary || !Number.isFinite(primary.cpWhite)) {
            reject(new Error('لم يعُد المحرك بتقييم موثوق لهذه الوضعية. أعد التحليل.'));
            return;
          }
          const complete = [...lines.values()].filter(item => item.depth === primary.depth);
          resolve({ ...primary, best, bestSan: uciToSan(fen, best), lines: complete });
          return;
        }
      }
    };
    worker.addEventListener('message', listener);
    worker.postMessage(`setoption name MultiPV value ${multiPv}`);
    worker.postMessage(positionCommand || `position fen ${fen}`);
    worker.postMessage(`go depth ${depth}${searchMove ? ` searchmoves ${searchMove}` : ''}`);
  });
}

// Interactive Best Move Calculation for Current Position
async function showBestMoveHint() {
  if (!game || analysisRunning || hintRunning) return;
  currentHint = null;
  renderBoard();
  const fen = game.fens[position];
  const board = new Chess(fen);
  if (board.isGameOver()) {
    status('المباراة منتهية في هذه الوضعية.', 'info');
    return;
  }

  hintRunning = true;
  byId('hint-btn').disabled = true;
  byId('analyze-btn').disabled = true;
  const turnName = board.turn() === 'w' ? 'الأبيض' : 'الأسود';
  const hintBanner = byId('hint-banner');
  if (hintBanner) {
    hintBanner.hidden = false;
    hintBanner.textContent = `💡 جارٍ حساب أفضل نقلة لـ ${turnName} عبر Stockfish 19…`;
  }

  try {
    await ensureEngine();
    const depth = Number(byId('depth-select').value) || 16;
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
  } finally {
    hintRunning = false;
    byId('hint-btn').disabled = false;
    byId('analyze-btn').disabled = false;
  }
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

function buildResult(evals, playedScores) {
  const counts = {
    w: Object.fromEntries(LABELS.map(([k]) => [k, 0])),
    b: Object.fromEntries(LABELS.map(([k]) => [k, 0]))
  };

  const moves = game.moves.map((m, i) => {
    const uci = toUci(m);
    const best = evals[i];
    const second = best.lines.find(line => line.best !== best.best) || null;
    const classification = classifyMove({ move: m, best, played: playedScores[i], second, previous: i ? evals[i - 1] : null });
    const { category, cpLoss } = classification;
    counts[m.color][category]++;
    return {
      index: i,
      color: m.color,
      san: m.san,
      uci,
      category,
      cpLoss,
      accuracy: classification.accuracy,
      winLoss: classification.winLoss,
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
  analysisRunning = active;
  byId('hint-btn').disabled = active;
  byId('open-pgn-btn').disabled = active;
  byId('pgn-modal-file').disabled = active;
  byId('depth-select').disabled = active;
  byId('analyze-btn').hidden = active;
  byId('cancel-btn').hidden = !active;
  byId('cancel-btn').disabled = false;
  byId('load-btn').disabled = active;
  byId('demo-btn').disabled = active;
  byId('pgn-file').disabled = active;
  byId('progress-wrap').hidden = !active;
}

function updateProgress(done, total) {
  const pct = Math.round(done / total * 100);
  const totalMoves = fullMoveCount(total - 1);
  byId('progress-text').textContent = `تحليل النقلة ${Math.min(totalMoves, fullMoveCount(done))} من ${totalMoves}`;
  byId('progress-value').textContent = `${pct}%`;
  byId('progress-bar').style.width = `${pct}%`;
}

async function startAnalysis() {
  if (analysisRunning || hintRunning || searchRunning) return;
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
    const playedScores = [];
    const uciMoves = gameSnapshot.moves.map(toUci);

    for (let i = 0; i < gameSnapshot.fens.length; i++) {
      if (abortRequested || id !== runId) break;
      const turnName = gameSnapshot.fens[i].split(' ')[1] === 'w' ? 'الأبيض' : 'الأسود';
      const moveNum = Math.floor(i / 2) + 1;
      status(i < gameSnapshot.moves.length
        ? `جارٍ تحليل النقلة ${moveNum} من ${fullMoveCount(gameSnapshot.moves.length)} (${turnName}) · العمق ${depth}…`
        : `جارٍ استكمال تقييم الوضعية النهائية · العمق ${depth}…`);
      const history = uciMoves.slice(0, i).join(' ');
      const positionCommand = `position fen ${gameSnapshot.fens[0]}${history ? ` moves ${history}` : ''}`;
      const best = await analyzePosition(gameSnapshot.fens[i], depth, { multiPv: i < uciMoves.length ? 2 : 1, positionCommand });
      evals.push(best);
      if (abortRequested || id !== runId) break;
      if (i < uciMoves.length) {
        let played = best.lines.find(line => line.best === uciMoves[i]);
        if (!played) {
          status(`فحص النقلة ${moveNum} (${turnName}) من ${fullMoveCount(uciMoves.length)} ومقارنتها بأفضل البدائل…`);
          played = await analyzePosition(gameSnapshot.fens[i], depth, { searchMove: uciMoves[i], positionCommand });
        }
        playedScores.push(played);
      }
      updateProgress(i + 1, gameSnapshot.fens.length);
      await pause(0);
    }

    if (abortRequested || id !== runId) {
      status('تم إيقاف التحليل. يمكنك إعادة المحاولة في أي وقت.', 'warning');
      return;
    }

    analyses = buildResult(evals, playedScores);
    displayResults();
    status(`اكتمل التحليل بنجاح · عدد النقلات: ${fullMoveCount(gameSnapshot.moves.length)} · العمق: ${depth}.`, 'success');
  } catch (err) {
    if (abortRequested) status('تم إيقاف التحليل.', 'warning');
    else { status(err.message || 'حدث خطأ أثناء التحليل.', 'error'); console.error(err); }
  } finally {
    if (id === runId) setAnalyzing(false);
  }
}

function cancelAnalysis() {
  abortRequested = true;
  worker?.postMessage('stop');
  byId('cancel-btn').disabled = true;
  status('جارٍ إيقاف التحليل…', 'warning');
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
byId('sound-toggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  try { localStorage.setItem('chess-insight-sound', soundEnabled ? 'on' : 'off'); } catch {}
  updateSoundControl();
  if (soundEnabled) playMoveSound();
});
updateSoundControl();


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

// Redraw at the container's real width so dots stay round on every screen.
let chartWidth = 0;
new ResizeObserver(entries => {
  const width = Math.round(entries[0].contentRect.width);
  if (width !== chartWidth) {
    chartWidth = width;
    renderChart();
  }
}).observe(byId('chart-wrap'));

// Startup initialization
byId('pgn-text').value = DEMO;
loadGame(DEMO);

