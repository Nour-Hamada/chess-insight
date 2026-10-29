import { Chess } from 'chess.js';
import { getPieceSvg } from './pieces.js';
import './style.css';
import { winChance, toUci, classifyMove, parseEngineLine } from './review.js';
import { ManualSession, positionSummary } from './manual.js';
import { initScreenshotFeature } from './screenshot.js';

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
let manualMode = false;
let manualSession = null;
let selectedSquare = null;
let pendingPromotion = null;
let manualEvaluation = null;
let manualEvalVersion = 0;
let manualEvalTimer = null;
let manualSearchActive = false;
let manualShowBest = false;
let manualDragTime = 0;
let previousTab = 'review';
const manualEvalCache = new Map();
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
  if (manualMode) leaveManualMode();
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

function updateEvalBar(cp, result = null) {
  const barFill = byId('eval-bar-fill');
  const barScore = byId('eval-bar-score');
  if (!barFill || !barScore) return;

  if (result) {
    const whiteWon = result === '1-0';
    barScore.textContent = result;
    barFill.style.height = `${(flipped ? !whiteWon : whiteWon) ? 100 : 0}%`;
    barScore.className = `eval-bar-score ${whiteWon ? 'white-adv' : 'black-adv'}`;
    return;
  }

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
    if (distance <= 0) {
      text = cp > 0 ? '1-0' : '0-1';
      pct = cp > 0 ? 100 : 0;
    } else {
      text = `M${cp > 0 ? '' : '-'}${distance}`;
      pct = cp > 0 ? 98 : 2;
    }
  } else {
    pct = 50 + 50 * (2 / (1 + Math.exp(-0.0035 * cp)) - 1);
    pct = Math.max(3, Math.min(97, pct));
    const val = (Math.abs(cp) / 100).toFixed(1);
    text = cp > 0 ? `+${val}` : (cp < 0 ? `-${val}` : '0.0');
  }

  const finalPct = flipped ? (100 - pct) : pct;
  barFill.style.height = `${finalPct}%`;
  barScore.textContent = text;
  barScore.className = finalPct >= 50 ? 'eval-bar-score white-adv' : 'eval-bar-score black-adv';
}

function boardCells(fen) {
  let chess = null;
  try {
    chess = new Chess(fen);
  } catch {
    try { chess = new Chess(); } catch {}
  }
  let checked = false;
  let turn = 'w';
  if (chess) {
    try {
      checked = chess.inCheck();
      turn = chess.turn();
    } catch {}
  }

  // Backup manual piece placement parser if chess.js failed
  let manualPlacement = null;
  if (!chess) {
    try {
      const placement = (fen || '').trim().split(/\s+/)[0];
      const rows = placement.split('/');
      manualPlacement = {};
      for (let r = 0; r < 8; r++) {
        const row = rows[r] || '8';
        let c = 0;
        for (const ch of row) {
          if (/[1-8]/.test(ch)) c += parseInt(ch, 10);
          else if (/[a-zA-Z]/.test(ch) && c < 8) {
            const sq = `${'abcdefgh'[c]}${8 - r}`;
            manualPlacement[sq] = {
              color: ch === ch.toUpperCase() ? 'w' : 'b',
              type: ch.toLowerCase()
            };
            c++;
          }
        }
      }
    } catch {}
  }

  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const file = 'abcdefgh'[c];
      const rank = 8 - r;
      const square = `${file}${rank}`;
      let piece = null;
      if (chess) {
        try { piece = chess.get(square); } catch {}
      } else if (manualPlacement) {
        piece = manualPlacement[square] || null;
      }
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

// Real wooden-board recordings by Jeff Final Boss, CC0 (see sounds/CREDITS.txt).
const recordedAudio = new Map(['move', 'capture'].map(key => [key,
  fetch(new URL(`./sounds/${key}.mp3`, window.location.href)).then(response => {
    if (!response.ok) throw new Error('Audio unavailable');
    return response.arrayBuffer();
  }).catch(() => null)
]));

function playMoveSound(capture = false) {
  if (!soundEnabled) return;
  try {
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) return;
    audioContext ||= new AudioEngine();
    const now = audioContext.currentTime;
    if (now - lastSoundTime < 0.075) return;
    lastSoundTime = now;
    const key = capture ? 'capture' : 'move';
    const ready = audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve();
    ready.then(async () => {
      if (!soundEnabled) return;
      if (!moveSoundBuffers.has(key)) {
        moveSoundBuffers.set(key, recordedAudio.get(key).then(bytes => bytes ? audioContext.decodeAudioData(bytes.slice(0)) : null));
      }
      const buffer = await moveSoundBuffers.get(key);
      if (!buffer || !soundEnabled) return;
      const source = audioContext.createBufferSource();
      const volume = audioContext.createGain();
      source.buffer = buffer; volume.gain.value = 0.7;
      source.connect(volume).connect(audioContext.destination);
      source.onended = () => { source.disconnect(); volume.disconnect(); };
      source.start();
    }).catch(() => {});
  } catch {} // A sound must never block navigation.
}

