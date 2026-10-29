import { Chess } from 'chess.js';
import { getPieceSvg } from '../../src/pieces.js';
import { PositionTracker, scoreLabel, positionFromPieces, visibleEnPassant } from './position.js';
import { detectBoard, arrowPoints } from './detect.js';

const VERSION = typeof __CI_VERSION__ === 'string' ? __CI_VERSION__ : 'dev';
const previous = document.getElementById('chess-insight-extension');
if (previous?.dataset.version !== VERSION) {
  previous?.dispatchEvent(new Event('ci:dispose'));
  previous?.remove();
  start();
} else previous.dispatchEvent(new Event('ci:refresh'));
function start() {
  const host = document.createElement('div');
  host.id = 'chess-insight-extension';
  host.dataset.version = VERSION;
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{font-family:Arial,Tahoma,sans-serif;color:#f4f6f3;font-size:14px;line-height:1.5}
    *{box-sizing:border-box} [hidden]{display:none!important}
    #card{position:fixed;right:16px;bottom:18px;width:278px;max-width:calc(100vw - 24px);background:#222624;color:#f4f6f3;font:14px/1.5 Arial,Tahoma,sans-serif;border:1px solid #49564d;border-radius:15px;box-shadow:0 10px 40px #0006;pointer-events:auto;direction:rtl;overflow:hidden}
    header{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:1px solid #39433c;cursor:move;touch-action:none} header strong{font-size:15px;direction:ltr;color:#c0efaa}
    button,select,textarea,input{font:inherit} button{background:#36433a;color:#f4f6f3;border:1px solid #4d6252;border-radius:7px;padding:7px 9px;cursor:pointer} button:hover{background:#455a49} button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #a3e27e;outline-offset:2px}
    #pause{font-size:12px;padding:4px 8px}.body{padding:13px 14px} #status{color:#aebbb1;font-size:12px;margin:0 0 8px;min-height:18px} .result{display:flex;align-items:center;justify-content:space-between;gap:8px}#leader{font-size:16px;font-weight:bold}#score{font-size:29px;font-weight:bold;color:#b7ed9d;direction:ltr;font-variant-numeric:tabular-nums} #best{margin:9px 0 0;color:#d8e8d9}#meta{font-size:11px;color:#aebbb1;margin-top:5px}
    details{margin-top:11px;border-top:1px solid #39433c;padding-top:9px}summary{cursor:pointer;font-size:12px;color:#b7c7ba} #mini{width:192px;height:192px;display:grid;grid-template-columns:repeat(8,1fr);direction:ltr;margin:12px auto}#mini div{display:flex;align-items:center;justify-content:center;background:#e6e7e4}#mini div.dark{background:#afb4b0}#mini svg{width:94%;height:94%}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.actions button{font-size:11px;flex:1}textarea{width:100%;min-height:59px;padding:7px;margin-top:8px;background:#171c18;border:1px solid #5a6a5e;border-radius:7px;color:white;direction:ltr;font-size:11px;resize:vertical}label{display:block;font-size:11px;margin-top:9px;color:#b7c7ba}#error{font-size:11px;color:#ffbdab;min-height:16px;margin-top:5px}
    #overlay{position:fixed;pointer-events:none;overflow:visible;filter:drop-shadow(0 1px 2px #12261299)}
    #card{max-height:calc(100vh - 24px);overflow-y:auto}#setup{padding:10px;background:#2e3a30;border-radius:8px;margin-top:10px}#setup p{font-size:11px;color:#c3d1c5;margin:4px 0}#setup select,#setup input[type=text]{background:#171c18;color:white;border:1px solid #607865;border-radius:5px;padding:5px;width:100%}#castling{display:grid;grid-template-columns:1fr 1fr;gap:3px}#castling label{font-size:11px;margin:4px 0}#setup input[type=checkbox]{accent-color:#94d371}#setup button{width:100%;margin-top:9px;background:#78ab51;color:#15250f;font-weight:bold}
    footer{font-size:10px;color:#99a99d;margin-top:10px}a{color:#b7ed9d}
  </style>
  <svg id="overlay" hidden viewBox="0 0 100 100" aria-label="سهم أفضل نقلة"><defs><marker id="ci-tip" markerWidth="3.3" markerHeight="3.3" refX="2.3" refY="1.65" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L3.0,1.65 L0,3.3 L.65,1.65 Z" fill="#64cf3c"/></marker></defs><line id="arrow" stroke="#64cf3c" stroke-width="2.3" stroke-linecap="round" opacity=".94" marker-end="url(#ci-tip)"/></svg>
  <section id="card" aria-label="تحليل Chess Insight">
    <header><strong>♞ Chess Insight</strong><button id="pause" type="button">إيقاف مؤقت</button></header>
    <div class="body"><p id="status" role="status">جارٍ البحث عن رقعة…</p><div class="result"><span id="leader">بانتظار الرقعة</span><span id="score">—</span></div><p id="best">سيظهر أفضل تحريك بسهم أخضر.</p><div id="meta"></div><p id="assumptions" hidden style="font-size:11px;color:#f0cf8e">تقييم من الأحجار مباشرة. التبييت غير محسوب حتى تأكيده، والأخذ بالتجاوز يعتمد على آخر نقلة ظاهرة. يمكنك ضبطهما من أدوات الوضعية.</p>
    <details><summary>الرقعة الملتقطة وأدوات الوضعية</summary><div id="mini" aria-label="نسخة الوضعية الحالية"></div>
    <form id="setup" hidden><strong>الوضعية من الأحجار الظاهرة</strong><p>اختيار الدور يبدأ التقييم فورًا. يمكنك بعد ذلك تأكيد حقوق التبييت والأخذ بالتجاوز.</p><label for="turn">صاحب الدور</label><select id="turn" required><option value="" selected disabled>اختر الأبيض أو الأسود</option><option value="w">الأبيض</option><option value="b">الأسود</option></select><label>التبييت ما زال مسموحًا</label><div id="castling"><label><input type="checkbox" value="K"> الأبيض القصير</label><label><input type="checkbox" value="Q"> الأبيض الطويل</label><label><input type="checkbox" value="k"> الأسود القصير</label><label><input type="checkbox" value="q"> الأسود الطويل</label></div><label for="ep">مربع الأخذ بالتجاوز، أو - إذا لم يتوفر</label><input type="text" id="ep" value="-" maxlength="2" spellcheck="false" dir="ltr"><p>اترك حقوق التبييت غير المتاحة بلا تحديد. تحليل التعادل المعتمد على سجل النقلات يحتاج السجل الكامل.</p><button type="submit">تأكيد إعدادات الوضعية</button></form>
    <div class="actions"><button id="copy">نسخ FEN</button><button id="open">فتح للتحليل اليدوي</button></div><label for="fen">أو أدخل FEN كاملًا مطابقًا للرقعة</label><textarea id="fen" spellcheck="false" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"></textarea><div class="actions"><button id="apply">استخدام FEN المطابق للرقعة</button><button id="diagnostics">نسخ تشخيص المشكلة</button></div><textarea id="diagnostics-output" hidden readonly aria-label="تشخيص الإضافة"></textarea><div id="error" role="alert"></div></details>
    <footer>الإصدار ${VERSION} · Stockfish 19 · الموجب لصالح الأبيض</footer></div>
  </section>`;
  document.documentElement.appendChild(host);
  const $ = id => shadow.getElementById(id);
  const tracker = new PositionTracker(), cache = new Map();
  let reading = null, position = null, lastKey = '', version = 0, paused = false, enabled = true, depth = 14, result = null, url = location.href;
  let timer, disposed = false, directState = null, pendingNonce = '', directAttempt = 0, directMethod = 'not-requested', lastError = '', pendingSince = 0, visualAssumptions = false;
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  function clear(title, status) {
    result = null; $('overlay').toggleAttribute('hidden', true);
    text('leader', title); text('status', status); text('score', '—'); text('best', ''); text('meta', '');
  }
  function renderArrow() {
    if (!reading || !result?.best || paused || !enabled) { $('overlay').toggleAttribute('hidden', true); return; }
    const r = reading.element.getBoundingClientRect();
    if (!r.width || !r.height) { $('overlay').toggleAttribute('hidden', true); return; }
    const { from, to } = arrowPoints(result.best, reading.flipped);
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    const end = { x: to.x - dx / length * 3, y: to.y - dy / length * 3 };
    const arrow = $('arrow');
    for (const [key, value] of Object.entries({ x1: from.x, y1: from.y, x2: end.x, y2: end.y })) arrow.setAttribute(key, value);
    $('overlay').style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    $('overlay').toggleAttribute('hidden', false);
  }
  function miniBoard() {
    if (!reading) { $('mini').replaceChildren(); return; }
    let board;
    try { board = new Chess(position?.fen || `${reading.placement} w - - 0 1`); } catch { $('mini').replaceChildren(); return; }
    const frag = document.createDocumentFragment();
    const files = reading.flipped ? 'hgfedcba' : 'abcdefgh';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const square = files[col] + (reading.flipped ? row + 1 : 8 - row), piece = board.get(square);
      const cell = document.createElement('div');
      if ((row + col) % 2) cell.className = 'dark';
      if (piece) cell.innerHTML = getPieceSvg(piece.color, piece.type);
      cell.title = square; frag.appendChild(cell);
    }
    $('mini').replaceChildren(frag);
  }
  function show(evaluation) {
    pendingSince = 0;
    result = evaluation;
    const label = scoreLabel(result);
    text('leader', label.title); text('score', label.score);
    text('status', `متصل بـ ${reading.type} · دور ${position.fen.split(' ')[1] === 'w' ? 'الأبيض' : 'الأسود'}`);
    text('best', result.bestSan ? `أفضل نقلة: ${result.bestSan}` : 'انتهت هذه الوضعية');
    text('meta', `${position.source} · العمق ${result.depth}`);
    $('assumptions').hidden = !visualAssumptions;
    renderArrow();
  }
  async function analyze(force = false) {
    if (disposed) return;
    if (!host.isConnected || !chrome.runtime.id) { dispose(); return; }
    if (location.href !== url) { url = location.href; tracker.reset(); lastKey = ''; position = null; directState = null; visualAssumptions = false; }
    if (!enabled || paused) return;
    let detected;
    try { detected = detectBoard(); } catch (e) { lastError = e.message; clear('تعذّر قراءة الرقعة', 'انسخ تشخيص المشكلة من أدوات الوضعية.'); return; }
    if (!detected) {
      $('overlay').toggleAttribute('hidden', true);
      // A board may disappear during navigation or be temporarily incomplete.
      if (reading && !reading.element.isConnected) { version++; reading = position = null; lastKey = ''; clear('بانتظار الرقعة', 'لم أجد رقعة متوافقة في هذه الصفحة.'); miniBoard(); }
      return;
    }
    const orientationChanged = reading?.flipped !== detected.flipped;
    reading = detected;
    let resolved;
    try {
      const direct = directState?.element === reading.element && directState.placement === reading.placement;
      resolved = tracker.resolve(direct ? { ...reading, fullFen: directState.fen } : reading);
      if (resolved && direct) { tracker.source = resolved.source = 'وضعية مباشرة من الرقعة'; visualAssumptions = false; }
      else if (resolved && (resolved.source === 'سجل النقلات' || (reading.fullFen && resolved.fen === new Chess(reading.fullFen).fen()))) visualAssumptions = false;
      if (!resolved && reading.turn) {
        requestDirectPosition();
        const epSquare = visibleEnPassant(reading.lastMove, reading.turn);
        const fen = positionFromPieces(reading.placement, { turn: reading.turn, epSquare });
        resolved = tracker.resolve(reading, fen); visualAssumptions = true;
        tracker.source = resolved.source = `من الأحجار · ${reading.turnSource}`;
        $('turn').value = reading.turn; $('ep').value = epSquare;
      }
    } catch (e) { lastError = e.message; }
    if (!resolved) {
      version++; lastKey = ''; position = null;
      clear('أحتاج تأكيد الوضعية', 'سجل المباراة غير مكتمل؛ أحاول قراءة الوضعية مباشرة، أو أكّدها أدناه.');
      if ($('setup').hidden) { $('setup').hidden = false; shadow.querySelector('details').open = true; }
      miniBoard(); requestDirectPosition();
      return;
    }
    $('setup').hidden = !visualAssumptions;
    $('assumptions').hidden = !visualAssumptions;
    if (visualAssumptions) requestDirectPosition();
    position = resolved;
    const key = position.fen + '|' + depth;
    if (!force && key === lastKey) { if (orientationChanged) miniBoard(); if (result) show(result); else renderArrow(); return; }
    lastKey = key;
    const current = ++version;
    pendingSince = Date.now(); lastError = '';
    clear('جارٍ التقييم…', `تم التقاط الوضعية · ${reading.type}`); miniBoard(); text('error', '');
    $('fen').placeholder = position.fen;
    if (cache.has(key)) { show(cache.get(key)); return; }
    try {
      const evaluation = await chrome.runtime.sendMessage({ type: 'CI_ANALYZE', fen: position.fen, position: position.position, requestId: current });
      if (current !== version || paused || !enabled) return;
      if (evaluation?.stale) { lastKey = ''; return; }
      if (!evaluation || evaluation.error) throw new Error(evaluation?.error || 'لم يصل رد من المحرك.');
      if (evaluation.best) new Chess(position.fen).move({ from: evaluation.best.slice(0, 2), to: evaluation.best.slice(2, 4), promotion: evaluation.best[4] });
      cache.set(key, evaluation); if (cache.size > 100) cache.delete(cache.keys().next().value);
      show(evaluation);
    } catch (e) { if (current === version) { lastError = e.message; pendingSince = 0; clear('تعذر التحليل', e.message); lastKey = ''; } }
  }
  function requestDirectPosition() {
    if (!reading || Date.now() - directAttempt < 2000) return;
    directAttempt = Date.now(); pendingNonce = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    document.dispatchEvent(new CustomEvent('ci:position-request', { detail: JSON.stringify({ nonce: pendingNonce, boardId: reading.element.id || '' }) }));
  }
  function receiveDirectPosition(event) {
    if (disposed || !reading) return;
    try {
      const data = JSON.parse(event.detail);
      if (!pendingNonce || data.nonce !== pendingNonce) return;
      pendingNonce = ''; directMethod = String(data.method || 'unknown');
      if (!data.fen) return;
      const fen = new Chess(data.fen).fen();
      if (fen.split(' ')[0] !== reading.placement || (data.boardId && data.boardId !== reading.element.id)) return;
      directState = { fen, element: reading.element, placement: reading.placement };
      queueMicrotask(() => analyze(true));
    } catch (e) { lastError = `قراءة الوضعية المباشرة: ${e.message}`; }
  }
  document.addEventListener('ci:position-response', receiveDirectPosition);
  function schedule() { clearTimeout(timer); timer = setTimeout(() => analyze(), 220); }
  const observer = new MutationObserver(records => { if (records.some(r => r.target !== host && !host.contains(r.target))) schedule(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-fen', 'data-orientation'], characterData: true });
  const pollTimer = setInterval(() => analyze(), 900);
  addEventListener('resize', renderArrow); addEventListener('scroll', renderArrow, true);
  $('pause').addEventListener('click', () => {
    paused = !paused; version++; lastKey = '';
    text('pause', paused ? 'استئناف' : 'إيقاف مؤقت');
    if (paused) clear('التحليل متوقف', 'اضغط استئناف لإعادة قراءة الرقعة.'); else analyze(true);
  });
  $('apply').addEventListener('click', () => {
    try {
      if (!reading) throw new Error('لم يتم العثور على رقعة.');
      position = tracker.resolve(reading, $('fen').value.trim());
      visualAssumptions = false; directState = null; lastKey = ''; text('error', ''); analyze(true);
    } catch (e) { text('error', e.message || 'FEN غير صالح.'); }
  });
  $('setup').addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (!reading) throw new Error('لم يتم العثور على رقعة.');
      const castling = [...$('castling').querySelectorAll('input:checked')].map(input => input.value).join('') || '-';
      const fen = positionFromPieces(reading.placement, { turn: $('turn').value, castling, epSquare: $('ep').value.trim().toLowerCase() || '-' });
      position = tracker.resolve(reading, fen); visualAssumptions = false; directState = null; lastKey = ''; text('error', ''); analyze(true);
    } catch (e) { lastError = e.message; text('error', e.message); }
  });
  $('turn').addEventListener('change', () => {
    try {
      if (!reading) return;
      const epSquare = visibleEnPassant(reading.lastMove, $('turn').value); $('ep').value = epSquare;
      const fen = positionFromPieces(reading.placement, { turn: $('turn').value, epSquare });
      position = tracker.resolve(reading, fen); tracker.source = position.source = 'من الأحجار · دور محدد';
      visualAssumptions = true; lastKey = ''; text('error', ''); analyze(true);
    } catch (e) { lastError = e.message; text('error', e.message); }
  });
  $('diagnostics').addEventListener('click', async () => {
    const data = { version: VERSION, site: location.hostname, enabled, paused, boardFound: !!reading, boardType: reading?.type, placement: reading?.placement, historyCount: reading?.sans.length, historyFirst: reading?.sans.slice(0, 3), historyLast: reading?.sans.slice(-3), selectedPly: reading?.selectedPly, resolvedFen: position?.fen, positionSource: position?.source, directMethod, enginePendingMs: pendingSince ? Date.now() - pendingSince : 0, lastError };
    const output = JSON.stringify(data, null, 2); $('diagnostics-output').value = output; $('diagnostics-output').hidden = false;
    try { await navigator.clipboard.writeText(output); text('error', 'تم نسخ التشخيص؛ أرسله لفحص سبب التوقف.'); }
    catch { text('error', 'التشخيص ظاهر في المربع؛ يمكنك نسخه يدويًا.'); }
  });
  $('copy').addEventListener('click', async () => {
    try { if (!position) throw new Error('انتظر التقاط وضعية كاملة.'); await navigator.clipboard.writeText(position.fen); text('error', 'تم نسخ FEN.'); }
    catch (e) { text('error', e.message); }
  });
  $('open').addEventListener('click', () => {
    if (!position) { text('error', 'انتظر التقاط وضعية كاملة.'); return; }
    window.open('https://nour-hamada.github.io/chess-insight/#fen=' + encodeURIComponent(position.fen), '_blank', 'noopener');
  });
  let drag;
  shadow.querySelector('header').addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = $('card').getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  });
  shadow.querySelector('header').addEventListener('pointermove', e => {
    if (!drag) return;
    const card = $('card'); card.style.right = card.style.bottom = 'auto';
    card.style.left = Math.max(0, Math.min(innerWidth - card.offsetWidth, e.clientX - drag.x)) + 'px';
    card.style.top = Math.max(0, Math.min(innerHeight - 48, e.clientY - drag.y)) + 'px';
  });
  shadow.querySelector('header').addEventListener('pointerup', () => { drag = null; });
  async function settings() {
    const values = await chrome.storage.local.get({ enabled: true, depth: 14 });
    enabled = values.enabled; depth = Number(values.depth); version++; lastKey = '';
    if (enabled) analyze(true); else clear('التحليل متوقف', 'فعّل الإضافة من أيقونتها في شريط كروم.');
  }
  const onSettingsChanged = (changes, area) => { if (area === 'local' && (changes.enabled || changes.depth)) settings(); };
  chrome.storage.onChanged.addListener(onSettingsChanged);
  const onRuntimeMessage = (message, _sender, respond) => {
    if (message?.type === 'CI_STATUS') { respond({ version: VERSION, found: !!reading, needsPosition: !!reading && !position, fen: position?.fen, paused, enabled }); return false; }
    if (message?.type === 'CI_RESUME') { paused = false; text('pause', 'إيقاف مؤقت'); settings(); respond({ ok: true }); }
    return false;
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  function dispose() {
    if (disposed) return;
    disposed = true; version++; clearTimeout(timer); clearInterval(pollTimer); observer.disconnect();
    document.removeEventListener('ci:position-response', receiveDirectPosition);
    removeEventListener('resize', renderArrow); removeEventListener('scroll', renderArrow, true);
    try { chrome.storage.onChanged.removeListener(onSettingsChanged); chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch {}
    host.remove();
  }
  host.addEventListener('ci:dispose', dispose, { once: true });
  host.addEventListener('ci:refresh', () => { lastKey = ''; analyze(true); });
  settings();
}
