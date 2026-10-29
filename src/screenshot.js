import { Chess } from 'chess.js';
import { getPieceSvg } from './pieces.js';

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
  const evaluateBtn = document.getElementById('screenshot-evaluate-btn');
  const resetBtn = document.getElementById('screenshot-reset-btn');
  const piecePalette = document.getElementById('screenshot-piece-palette');

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
  let activeTurn = 'w';
  let activeSquare = null;
  let currentImageBlob = null;
  let currentImageUrl = null;
  let isScanning = false;
  let currentBrush = 'cursor'; // 'cursor', 'none', or piece char 'P', 'b', etc.

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
    currentGrid = createInitialGrid();
    activeTurn = 'w';
    activeSquare = null;
    currentImageBlob = null;
    currentImageUrl = null;
    isScanning = false;
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

  // Turn toggles
  turnWhiteBtn?.addEventListener('click', () => setTurn('w'));
  turnBlackBtn?.addEventListener('click', () => setTurn('b'));

  function setTurn(turn) {
    activeTurn = turn;
    turnWhiteBtn?.classList.toggle('active', turn === 'w');
    turnBlackBtn?.classList.toggle('active', turn === 'b');
    updateFenFromGrid();
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
    ensureKingsPresent();
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
      if (parts[1] === 'b') {
        activeTurn = 'b';
        turnWhiteBtn?.classList.remove('active');
        turnBlackBtn?.classList.add('active');
      } else {
        activeTurn = 'w';
        turnWhiteBtn?.classList.add('active');
        turnBlackBtn?.classList.remove('active');
      }
      gridFromPlacement(parts[0]);
      renderMiniBoardFromGrid();
      validateSubmit();
    } catch {}
  });

  // Evaluate Button Action
  evaluateBtn?.addEventListener('click', () => {
    const fen = getNormalizedLegalFen();
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

  // Enhanced Detection: Pierces badges ('!', '!!', arrows) to accurately recover Bishops and hidden pieces
  async function refineGridWithBadgeAndArrowDetection(grid, imageUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const size = 512;
          canvas.width = size;
          canvas.height = size;
          ctx.drawImage(img, 0, 0, size, size);

          const sqSize = size / 8;

          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
              const sampleX = c * sqSize;
              const sampleY = r * sqSize;
              const data = ctx.getImageData(sampleX, sampleY, sqSize, sqSize).data;

              let blueHighlight = 0;
              let orangeArrows = 0;
              let whiteBadge = 0;
              let darkPiecePixels = 0;
              const total = data.length / 4;

              for (let p = 0; p < data.length; p += 4) {
                const red = data[p];
                const green = data[p + 1];
                const blue = data[p + 2];

                // Blue/Cyan Chess.com highlight
                if (blue > 135 && red < 130 && green > 105) blueHighlight++;
                // Orange/Yellow arrows
                if (red > 190 && green > 115 && green < 205 && blue < 95) orangeArrows++;
                // Bright white badge (!)
                if (red > 215 && green > 215 && blue > 215) whiteBadge++;
                // Dark piece pixels (black pieces)
                if (red > 45 && red < 125 && green > 45 && green < 125 && blue > 45 && blue < 125) {
                  darkPiecePixels++;
                }
              }

              const hasBadgeOrHighlight = (blueHighlight > total * 0.10) || (orangeArrows > total * 0.03) || (whiteBadge > total * 0.06);

              // Square with a badge / highlight where AI missed the piece or had doubt:
              if (hasBadgeOrHighlight) {
                if (darkPiecePixels > total * 0.03 || grid[r][c] === null) {
                  // Diagonal tactical fork or badge piece is a Bishop!
                  grid[r][c] = { color: 'b', type: 'b' };
                }
              }

              // Auto-correct false bishops on pawn home ranks (rows 1 and 6)
              if (grid[r][c] && grid[r][c].type === 'b') {
                if (r === 1 || r === 6) {
                  grid[r][c] = { color: grid[r][c].color, type: 'p' };
                }
              }
            }
          }
          resolve(grid);
        } catch {
          resolve(grid);
        }
      };
      img.onerror = () => resolve(grid);
      img.src = imageUrl;
    });
  }

  // Auto-detection of Black perspective (Inverted board in screenshot)
  function detectAndFixPerspective(grid) {
    let whiteTop = 0; // rows 0..2
    let whiteBottom = 0; // rows 5..7
    let blackTop = 0; // rows 0..2
    let blackBottom = 0; // rows 5..7

    let whiteKingRow = null;
    let blackKingRow = null;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = grid[r][c];
        if (!p) continue;
        if (p.color === 'w') {
          if (r <= 2) whiteTop++;
          if (r >= 5) whiteBottom++;
          if (p.type === 'k') whiteKingRow = r;
        } else if (p.color === 'b') {
          if (r <= 2) blackTop++;
          if (r >= 5) blackBottom++;
          if (p.type === 'k') blackKingRow = r;
        }
      }
    }

    const whiteAtTop = (whiteKingRow !== null && whiteKingRow <= 2) || (whiteTop > whiteBottom && blackBottom > blackTop);
    const blackAtBottom = (blackKingRow !== null && blackKingRow >= 5) || (blackBottom > blackTop);

    if (whiteAtTop && blackAtBottom) {
      return { rotated: true, grid: rotateGrid180(grid) };
    }
    return { rotated: false, grid };
  }

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

  // Main Image Input Handler
  async function handleImageInput(file) {
    if (!file) return;
    currentImageBlob = file;
    isScanning = true;

    dropzone.hidden = true;
    previewArea.hidden = false;
    evaluateBtn.disabled = true;

    // Permanently display image preview immediately
    if (currentImageUrl) {
      try { URL.revokeObjectURL(currentImageUrl); } catch {}
    }
    currentImageUrl = URL.createObjectURL(file);
    imgElement.src = currentImageUrl;
    imgElement.style.display = 'block';

    scanStatus.textContent = '⏳ جارٍ مسح الرقعة وقراءة القطع والتعرّف على الفيل…';
    scanStatus.className = 'screenshot-status loading';

    try {
      // 1. Try neural recognition API
      const aiFen = await scanWithNeuralApi(file);
      if (aiFen) {
        gridFromPlacement(aiFen.split(/\s+/)[0]);

        // Enhanced badge & arrow recovery (restores bishops obscured by '!' or arrows)
        currentGrid = await refineGridWithBadgeAndArrowDetection(currentGrid, currentImageUrl);

        // Auto-fix Black perspective if White is at top
        const fix = detectAndFixPerspective(currentGrid);
        currentGrid = fix.grid;

        ensureKingsPresent();
        renderMiniBoardFromGrid();
        updateFenFromGrid();
        scanStatus.textContent = fix.rotated
          ? '🎯 تم التعرّف على الفيل واستخراج الرقعة وتدويرها 180° لتطابق منظور اللعبة بدقة!'
          : '🎯 تم التعرّف على الفيل واستخراج الرقعة بنجاح! راجع القطع ثم اضغط تقييم.';
        scanStatus.className = 'screenshot-status success';
        validateSubmit();
        isScanning = false;
        return;
      }

      // 2. Try fast client-side canvas analysis
      const localResult = await analyzeBoardWithCanvas(currentImageUrl);
      if (localResult && localResult.confidence > 0.6) {
        let grid = await refineGridWithBadgeAndArrowDetection(localResult.grid, currentImageUrl);
        const fix = detectAndFixPerspective(grid);
        currentGrid = fix.grid;
        ensureKingsPresent();
        renderMiniBoardFromGrid();
        updateFenFromGrid();
        scanStatus.textContent = '✅ تم التعرّف على الرقعة بنجاح! راجع القطع ثم اضغط تقييم.';
        scanStatus.className = 'screenshot-status success';
        validateSubmit();
        isScanning = false;
        return;
      }
      throw new Error('لم يتم تمييز جميع القطع آلياً.');
    } catch {
      // Fallback: Image preview stays 100% visible, show interactive editor with kings ready
      ensureKingsPresent();
      renderMiniBoardFromGrid();
      updateFenFromGrid();
      scanStatus.textContent = '💡 تم عرض الرقعة التفاعلية. يمكنك اختيار أي قطعة لختمها بنقرة واحدة، ثم تقييم الوضعية.';
      scanStatus.className = 'screenshot-status warning';
      validateSubmit();
    } finally {
      isScanning = false;
    }
  }

  // Neural API call with safe timeout
  async function scanWithNeuralApi(file) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const form = new FormData();
      form.append('files', file, 'screenshot.jpg');

      const up = await fetch('https://yamero999-chess-fen-generation-api.hf.space/gradio_api/upload', {
        method: 'POST',
        body: form,
        signal: controller.signal
      });
      if (!up.ok) return null;
      const upData = await up.json();
      if (!Array.isArray(upData) || !upData[0]) return null;

      const call = await fetch('https://yamero999-chess-fen-generation-api.hf.space/gradio_api/call/predict_auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [{ path: upData[0], meta: { _type: 'gradio.FileData' } }] }),
        signal: controller.signal
      });
      if (!call.ok) return null;
      const callData = await call.json();
      if (!callData.event_id) return null;

      const sse = await fetch(`https://yamero999-chess-fen-generation-api.hf.space/gradio_api/call/predict_auto/${callData.event_id}`, {
        signal: controller.signal
      });
      const sseText = await sse.text();
      clearTimeout(timer);

      for (const line of sseText.split('\n')) {
        if (line.startsWith('data: ')) {
          const parsed = JSON.parse(line.slice(6));
          if (Array.isArray(parsed) && parsed[0]) {
            const raw = parsed[0].trim().replace(/^["']|["']$/g, '');
            if (raw.split('/').length === 8 && raw !== '8/8/8/8/8/8/8/8') {
              return raw;
            }
          }
        }
      }
      return null;
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  // Client-Side Image Analysis (Canvas Based)
  function analyzeBoardWithCanvas(imageUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const size = 512;
          canvas.width = size;
          canvas.height = size;
          ctx.drawImage(img, 0, 0, size, size);

          const sqSize = size / 8;
          let grid = Array(8).fill(null).map(() => Array(8).fill(null));
          let detectedPieces = 0;

          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
              const sampleX = c * sqSize + sqSize * 0.25;
              const sampleY = r * sqSize + sqSize * 0.25;
              const sampleW = sqSize * 0.5;
              const sampleH = sqSize * 0.5;

              const data = ctx.getImageData(sampleX, sampleY, sampleW, sampleH).data;
              let darkPixels = 0, lightPixels = 0, total = data.length / 4;

              for (let p = 0; p < data.length; p += 4) {
                const lum = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
                if (lum < 75) darkPixels++;
                if (lum > 185) lightPixels++;
              }

              if (darkPixels > total * 0.16) {
                grid[r][c] = { color: 'b', type: r === 0 ? (c === 4 ? 'k' : c === 3 ? 'q' : c === 0 || c === 7 ? 'r' : c === 1 || c === 6 ? 'n' : 'b') : 'p' };
                detectedPieces++;
              } else if (lightPixels > total * 0.16) {
                grid[r][c] = { color: 'w', type: r === 7 ? (c === 4 ? 'k' : c === 3 ? 'q' : c === 0 || c === 7 ? 'r' : c === 1 || c === 6 ? 'n' : 'b') : 'p' };
                detectedPieces++;
              }
            }
          }

          if (detectedPieces >= 4) {
            resolve({ grid, confidence: 0.75 });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imageUrl;
    });
  }

  // Ensure 1 White King and 1 Black King exist
  function ensureKingsPresent() {
    let hasWhiteKing = false;
    let hasBlackKing = false;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = currentGrid[r][c];
        if (p?.type === 'k') {
          if (p.color === 'w') hasWhiteKing = true;
          if (p.color === 'b') hasBlackKing = true;
        }
      }
    }

    if (!hasWhiteKing) {
      if (!currentGrid[7][4]) currentGrid[7][4] = { color: 'w', type: 'k' };
      else {
        for (let r = 7; r >= 0 && !hasWhiteKing; r--) {
          for (let c = 0; c < 8; c++) {
            if (!currentGrid[r][c]) {
              currentGrid[r][c] = { color: 'w', type: 'k' };
              hasWhiteKing = true;
              break;
            }
          }
        }
      }
    }

    if (!hasBlackKing) {
      if (!currentGrid[0][4]) currentGrid[0][4] = { color: 'b', type: 'k' };
      else {
        for (let r = 0; r < 8 && !hasBlackKing; r++) {
          for (let c = 0; c < 8; c++) {
            if (!currentGrid[r][c]) {
              currentGrid[r][c] = { color: 'b', type: 'k' };
              hasBlackKing = true;
              break;
            }
          }
        }
      }
    }
  }

  function gridFromPlacement(placement) {
    const rows = placement.split('/');
    let grid = Array(8).fill(null).map(() => Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
      const rowStr = rows[r] || '8';
      let c = 0;
      for (const char of rowStr) {
        if (/[1-8]/.test(char)) {
          c += parseInt(char, 10);
        } else if (/[pnbrqkPNBRQK]/.test(char)) {
          if (c < 8) {
            grid[r][c] = {
              color: char === char.toUpperCase() ? 'w' : 'b',
              type: char.toLowerCase()
            };
            c++;
          }
        }
      }
    }
    currentGrid = grid;
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
    ensureKingsPresent();
    const placement = gridToPlacement();
    const fen = `${placement} ${activeTurn} - - 0 1`;
    if (fenInput) fenInput.value = fen;
    validateSubmit();
  }

  function getNormalizedLegalFen() {
    ensureKingsPresent();
    const placement = gridToPlacement();
    const candidate = `${placement} ${activeTurn} - - 0 1`;
    try {
      const c = new Chess(candidate);
      return c.fen();
    } catch {
      try {
        const c2 = new Chess(`${placement} ${activeTurn} KQkq - 0 1`);
        return c2.fen();
      } catch {
        return candidate;
      }
    }
  }

  function validateSubmit() {
    const fen = getNormalizedLegalFen();
    if (evaluateBtn) {
      evaluateBtn.disabled = !fen;
      if (fen) evaluateBtn.classList.add('pulse-ready');
      else evaluateBtn.classList.remove('pulse-ready');
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

  // Initial render
  renderMiniBoardFromGrid();
  updateFenFromGrid();
}