function enterManualMode(fresh = false) {
  if (analysisRunning || hintRunning || (searchRunning && !manualSearchActive)) return;
  if (!manualMode) previousTab = byId('tab-moves-btn').classList.contains('active') ? 'moves' : 'review';
  manualMode = true;
  manualSession = new ManualSession(fresh ? START_FEN : (game?.fens[0] || START_FEN));
  if (!fresh && game) {
    manualSession.moves = game.moves.slice(0, position);
    manualSession.cursor = position;
  }
  selectedSquare = null;
  manualShowBest = false;
  currentHint = null;
  byId('manual-error').textContent = '';
  byId('manual-move-input').value = '';
  setManualControls();
  setTab('moves');
  renderBoard(); renderMoves();
  requestManualEvaluation();
}

function leaveManualMode() {
  manualMode = false;
  manualEvalVersion++;
  clearTimeout(manualEvalTimer); manualEvalTimer = null;
  if (manualSearchActive && searchRunning) worker?.postMessage('stop');
  selectedSquare = null; pendingPromotion = null; currentHint = null;
  if (byId('promotion-dialog').open) byId('promotion-dialog').close();
  setManualControls();
  setTab(previousTab);
  renderAll();
  status('عدت إلى المباراة الأصلية.', 'info');
}

function setManualControls() {
  document.body.classList.toggle('manual-mode', manualMode);
  byId('manual-toggle').setAttribute('aria-pressed', String(manualMode));
  byId('manual-toggle').textContent = manualMode ? '📋 مراجعة المباراة' : '♟ تحليل يدوي';
  byId('manual-panel').hidden = !manualMode;
  byId('analyze-btn').hidden = manualMode || analysisRunning;
  byId('analyze-btn').disabled = manualSearchActive || hintRunning;
  byId('hint-btn').disabled = analysisRunning || hintRunning;
  byId('board').setAttribute('role', manualMode ? 'group' : 'img');
  byId('board').setAttribute('aria-label', manualMode ? 'رقعة تفاعلية، اختر قطعة ثم مربع الوصول' : 'رقعة الشطرنج');
  document.querySelector('.review-title').innerHTML = `<span aria-hidden="true">★</span> ${manualMode ? 'تحليل الوضعية' : 'مراجعة المباراة'}`;
  for (const color of ['white', 'black']) {
    const key = color === 'white' ? 'White' : 'Black';
    byId(`${color}-name`).textContent = manualMode ? (color === 'white' ? 'الأبيض' : 'الأسود') : (game?.headers[key] || (color === 'white' ? 'الأبيض' : 'الأسود'));
    byId(`${color}-elo`).textContent = manualMode ? color.toUpperCase() : (game?.headers[`${key}Elo`] ? `ELO ${game.headers[`${key}Elo`]}` : color.toUpperCase());
  }
  if (manualMode) renderManualSummary();
}

function renderManualSummary() {
  if (!manualMode) return;
  const board = manualSession.board();
  const summary = positionSummary(board, manualEvaluation);
  byId('manual-leader').textContent = summary.title;
  byId('manual-score').textContent = summary.score;
  byId('manual-score').dataset.tone = summary.tone;
  const terminal = board.isGameOver();
  byId('manual-turn').textContent = terminal ? 'انتهت هذه الوضعية؛ تراجع عن نقلة لتجربة بديل.'
    : `دور ${board.turn() === 'w' ? 'الأبيض' : 'الأسود'}${board.inCheck() ? ' · كش' : ''}${manualEvaluation ? ` · العمق ${manualEvaluation.depth || '—'}` : ''}`;
  byId('manual-move-input').disabled = terminal;
  byId('manual-move-form').querySelector('button').disabled = terminal;
  byId('hint-btn').disabled = terminal;
}

