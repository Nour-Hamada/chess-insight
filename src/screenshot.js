import { Chess } from 'chess.js';
import { getPieceSvg } from './pieces.js';
import { recognizeScreenshot, validatePlacement } from './screenshot-recognition.js';

export function initScreenshotFeature({ onApplyFen, onStatus }) {
  const modal = document.getElementById('screenshot-modal');
  const openBtn = document.getElementById('open-screenshot-btn');
  const closeBtn = document.getElementById('close-screenshot-btn');
  const fileInput = document.getElementById('screenshot-file-input');
  const dropzone = document.getElementById('screenshot-dropzone');
  const previewArea = document.getElementById('screenshot-preview-area');
  const imgElement = document.getElementById('screenshot-img-preview');
  const scanStatus = document.getElementById('screenshot-scan-status');
  const miniBoard = document.getElementById('screenshot-mini-board');
  const fenInput = document.getElementById('screenshot-fen-input');
  const turnWhiteBtn = document.getElementById('turn-white-btn');
  const turnBlackBtn = document.getElementById('turn-black-btn');
  const turnWrap = document.querySelector('.turn-select-wrap');
  const turnHint = document.getElementById('turn-hint');
  const evaluateBtn = document.getElementById('screenshot-evaluate-btn');
  const resetBtn = document.getElementById('screenshot-reset-btn');
  const piecePalette = document.getElementById('screenshot-piece-palette');
  const cropOverlay = document.getElementById('screenshot-crop-overlay');
  const rescanOriginalBtn = document.getElementById('screenshot-rescan-original');

  // Transformation buttons
  const btnRotate180 = document.getElementById('btn-rotate-180');
  const btnSwapColors = document.getElementById('btn-swap-colors');
  const btnFlipV = document.getElementById('btn-flip-v');
  const btnFlipH = document.getElementById('btn-flip-h');
  const btnClearBoard = document.getElementById('btn-clear-board');

  // Brush piece buttons
  const brushButtons = document.querySelectorAll('.tool-piece');

  if (!modal) return;

  // 8x8 piece grid: null or { color: 'w'|'b', type: 'p'|'n'|'b'|'r'|'q'|'k' }
  let currentGrid = createInitialGrid();
  let activeTurn = null; // Chosen explicitly by the user; never assumed.
  let activeSquare = null;
  let currentImageBlob = null;
  let currentImageUrl = null;
  let isScanning = false;
  let scanGeneration = 0;
  let cropStart = null;
  let currentBrush = 'cursor'; // 'cursor', 'none', or piece char 'P', 'b', etc.

  const blankGrid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  

  function createInitialGrid() {
    // Default starting board position as a reliable starting point
    const start = [
      ['r','n','b','q','k','b','n','r'],
      ['p','p','p','p','p','p','p','p'],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      ['P','P','P','P','P','P','P','P'],
      ['R','N','B','Q','K','B','N','R']
    ];
    return start.map(row => row.map(p => {
      if (!p) return null;
      return { color: p === p.toUpperCase() ? 'w' : 'b', type: p.toLowerCase() };
    }));
  }

  function openModal() {
    try {
      if (!modal.open) modal.showModal();
    } catch {
      modal.setAttribute('open', '');
    }
  }

  function closeModal() {
    try {
      if (modal.open) modal.close();
    } catch {
      modal.removeAttribute('open');
    }
    closePalette();
  }

  function resetView() {
    scanGeneration++; // Invalidates a previous asynchronous recognition attempt.
    currentGrid = createInitialGrid();
    clearTurnChoice();
    activeSquare = null;
    currentImageBlob = null;
    currentImageUrl = null;
    isScanning = false;
    if (cropOverlay) cropOverlay.hidden = true;
    currentBrush = 'cursor';
    updateBrushActiveState();
    dropzone.hidden = false;
    previewArea.hidden = true;
    imgElement.src = '';
    fenInput.value = '';
    scanStatus.textContent = '';
    scanStatus.className = 'screenshot-status';
    closePalette();
    renderMiniBoardFromGrid();
    updateFenFromGrid();
  }

  openBtn?.addEventListener('click', () => {
    openModal();
  });

  closeBtn?.addEventListener('click', closeModal);
  resetBtn?.addEventListener('click', resetView);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      const rect = modal.querySelector('.screenshot-modal-content')?.getBoundingClientRect();
      if (rect) {
        const clickedInside = (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        );
        if (!clickedInside) {
          closeModal();
        }
      }
    }
  });

  // Global Paste Handler (Ctrl + V)
  window.addEventListener('paste', (e) => {
    const target = e.target;
    if (target && target.tagName === 'INPUT' && target !== fenInput && target.type === 'text') {
      return;
    }

    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          e.stopPropagation();
          openModal();
          handleImageInput(file);
          return;
        }
      }
    }
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-active');
    });
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-active'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-active');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && files[0].type.startsWith('image/')) {
      handleImageInput(files[0]);
    }
  });

  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleImageInput(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  // Drag over the original image to crop a square board, then retry recognition.
  function cropRectFromPointer(e) {
    const r = imgElement.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }

  function drawCropSelection(start, end) {
    const rect = imgElement.getBoundingClientRect();
    const stage = imgElement.parentElement.getBoundingClientRect();
    // A square in real pixels (NOT in 0..1 normalized coordinates).
    const sidePx = Math.min(
      Math.abs(end.x - start.x) * rect.width,
      Math.abs(end.y - start.y) * rect.height,
    );
    const width = sidePx / rect.width;
    const height = sidePx / rect.height;
    const x = end.x < start.x ? start.x - width : start.x;
    const y = end.y < start.y ? start.y - height : start.y;
    if (cropOverlay) {
      cropOverlay.hidden = false;
      Object.assign(cropOverlay.style, {
        left: (rect.left - stage.left + x * rect.width) + 'px',
        top: (rect.top - stage.top + y * rect.height) + 'px',
        width: sidePx + 'px',
        height: sidePx + 'px',
      });
    }
    return { x, y, width, height, sidePx };
  }

  imgElement.addEventListener('pointerdown', e => {
    if (!currentImageBlob || isScanning || e.button !== 0) return;
    cropStart = cropRectFromPointer(e);
    imgElement.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  imgElement.addEventListener('pointermove', e => {
    if (!cropStart) return;
    drawCropSelection(cropStart, cropRectFromPointer(e));
  });
  imgElement.addEventListener('pointercancel', () => {
    cropStart = null;
    if (cropOverlay) cropOverlay.hidden = true;
  });
  imgElement.addEventListener('pointerup', async e => {
    if (!cropStart) return;
    const selection = drawCropSelection(cropStart, cropRectFromPointer(e));
    cropStart = null;
    if (selection.sidePx < 32 || !imgElement.naturalWidth) {
      if (cropOverlay) cropOverlay.hidden = true;
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 768;
    canvas.getContext('2d').drawImage(imgElement,
      selection.x * imgElement.naturalWidth,
      selection.y * imgElement.naturalHeight,
      selection.width * imgElement.naturalWidth,
      selection.height * imgElement.naturalHeight,
      0, 0, 768, 768);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (blob) await scanImage(blob, true);
    if (cropOverlay) cropOverlay.hidden = true;
  });
  rescanOriginalBtn?.addEventListener('click', () => {
    if (currentImageBlob) scanImage(currentImageBlob, false);
  });

  // Turn toggles
  turnWhiteBtn?.addEventListener('click', () => setTurn('w'));
  turnBlackBtn?.addEventListener('click', () => setTurn('b'));

  function setTurn(turn) {
    activeTurn = turn;
    syncTurnUi();
    updateFenFromGrid();
  }

  function clearTurnChoice() {
    activeTurn = null;
    syncTurnUi();
  }

  // The side to move changes the whole evaluation, so it is always the user's explicit choice.
  function syncTurnUi() {
    turnWhiteBtn?.classList.toggle('active', activeTurn === 'w');
    turnBlackBtn?.classList.toggle('active', activeTurn === 'b');
    turnWhiteBtn?.setAttribute('aria-pressed', String(activeTurn === 'w'));
    turnBlackBtn?.setAttribute('aria-pressed', String(activeTurn === 'b'));
    turnWrap?.classList.toggle('needs-choice', !activeTurn);
    if (!turnHint) return;
    if (!activeTurn) {
      turnHint.textContent = '⚠️ اختر من هو صاحب الدور (من سيلعب الآن) قبل التقييم.';
      turnHint.dataset.tone = 'warn';
    } else {
      turnHint.textContent = '';
      turnHint.dataset.tone = '';
    }
  }

  // Transformation Tool Buttons
  btnRotate180?.addEventListener('click', () => {
    currentGrid = rotateGrid180(currentGrid);
    renderMiniBoardFromGrid();
    updateFenFromGrid();
    scanStatus.textContent = '🔄 تم تدوير الرقعة 180° بنجاح.';
    scanStatus.className = 'screenshot-status';
  });

  btnSwapColors?.addEventListener('click', () => {
    currentGrid = swapGridColors(currentGrid);
    renderMiniBoardFromGrid();
    updateFenFromGrid();
    scanStatus.textContent = '⚖️ تم تبديل ألوان القطع (الأبيض ⇋ الأسود).';
    scanStatus.className = 'screenshot-status';
  });

  btnFlipV?.addEventListener('click', () => {
    currentGrid = flipGridV(currentGrid);
    renderMiniBoardFromGrid();
    updateFenFromGrid();
    scanStatus.textContent = '⇅ تم عكس الصفوف رأسياً.';
    scanStatus.className = 'screenshot-status';
  });

  btnFlipH?.addEventListener('click', () => {
    currentGrid = flipGridH(currentGrid);
    renderMiniBoardFromGrid();
    updateFenFromGrid();
    scanStatus.textContent = '⇄ تم عكس الأعمدة أفقياً.';
    scanStatus.className = 'screenshot-status';
  });

  btnClearBoard?.addEventListener('click', () => {
    currentGrid = Array(8).fill(null).map(() => Array(8).fill(null));
    renderMiniBoardFromGrid();
    updateFenFromGrid();
    scanStatus.textContent = '🗑️ تم تفريغ الرقعة. يمكنك ختم القطع بالنقر عليها.';
    scanStatus.className = 'screenshot-status';
  });

  // Brush piece buttons handling
  function updateBrushActiveState() {
    brushButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.brush === currentBrush);
    });
  }

  brushButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentBrush = btn.dataset.brush;
      updateBrushActiveState();
      closePalette();
    });
  });

  // FEN manual editing
  fenInput?.addEventListener('input', () => {
    const val = fenInput.value.trim();
    if (!val) return;
    try {
      const parts = val.split(/\s+/);
      if (parts[1] === 'b' || parts[1] === 'w') {
        activeTurn = parts[1];
        syncTurnUi();
      }
      if (!validatePlacement(parts[0]).ok) return;
      gridFromPlacement(parts[0]);
      renderMiniBoardFromGrid();
      validateSubmit();
    } catch {}
  });

  // Evaluate Button Action
  evaluateBtn?.addEventListener('click', () => {
    const fen = getNormalizedLegalFen();
    if (!activeTurn) {
      scanStatus.textContent = 'اختر أولاً من هو صاحب الدور (⚪ أبيض أو ⚫ أسود).';
      scanStatus.className = 'screenshot-status error';
      return;
    }
    if (!fen) {
      scanStatus.textContent = 'الوضعية غير مكتملة. تأكد من وجود ملك أبيض وملك أسود على الرقعة.';
      scanStatus.className = 'screenshot-status error';
      return;
    }
    closeModal();
    if (openBtn) {
      openBtn.classList.add('has-screenshot');
      openBtn.innerHTML = '📷 سكرين شوت (عرض / تعديل)';
    }
    onApplyFen(fen, currentImageBlob);
  });

  // Grid Transformation Helpers
  function rotateGrid180(grid) {
    let newGrid = Array(8).fill(null).map(() => Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        newGrid[7 - r][7 - c] = grid[r][c] ? { ...grid[r][c] } : null;
      }
    }
    return newGrid;
  }

  function flipGridV(grid) {
    let newGrid = Array(8).fill(null).map(() => Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        newGrid[7 - r][c] = grid[r][c] ? { ...grid[r][c] } : null;
      }
    }
    return newGrid;
  }

  function flipGridH(grid) {
    let newGrid = Array(8).fill(null).map(() => Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        newGrid[r][7 - c] = grid[r][c] ? { ...grid[r][c] } : null;
      }
    }
    return newGrid;
  }

  function swapGridColors(grid) {
    let newGrid = Array(8).fill(null).map(() => Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (grid[r][c]) {
          newGrid[r][c] = {
            color: grid[r][c].color === 'w' ? 'b' : 'w',
            type: grid[r][c].type
          };
        } else {
          newGrid[r][c] = null;
        }
      }
    }
    return newGrid;
  }

  // Only a trained per-square classifier may label pieces. No invented
  // bishops, no color-threshold-to-piece guesses, and no auto-inserted kings.
  async function handleImageInput(file) {
    if (!file) return;
    currentImageBlob = file;
    currentGrid = blankGrid();
    clearTurnChoice();
    renderMiniBoardFromGrid();
    updateFenFromGrid();
    dropzone.hidden = true;
    previewArea.hidden = false;

    if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
    currentImageUrl = URL.createObjectURL(file);
    imgElement.src = currentImageUrl;
    imgElement.draggable = false;
    if (cropOverlay) cropOverlay.hidden = true;
    await scanImage(file, false);
  }

  async function scanImage(file, cropped) {
    const sequence = ++scanGeneration;
    isScanning = true;
    validateSubmit();
    scanStatus.textContent = cropped
      ? '⏳ جارٍ تحليل الرقعة المحددة باستخدام نموذج التعرّف البصري…'
      : '⏳ جارٍ اكتشاف حدود الرقعة وقراءة المربعات الـ64…';
    scanStatus.className = 'screenshot-status loading';
    try {
      // A browser-side ONNX neural model detects board bounds and each piece.
      // The screenshot itself never leaves the user's browser.
      const result = await recognizeScreenshot(file);
      if (sequence !== scanGeneration) return;
      if (result.placement) {
        gridFromPlacement(result.placement);
            renderMiniBoardFromGrid();
        updateFenFromGrid();
        scanStatus.textContent = '✅ تم استخراج الوضعية بنجاح! حدد صاحب الدور واضغط تقييم.';
        scanStatus.className = 'screenshot-status success';
      } else {
        currentGrid = blankGrid(); // Never display the starting board as a detected result.
            renderMiniBoardFromGrid();
        updateFenFromGrid();
        scanStatus.textContent = '⚠️ ' + (result.reason || 'تعذر التعرّف بشكل موثوق.') +
          ' اسحب مربعاً يحيط بالرقعة في الصورة لإعادة الفحص، أو أدخل القطع يدوياً.';
        scanStatus.className = 'screenshot-status warning';
      }
    } catch (error) {
      if (sequence !== scanGeneration) return;
      currentGrid = blankGrid();
        renderMiniBoardFromGrid();
      updateFenFromGrid();
      scanStatus.textContent = '⚠️ تعذر تحميل نموذج التعرف البصري. تأكد من اتصال الإنترنت، ثم اضغط «إعادة فحص الأصل» أو أدخل القطع يدوياً.';
      scanStatus.className = 'screenshot-status warning';
      console.warn('Chess screenshot recognition unavailable:', error);
    } finally {
      if (sequence === scanGeneration) {
        isScanning = false;
        validateSubmit();
      }
    }
  }

  function gridFromPlacement(placement) {
    const validation = validatePlacement(placement);
    if (!validation.ok) throw new Error(validation.reason);
    currentGrid = placement.split('/').map(row => {
      const cells = [];
      for (const char of row) {
        if (/^[1-8]$/.test(char)) {
          for (let i = 0; i < Number(char); i++) cells.push(null);
        } else {
          cells.push({
            color: char === char.toUpperCase() ? 'w' : 'b',
            type: char.toLowerCase(),
          });
        }
      }
      return cells;
    });
  }

  function gridToPlacement() {
    return currentGrid.map(row => {
      let str = '';
      let empty = 0;
      for (const cell of row) {
        if (!cell) empty++;
        else {
          if (empty > 0) { str += empty; empty = 0; }
          str += cell.color === 'w' ? cell.type.toUpperCase() : cell.type.toLowerCase();
        }
      }
      if (empty > 0) str += empty;
      return str || '8';
    }).join('/');
  }

  function updateFenFromGrid() {
    const placement = gridToPlacement();
    if (fenInput) fenInput.value = activeTurn ? `${placement} ${activeTurn} - - 0 1` : placement;
    validateSubmit();
  }

  function getNormalizedLegalFen() {
    const placement = gridToPlacement();
    if (!activeTurn || !validatePlacement(placement).ok) return null;
    try {
      const fen = `${placement} ${activeTurn} - - 0 1`;
      const board = new Chess(fen);
      // The opponent (the player who just moved) cannot be in check.
      const opposite = new Chess(`${placement} ${activeTurn === 'w' ? 'b' : 'w'} - - 0 1`);
      if (opposite.isCheck()) {
        if (turnHint) { turnHint.textContent = '❌ هذا الدور غير ممكن: ملك الخصم مهدد بالفعل. جرّب اللون الآخر.'; turnHint.dataset.tone = 'error'; }
        return null;
      }
      return board.fen();
    } catch { return null; }
  }

  function validateSubmit() {
    const fen = getNormalizedLegalFen();
    const allowed = Boolean(fen && !isScanning);
    if (evaluateBtn) {
      evaluateBtn.disabled = !allowed;
      evaluateBtn.classList.toggle('pulse-ready', allowed);
    }
  }

  // Render 8x8 Mini Interactive Board with click-to-edit
  function renderMiniBoardFromGrid() {
    if (!miniBoard) return;
    miniBoard.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = document.createElement('div');
        const isDark = (r + c) % 2 === 1;
        sq.className = `mini-sq ${isDark ? 'dark' : 'light'}`;
        sq.dataset.row = r;
        sq.dataset.col = c;
        const file = 'abcdefgh'[c];
        const rank = 8 - r;
        const squareName = `${file}${rank}`;
        sq.title = `${squareName}: انقر لتعديل القطعة`;

        // Rank number on leftmost column
        if (c === 0) {
          const rLabel = document.createElement('span');
          rLabel.className = 'mini-rank-label';
          rLabel.textContent = rank;
          sq.appendChild(rLabel);
        }

        // File letter on bottom rank
        if (r === 7) {
          const fLabel = document.createElement('span');
          fLabel.className = 'mini-file-label';
          fLabel.textContent = file;
          sq.appendChild(fLabel);
        }

        const piece = currentGrid[r][c];
        if (piece) {
          const svgWrap = document.createElement('div');
          svgWrap.className = 'mini-piece-svg';
          svgWrap.innerHTML = getPieceSvg(piece.color, piece.type);
          sq.appendChild(svgWrap);
        }

        sq.addEventListener('click', (e) => {
          e.stopPropagation();
          handleSquareClick(sq, r, c);
        });

        miniBoard.appendChild(sq);
      }
    }
  }

  // Fast Square Click: applies brush immediately, or opens popup if cursor mode
  function handleSquareClick(sq, r, c) {
    if (currentBrush === 'none') {
      currentGrid[r][c] = null;
        renderMiniBoardFromGrid();
      updateFenFromGrid();
    } else if (currentBrush !== 'cursor') {
      currentGrid[r][c] = {
        color: currentBrush === currentBrush.toUpperCase() ? 'w' : 'b',
        type: currentBrush.toLowerCase()
      };
        renderMiniBoardFromGrid();
      updateFenFromGrid();
    } else {
      openPaletteForSquare(sq, r, c);
    }
  }

  // Piece Palette Popup
  function openPaletteForSquare(sq, r, c) {
    if (!piecePalette) return;
    activeSquare = { r, c, element: sq };
    const rect = sq.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();

    piecePalette.style.top = `${rect.bottom - modalRect.top + 4}px`;
    piecePalette.style.left = `${Math.min(rect.left - modalRect.left, modalRect.width - 240)}px`;
    piecePalette.hidden = false;

    document.querySelectorAll('.mini-sq').forEach(el => el.classList.remove('selected'));
    sq.classList.add('selected');
  }

  function closePalette() {
    if (piecePalette) piecePalette.hidden = true;
    activeSquare = null;
    document.querySelectorAll('.mini-sq').forEach(el => el.classList.remove('selected'));
  }

  // Close palette when clicking anywhere else
  document.addEventListener('click', (e) => {
    if (piecePalette && !piecePalette.hidden && !piecePalette.contains(e.target) && !e.target.closest('.mini-sq')) {
      closePalette();
    }
  });

  piecePalette?.querySelectorAll('[data-piece]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!activeSquare) return;
      const code = btn.dataset.piece; // 'P', 'p', 'none', etc.
      if (code === 'none') {
        currentGrid[activeSquare.r][activeSquare.c] = null;
      } else {
        currentGrid[activeSquare.r][activeSquare.c] = {
          color: code === code.toUpperCase() ? 'w' : 'b',
          type: code.toLowerCase()
        };
      }
      closePalette();
        renderMiniBoardFromGrid();
      updateFenFromGrid();
    });
  });

  syncTurnUi();

  // Initial render
  renderMiniBoardFromGrid();
  updateFenFromGrid();
}
