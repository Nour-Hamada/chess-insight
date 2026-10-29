import { Chess } from 'chess.js';
import { getPieceSvg } from './pieces.js';

const HF_SPACE_URL = 'https://yamero999-chess-fen-generation-api.hf.space';

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

  if (!modal) return;

  let currentFen = '';
  let activeTurn = 'w';
  let activeSquare = null;
  let isScanning = false;

  function openModal() {
    modal.showModal();
    if (!currentFen) resetView();
  }

  function closeModal() {
    modal.close();
    closePalette();
  }

  function resetView() {
    currentFen = '';
    activeTurn = 'w';
    activeSquare = null;
    isScanning = false;
    dropzone.hidden = false;
    previewArea.hidden = true;
    imgElement.src = '';
    fenInput.value = '';
    scanStatus.textContent = '';
    scanStatus.className = 'screenshot-status';
    evaluateBtn.disabled = true;
    closePalette();
  }

  openBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  resetBtn?.addEventListener('click', resetView);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Global Paste Handler (Ctrl + V)
  window.addEventListener('paste', (e) => {
    // If the user is currently editing a normal text input (and not the modal fen), allow normal paste
    const target = e.target;
    const isTextInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target !== dropzone;
    
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          openModal();
          processImageFile(file);
          return;
        }
      }
    }
  });

  // Drag and Drop
  ['dragenter', 'dragover'].forEach(eventName => {
    window.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-active');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-active');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-active');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && files[0].type.startsWith('image/')) {
      processImageFile(files[0]);
    }
  });

  dropzone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      processImageFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  // Turn Selector Buttons
  turnWhiteBtn.addEventListener('click', () => setTurn('w'));
  turnBlackBtn.addEventListener('click', () => setTurn('b'));

  function setTurn(turn) {
    activeTurn = turn;
    turnWhiteBtn.classList.toggle('active', turn === 'w');
    turnBlackBtn.classList.toggle('active', turn === 'b');
    if (currentFen) {
      updateFenWithTurn(turn);
    }
  }

  function updateFenWithTurn(turn) {
    const parts = currentFen.trim().split(/\s+/);
    parts[1] = turn;
    if (!parts[2]) parts[2] = 'KQkq';
    if (!parts[3]) parts[3] = '-';
    if (!parts[4]) parts[4] = '0';
    if (!parts[5]) parts[5] = '1';
    currentFen = parts.join(' ');
    fenInput.value = currentFen;
    renderBoardFromFen(currentFen);
    validateAndEnableSubmit();
  }

  // FEN input manual edit
  fenInput.addEventListener('input', () => {
    const val = fenInput.value.trim();
    if (val) {
      currentFen = val;
      const parts = val.split(/\s+/);
      if (parts[1] === 'b') {
        activeTurn = 'b';
        turnWhiteBtn.classList.remove('active');
        turnBlackBtn.classList.add('active');
      } else {
        activeTurn = 'w';
        turnWhiteBtn.classList.add('active');
        turnBlackBtn.classList.remove('active');
      }
      renderBoardFromFen(currentFen);
      validateAndEnableSubmit();
    }
  });

  // Evaluate Button
  evaluateBtn.addEventListener('click', () => {
    const normalized = getNormalizedLegalFen(fenInput.value.trim() || currentFen);
    if (!normalized) {
      scanStatus.textContent = 'صيغة FEN غير صالحة. تأكد من وجود الملك الأبيض والملك الأسود.';
      scanStatus.className = 'screenshot-status error';
      return;
    }
    closeModal();
    onApplyFen(normalized);
  });

  // Process pasted / selected image
  async function processImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    
    isScanning = true;
    dropzone.hidden = true;
    previewArea.hidden = false;
    evaluateBtn.disabled = true;

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (e) => {
      imgElement.src = e.target.result;
    };
    reader.readAsDataURL(file);

    scanStatus.textContent = '⏳ جارٍ قراءة الرقعة وتحليل القطع بالذكاء الاصطناعي…';
    scanStatus.className = 'screenshot-status loading';

    try {
      // Downscale to max 1024px for lightning fast upload
      const optimizedBlob = await downscaleImage(file, 1024);

      // Recognize via AI vision API
      const detectedFen = await scanChessboardWithAI(optimizedBlob);

      if (detectedFen) {
        currentFen = sanitizeDetectedFen(detectedFen);
        fenInput.value = currentFen;
        scanStatus.textContent = '✅ تم التعرف على رقعة الشطرنج بنجاح!';
        scanStatus.className = 'screenshot-status success';
        renderBoardFromFen(currentFen);
        validateAndEnableSubmit();
      } else {
        throw new Error('لم يتم العثور على رقعة شطرنج واضحة في الصورة.');
      }
    } catch (err) {
      console.warn('Screenshot recognition error:', err);
      scanStatus.textContent = '⚠️ ' + (err.message || 'تعذر استخراج الوضعية. تأكد من وضوح الرقعة، أو أدخل FEN يدوياً.');
      scanStatus.className = 'screenshot-status error';
      // Default to empty board so user can still edit
      currentFen = '8/8/8/8/8/8/8/8 w - - 0 1';
      fenInput.value = currentFen;
      renderBoardFromFen(currentFen);
      validateAndEnableSubmit();
    } finally {
      isScanning = false;
    }
  }

  // Downscale image to limit upload payload
  function downscaleImage(file, maxDimension) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.88);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  // Call HuggingFace Gradio Vision API
  async function scanChessboardWithAI(imageBlob) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 16000);

    try {
      const form = new FormData();
      form.append('files', imageBlob, 'board.jpg');

      const uploadRes = await fetch(`${HF_SPACE_URL}/gradio_api/upload`, {
        method: 'POST',
        body: form,
        signal: controller.signal
      });

      if (!uploadRes.ok) throw new Error('فشل رفع الصورة للمحلل.');
      const uploadData = await uploadRes.json();
      if (!Array.isArray(uploadData) || !uploadData[0]) throw new Error('فشل معالجة مسار الصورة.');

      const filePath = uploadData[0];

      const callRes = await fetch(`${HF_SPACE_URL}/gradio_api/call/predict_auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [{ path: filePath, meta: { _type: 'gradio.FileData' } }]
        }),
        signal: controller.signal
      });

      if (!callRes.ok) throw new Error('تعذر بدء استخراج الوضعية.');
      const callData = await callRes.json();
      const eventId = callData.event_id;
      if (!eventId) throw new Error('لم يتم استلام معرّف المهمة.');

      const sseRes = await fetch(`${HF_SPACE_URL}/gradio_api/call/predict_auto/${eventId}`, {
        signal: controller.signal
      });

      const sseText = await sseRes.text();
      clearTimeout(timeout);

      // Parse SSE lines
      for (const line of sseText.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            if (Array.isArray(parsed) && parsed[0]) {
              return parsed[0];
            }
          } catch {}
        }
      }
      return null;
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  function sanitizeDetectedFen(rawFen) {
    let clean = rawFen.trim();
    // Some models wrap in quotes or return only placement
    clean = clean.replace(/^["']|["']$/g, '');
    const parts = clean.split(/\s+/);
    const placement = parts[0];
    let turn = parts[1] || activeTurn;
    let castling = parts[2] || 'KQkq';
    let enPassant = parts[3] || '-';
    return `${placement} ${turn} ${castling} ${enPassant} 0 1`;
  }

  function getNormalizedLegalFen(fenString) {
    try {
      const parts = fenString.trim().split(/\s+/);
      const placement = parts[0];
      const turn = parts[1] || activeTurn;
      const castling = parts[2] || 'KQkq';
      const enPassant = parts[3] || '-';
      
      // Try full
      try {
        const c = new Chess(`${placement} ${turn} ${castling} ${enPassant} 0 1`);
        return c.fen();
      } catch {
        // Try without castling
        const c2 = new Chess(`${placement} ${turn} - - 0 1`);
        return c2.fen();
      }
    } catch {
      return null;
    }
  }

  function validateAndEnableSubmit() {
    const legal = getNormalizedLegalFen(fenInput.value.trim() || currentFen);
    evaluateBtn.disabled = !legal;
    if (legal) {
      evaluateBtn.classList.add('pulse-ready');
    } else {
      evaluateBtn.classList.remove('pulse-ready');
    }
  }

  // Render 8x8 Mini Interactive Board
  function renderBoardFromFen(fen) {
    miniBoard.innerHTML = '';
    const placement = fen.trim().split(/\s+/)[0];
    const rows = placement.split('/');

    let boardGrid = [];
    for (let r = 0; r < 8; r++) {
      const rowStr = rows[r] || '8';
      let rowPieces = [];
      for (const char of rowStr) {
        if (/[1-8]/.test(char)) {
          for (let empty = 0; empty < parseInt(char, 10); empty++) {
            rowPieces.push(null);
          }
        } else {
          rowPieces.push(char);
        }
      }
      while (rowPieces.length < 8) rowPieces.push(null);
      boardGrid.push(rowPieces.slice(0, 8));
    }

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const squareDiv = document.createElement('div');
        const isDark = (r + c) % 2 === 1;
        squareDiv.className = `mini-sq ${isDark ? 'dark' : 'light'}`;
        squareDiv.dataset.row = r;
        squareDiv.dataset.col = c;

        const pieceChar = boardGrid[r][c];
        if (pieceChar) {
          const color = pieceChar === pieceChar.toUpperCase() ? 'w' : 'b';
          const type = pieceChar.toLowerCase();
          squareDiv.innerHTML = getPieceSvg(color, type);
        }

        squareDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          openPaletteForSquare(squareDiv, r, c, boardGrid);
        });

        miniBoard.appendChild(squareDiv);
      }
    }
  }

  // Interactive Square Piece Palette
  function openPaletteForSquare(squareDiv, r, c, boardGrid) {
    activeSquare = { r, c, element: squareDiv };
    
    // Position palette next to square
    const rect = squareDiv.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();
    
    piecePalette.style.top = `${rect.bottom - modalRect.top + 6}px`;
    piecePalette.style.left = `${Math.min(rect.left - modalRect.left, modalRect.width - 240)}px`;
    piecePalette.hidden = false;

    // Highlight active square
    document.querySelectorAll('.mini-sq').forEach(el => el.classList.remove('selected'));
    squareDiv.classList.add('selected');
  }

  function closePalette() {
    piecePalette.hidden = true;
    activeSquare = null;
    document.querySelectorAll('.mini-sq').forEach(el => el.classList.remove('selected'));
  }

  document.addEventListener('click', (e) => {
    if (!piecePalette.hidden && !piecePalette.contains(e.target) && !e.target.closest('.mini-sq')) {
      closePalette();
    }
  });

  // Palette button listeners
  piecePalette.querySelectorAll('[data-piece]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!activeSquare) return;
      const piece = btn.dataset.piece; // 'P', 'N', 'p', 'none', etc.
      updateSquarePiece(activeSquare.r, activeSquare.c, piece === 'none' ? null : piece);
      closePalette();
    });
  });

  function updateSquarePiece(r, c, newPiece) {
    const placement = currentFen.trim().split(/\s+/)[0];
    const rows = placement.split('/');
    let grid = [];
    for (let row = 0; row < 8; row++) {
      const rowStr = rows[row] || '8';
      let rowPieces = [];
      for (const char of rowStr) {
        if (/[1-8]/.test(char)) {
          for (let empty = 0; empty < parseInt(char, 10); empty++) rowPieces.push(null);
        } else {
          rowPieces.push(char);
        }
      }
      while (rowPieces.length < 8) rowPieces.push(null);
      grid.push(rowPieces);
    }

    grid[r][c] = newPiece;

    // Reconstruct FEN placement
    const newPlacement = grid.map(row => {
      let str = '';
      let emptyCount = 0;
      for (const p of row) {
        if (!p) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            str += emptyCount;
            emptyCount = 0;
          }
          str += p;
        }
      }
      if (emptyCount > 0) str += emptyCount;
      return str || '8';
    }).join('/');

    const parts = currentFen.trim().split(/\s+/);
    parts[0] = newPlacement;
    currentFen = parts.join(' ');
    fenInput.value = currentFen;
    renderBoardFromFen(currentFen);
    validateAndEnableSubmit();
  }
}