function requestManualEvaluation() {
  status('جارٍ تقييم الوضعية الحالية…', 'info');
  manualEvalVersion++;
  selectedSquare = null;
  manualEvaluation = null;
  currentHint = null;
  clearTimeout(manualEvalTimer);
  renderBoard();
  manualEvalTimer = setTimeout(() => { manualEvalTimer = null; evaluateManualPosition(); }, 180);
}

async function evaluateManualPosition() {
  if (!manualMode || manualSearchActive) return;
  const version = manualEvalVersion;
  const board = manualSession.board();
  const fen = board.fen();
  const positionCommand = manualSession.positionCommand;
  const depth = Number(byId('depth-select').value) || 16;
  const key = `${positionCommand}|${depth}`;
  manualSearchActive = true;
  try {
    let result = manualEvalCache.get(key);
    if (board.isGameOver()) result = { cpWhite: board.isCheckmate() ? (board.turn() === 'w' ? -10000 : 10000) : 0, best: '(none)', depth: 0 };
    if (!result) {
      await ensureEngine();
      if (!manualMode || version !== manualEvalVersion) return;
      result = await analyzePosition(fen, depth, { positionCommand });
      if (result.depth >= depth) {
        if (manualEvalCache.size >= 150) manualEvalCache.delete(manualEvalCache.keys().next().value);
        manualEvalCache.set(key, result);
      }
    }
    if (!manualMode || version !== manualEvalVersion) return;
    manualEvaluation = result;
    if (manualShowBest && result.best && result.best !== '(none)') {
      currentHint = { fen, from: result.best.slice(0, 2), to: result.best.slice(2, 4), cp: result.cpWhite,
        text: `أفضل نقلة: ${result.bestSan || uciToSan(fen, result.best)}` };
    }
    renderBoard();
    status(`${positionSummary(board, result).title} · التقييم محدث للوضعية الحالية.`, 'success');
  } catch (err) {
    if (manualMode && version === manualEvalVersion) {
      byId('manual-leader').textContent = 'تعذر تقييم الوضعية';
      status(err.message, 'error');
    }
  } finally {
    manualSearchActive = false;
    if (!manualMode) byId('analyze-btn').disabled = analysisRunning || hintRunning;
    else if (version !== manualEvalVersion && !manualEvalTimer) evaluateManualPosition();
  }
}

function playManualMove(input) {
  if (!manualMode) return;
  try {
    const move = manualSession.play(input);
    playMoveSound(Boolean(move.captured));
    selectedSquare = null;
    manualShowBest = false;
    byId('manual-error').textContent = '';
    byId('manual-move-input').value = '';
    renderMoves();
    requestManualEvaluation();
    updateActiveMove();
  } catch (err) { byId('manual-error').textContent = err.message; }
}

function navigateManual(cursor) {
  if (manualSession.cursor === cursor) return;
  const before = manualSession.cursor;
  manualSession.jump(cursor);
  if (before !== manualSession.cursor) playMoveSound();
  manualShowBest = false;
  byId('manual-error').textContent = '';
  requestManualEvaluation();
  updateActiveMove();
}

function chooseManualDestination(from, to) {
  const candidates = manualSession.legalMoves(from).filter(move => move.to === to);
  if (!candidates.length) return false;
  if (candidates.some(move => move.promotion)) {
    pendingPromotion = { from, to };
    const color = manualSession.board().turn();
    const options = byId('promotion-options'); options.replaceChildren();
    for (const [piece, name] of [['q', 'وزير'], ['r', 'رخ'], ['b', 'فيل'], ['n', 'حصان']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('aria-label', `ترقية إلى ${name}`);
      button.innerHTML = getPieceSvg(color, piece);
      button.addEventListener('click', () => {
        const move = pendingPromotion; pendingPromotion = null;
        byId('promotion-dialog').close();
        if (move) playManualMove({ ...move, promotion: piece });
      });
      options.appendChild(button);
    }
    byId('promotion-dialog').showModal();
  } else playManualMove({ from, to });
  return true;
}

function selectManualSquare(square) {
  if (!manualMode || Date.now() - manualDragTime < 120) return;
  if (selectedSquare && chooseManualDestination(selectedSquare, square)) return;
  const board = manualSession.board();
  const piece = board.get(square);
  selectedSquare = !board.isGameOver() && piece?.color === board.turn() && selectedSquare !== square ? square : null;
  renderBoard();
}

function renderBoard() {
  if (!manualMode && position !== lastRenderedPosition) {
    const soundedMove = game?.moves[Math.max(position, lastRenderedPosition) - 1];
    playMoveSound(Boolean(soundedMove?.captured));
    lastRenderedPosition = position;
  }
  const grid = byId('board');
  const focusedSquare = manualMode ? document.activeElement?.closest('.square')?.dataset.square : null;
  grid.replaceChildren();
  const currentFen = manualMode ? manualSession.fen : (game ? game.fens[position] : START_FEN);
  grid.dataset.fen = currentFen;
  grid.dataset.orientation = flipped ? 'black' : 'white';
  const displayedPosition = manualMode ? manualSession.cursor : position;
  const displayedMoves = manualMode ? manualSession.moves : (game?.moves || []);
  let manualBoard = null;
  if (manualMode && manualSession) { try { manualBoard = manualSession.board(); } catch (e) { console.warn(e); } }
  const legalTargets = manualMode && selectedSquare && manualSession ? (() => { try { return manualSession.legalMoves(selectedSquare) || []; } catch { return []; } })() : [];
  const info = !manualMode && position > 0 ? analyses?.moves[position - 1] : null;
  const alternative = info?.best && info.best !== info.uci && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(info.best) ? info.best : null;
  const hint = currentHint?.fen === currentFen ? currentHint : null;
  const fen = currentFen;
  const last = manualMode ? manualSession.lastMove : (game && position > 0 ? game.moves[position - 1] : null);
  // Keep the played position visible. The arrow shows the alternative's original
  // source and destination without moving a piece or rewinding the board.
  const arrow = hint || (alternative ? { from: alternative.slice(0, 2), to: alternative.slice(2, 4) } : null);
  const cells = boardCells(fen);
  const view = flipped ? [...cells].reverse() : cells;

  view.forEach((entry, i) => {
    const sq = document.createElement('div');
    sq.className = `square ${(entry.r + entry.c) % 2 === 0 ? 'light' : 'dark'}`;
    sq.dataset.square = entry.square;
    if (manualMode) {
      sq.setAttribute('role', 'button'); sq.tabIndex = 0;
      sq.setAttribute('aria-label', entry.square + (entry.piece ? ` ${entry.piece.color === 'w' ? 'أبيض' : 'أسود'}` : ' فارغ'));
      if (selectedSquare === entry.square) sq.classList.add('manual-selected');
      if (legalTargets.some(move => move.to === entry.square)) sq.classList.add(entry.piece ? 'manual-capture-target' : 'manual-legal-target');
      sq.addEventListener('click', () => selectManualSquare(entry.square));
      sq.addEventListener('keydown', event => {
        if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); selectManualSquare(entry.square); }
      });
      sq.addEventListener('dragover', event => event.preventDefault());
      sq.addEventListener('drop', event => {
        event.preventDefault(); manualDragTime = Date.now();
        const from = event.dataTransfer.getData('text/plain');
        if (/^[a-h][1-8]$/.test(from)) chooseManualDestination(from, entry.square);
      });
    }

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
        pieceWrap.dataset.piece = entry.piece.color + entry.piece.type;
        pieceWrap.innerHTML = svgCode;
        const isTurnPiece = manualMode && manualBoard ? (entry.piece.color === manualBoard.turn?.() && !manualBoard.isGameOver?.()) : false;
        if (isTurnPiece) {
          pieceWrap.draggable = true;
          pieceWrap.addEventListener('dragstart', event => {
            selectedSquare = entry.square;
            event.dataTransfer.setData('text/plain', entry.square);
            event.dataTransfer.effectAllowed = 'move';
          });
          pieceWrap.addEventListener('dragend', () => { manualDragTime = Date.now(); });
        }
        sq.appendChild(pieceWrap);
      }
    }

    // Move classification badge on the target square of the last move (Chess.com style)
    if (!manualMode && last && last.to === entry.square && analyses && position > 0) {
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

  if (focusedSquare) grid.querySelector(`[data-square="${focusedSquare}"]`)?.focus({ preventScroll: true });
  if (arrow) drawMoveArrow(grid, arrow.from, arrow.to);
  byId('move-counter').textContent = `${fullMoveCount(displayedPosition)} / ${fullMoveCount(displayedMoves.length)}`;

  let desc = 'بداية المباراة';
  if (displayedPosition > 0) {
    const m = displayedMoves[displayedPosition - 1];
    desc = `${Number(m.before.split(' ')[5])}${m.color === 'w' ? '.' : '...'} ${m.san}`;
    const info = manualMode ? null : analyses?.moves[position - 1];
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
  let matedResult = null;
  try {
    const terminalBoard = manualMode ? manualBoard : new Chess(fen);
    if (terminalBoard?.isCheckmate()) matedResult = terminalBoard.turn() === 'w' ? '0-1' : '1-0';
  } catch {}
  const curEval = manualMode ? (manualEvaluation?.cpWhite ?? null) : (analyses?.evals?.[position]?.cpWhite ?? (hint ? hint.cp : 0));
  updateEvalBar(curEval, matedResult);

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

  byId('first-btn').disabled = displayedPosition === 0;
  byId('prev-btn').disabled = displayedPosition === 0;
  byId('next-btn').disabled = displayedPosition === displayedMoves.length;
  byId('last-btn').disabled = displayedPosition === displayedMoves.length;
  if (manualMode) {
    if (!manualEvaluation && !matedResult) byId('eval-bar-score').textContent = '…';
    renderManualSummary();
  }
}

function renderMoves() {
  const root = byId('moves-list');
  root.replaceChildren();
  const displayedMoves = manualMode ? manualSession.moves : game?.moves;
  const activePosition = manualMode ? manualSession.cursor : position;
  if (!displayedMoves?.length) {
    root.innerHTML = `<div class="empty-moves">${manualMode ? 'حرّك قطعة على الرقعة لإضافة أول نقلة.' : 'لنبدأ بإدخال مباراتك.'}</div>`;
    return;
  }

  for (let i = 0; i < displayedMoves.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const num = document.createElement('span');
    num.className = 'move-number';
    num.textContent = `${Math.floor(i / 2) + 1}.`;
    row.appendChild(num);

    for (let j = i; j < Math.min(i + 2, displayedMoves.length); j++) {
      const m = displayedMoves[j];
      const info = manualMode ? null : analyses?.moves[j];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'move-chip' + (activePosition === j + 1 ? ' active' : '');
      btn.title = info
        ? `دقة تقديرية ${formatNum(info.accuracy)}% · انخفاض فرص الفوز ${formatNum(info.winLoss)} نقطة مئوية`
        : 'انقر لعرض هذه النقلة';

      btn.addEventListener('click', () => {
        if (manualMode) { navigateManual(j + 1); return; }
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
    const isActive = (manualMode ? manualSession.cursor : position) === idx + 1;
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
  if (manualMode) return;
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
  if (manualMode) {
    manualShowBest = true;
    evaluateManualPosition();
    return;
  }
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
  byId('manual-toggle').disabled = true;
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
    byId('manual-toggle').disabled = false;
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
  byId('manual-toggle').disabled = active;
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
  if (manualMode || manualSearchActive || analysisRunning || hintRunning || searchRunning) return;
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

byId('manual-toggle').addEventListener('click', () => manualMode ? leaveManualMode() : enterManualMode());
byId('manual-new').addEventListener('click', () => enterManualMode(true));
byId('manual-exit').addEventListener('click', leaveManualMode);
byId('manual-move-form').addEventListener('submit', event => {
  event.preventDefault(); playManualMove(byId('manual-move-input').value);
});
byId('depth-select').addEventListener('change', () => { if (manualMode) requestManualEvaluation(); });
byId('promotion-cancel').addEventListener('click', () => { pendingPromotion = null; byId('promotion-dialog').close(); });
byId('promotion-dialog').addEventListener('cancel', () => { pendingPromotion = null; });

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
  if (manualMode) { navigateManual(0); return; }
  position = 0;
  currentHint = null;
  renderBoard();
  updateActiveMove();
  renderChart();
});

byId('prev-btn').addEventListener('click', () => {
  if (manualMode) { navigateManual(manualSession.cursor - 1); return; }
  position = Math.max(0, position - 1);
  currentHint = null;
  renderBoard();
  updateActiveMove();
  renderChart();
});

byId('next-btn').addEventListener('click', () => {
  if (manualMode) { navigateManual(manualSession.cursor + 1); return; }
  position = Math.min(game?.moves.length || 0, position + 1);
  currentHint = null;
  renderBoard();
  updateActiveMove();
  renderChart();
});

byId('last-btn').addEventListener('click', () => {
  if (manualMode) { navigateManual(manualSession.moves.length); return; }
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
  if (manualMode) {
    if (e.key === 'Escape') { selectedSquare = null; renderBoard(); return; }
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      navigateManual(e.key === 'Home' ? 0 : e.key === 'End' ? manualSession.moves.length
        : manualSession.cursor + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1));
    }
    return;
  }
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
enterManualMode(true);
// A position shared by the browser extension opens as an editable board.
function loadSharedPosition() {
  try {
    const sharedFen = new URLSearchParams(location.hash.slice(1)).get('fen');
    if (!sharedFen) return;
    const session = new ManualSession(sharedFen);
    if (!manualMode) enterManualMode(true);
    if (!manualMode) return status('أوقف التحليل الحالي أولًا لفتح الوضعية المرسلة.', 'error');
    manualSession = session;
    selectedSquare = null; currentHint = null;
    renderBoard(); renderMoves(); requestManualEvaluation();
  } catch { status('تعذر فتح الوضعية المرسلة: صيغة FEN غير صالحة.', 'error'); }
}
loadSharedPosition();
addEventListener('hashchange', loadSharedPosition);



function ensureKingsInFen(fen) {
  try {
    const parts = (fen || '').trim().split(/\s+/);
    let placement = parts[0] || '';
    let turn = parts[1] || 'w';
    let castling = parts[2] || '-';
    let ep = parts[3] || '-';
    const hasWhiteKing = placement.includes('K');
    const hasBlackKing = placement.includes('k');
    if (hasWhiteKing && hasBlackKing) {
      try {
        const c = new Chess(`${placement} ${turn} ${castling} ${ep} 0 1`);
        return c.fen();
      } catch {}
    }
    const rows = placement.split('/');
    let grid = Array(8).fill(null).map(() => Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
      const row = rows[r] || '8';
      let c = 0;
      for (const ch of row) {
        if (/[1-8]/.test(ch)) c += parseInt(ch, 10);
        else if (/[a-zA-Z]/.test(ch) && c < 8) { grid[r][c] = ch; c++; }
      }
    }
    let foundW = false, foundB = false;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (grid[r][c] === 'K') foundW = true;
        if (grid[r][c] === 'k') foundB = true;
      }
    }
    if (!foundW) {
      if (!grid[7][4]) { grid[7][4] = 'K'; foundW = true; }
      else {
        for (let r = 7; r >= 0 && !foundW; r--) {
          for (let c = 0; c < 8; c++) {
            if (!grid[r][c]) { grid[r][c] = 'K'; foundW = true; break; }
          }
        }
      }
    }
    if (!foundB) {
      if (!grid[0][4]) { grid[0][4] = 'k'; foundB = true; }
      else {
        for (let r = 0; r < 8 && !foundB; r++) {
          for (let c = 0; c < 8; c++) {
            if (!grid[r][c]) { grid[r][c] = 'k'; foundB = true; break; }
          }
        }
      }
    }
    const newPlacement = grid.map(row => {
      let s = '', empty = 0;
      for (const ch of row) {
        if (!ch) empty++;
        else { if (empty) { s += empty; empty = 0; } s += ch; }
      }
      if (empty) s += empty;
      return s || '8';
    }).join('/');
    try {
      const c = new Chess(`${newPlacement} ${turn} - - 0 1`);
      return c.fen();
    } catch {
      return `${newPlacement} ${turn} - - 0 1`;
    }
  } catch {
    return START_FEN;
  }
}

function applyPositionFromScreenshot(fen) {
  try {
    if (analysisRunning || hintRunning) return;
    const safeFen = ensureKingsInFen(fen);
    const session = new ManualSession(safeFen);
    if (!manualMode) enterManualMode(true);
    manualSession = session;
    // The chosen side to move sits at the bottom, so the best move reads from their view.
    flipped = safeFen.split(' ')[1] === 'b';
    manualShowBest = true;
    selectedSquare = null;
    currentHint = null;
    renderBoard();
    renderMoves();
    requestManualEvaluation();
    status('تم استخراج وضعية السكرين شوت، وجارٍ تقييم الموقف بمحرك Stockfish 19…', 'success');
  } catch (err) {
    status('تعذر تحميل الوضعية: ' + (err.message || err), 'error');
  }
}

initScreenshotFeature({
  onApplyFen: applyPositionFromScreenshot,
  onStatus: status
});
