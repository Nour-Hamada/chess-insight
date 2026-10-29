import { recognizeGrayscaleBoard } from './grayscale-board-recognition.js';
// Local, confidence-aware screenshot recognition. No chess image is uploaded.
// ONNX model and WASM assets are served by Chess Insight, not third-party CDNs.
const getStaticBase = () => new URL('.', document.baseURI).href;
let recognizerPromise;

export function validatePlacement(placement) {
  if (typeof placement !== 'string') return { ok: false, reason: 'الترميز غير معروف.' };
  const rows = placement.trim().split('/');
  if (rows.length !== 8) return { ok: false, reason: 'يجب أن تحتوي الرقعة على 8 صفوف.' };
  const counts = { K: 0, k: 0, P: 0, p: 0, white: 0, black: 0 };
  const kings = [];
  for (let r = 0; r < 8; r++) {
    let columns = 0;
    for (const token of rows[r]) {
      if (/^[1-8]$/.test(token)) { columns += Number(token); continue; }
      if (!/^[pnbrqkPNBRQK]$/.test(token)) return { ok: false, reason: 'حرف غير صالح في الرقعة.' };
      if (token === 'P' || token === 'p') {
        if (r === 0 || r === 7) return { ok: false, reason: 'يوجد بيدق على الصف الأول أو الثامن.' };
        counts[token]++;
      }
      counts[token === token.toUpperCase() ? 'white' : 'black']++;
      if (token === 'K' || token === 'k') { counts[token]++; kings.push([r, columns]); }
      columns++;
    }
    if (columns !== 8) return { ok: false, reason: 'بعض الصفوف ليست 8 مربعات.' };
  }
  if (counts.K !== 1 || counts.k !== 1) return { ok: false, reason: 'يجب اكتشاف ملك واحد لكل لون، دون إضافته افتراضياً.' };
  if (counts.P > 8 || counts.p > 8 || counts.white > 16 || counts.black > 16) {
    return { ok: false, reason: 'عدد القطع غير ممكن في مباراة شطرنج.' };
  }
  // Extra major/minor pieces require a pawn to have promoted.
  // A snapshot with five bishops and all eight pawns is impossible.
  for (const color of ['w', 'b']) {
    const make = type => color === 'w' ? type.toUpperCase() : type;
    const countsOf = piece => [...placement].filter(c => c === piece).length;
    const missingPawns = 8 - countsOf(make('p'));
    const extra = Math.max(0, countsOf(make('q')) - 1)
      + Math.max(0, countsOf(make('r')) - 2)
      + Math.max(0, countsOf(make('b')) - 2)
      + Math.max(0, countsOf(make('n')) - 2);
    if (extra > missingPawns) return { ok: false, reason: 'ترقيات قطع غير ممكنة مقارنة بعدد البيادق.' };
  }
  if (Math.abs(kings[0][0] - kings[1][0]) <= 1 && Math.abs(kings[0][1] - kings[1][1]) <= 1) {
    return { ok: false, reason: 'الملكان متجاوران.' };
  }
  return { ok: true, reason: '' };
}

async function getRecognizer() {
  if (!recognizerPromise) {
    recognizerPromise = import('@scoriiu/fenshot').then(({ createRecognizer, resolveOrientation }) => ({
      recognizer: createRecognizer({
        modelUrl: new URL('models/chess-tiles-v2.onnx', getStaticBase()).href,
        wasmPaths: new URL('ort/', getStaticBase()).href,
      }),
      resolveOrientation,
    })).catch(error => {
      recognizerPromise = null; // A transient CDN failure must be retryable.
      throw error;
    });
  }
  return recognizerPromise;
}

async function cropModelBoard(source, corners) {
  if (!corners || !('createImageBitmap' in window)) return null;
  const img = await createImageBitmap(source);
  try {
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const x = Math.max(0, corners.x0 / scale);
    const y = Math.max(0, corners.y0 / scale);
    const width = Math.min(img.width - x, (corners.x1 - corners.x0) / scale);
    const height = Math.min(img.height - y, (corners.y1 - corners.y0) / scale);
    if (width < 140 || height < 140 || Math.abs(width - height) > Math.max(width, height) * .08) return null;
    const c = document.createElement('canvas');
    c.width = 752;
    c.height = 752;
    c.getContext('2d').drawImage(img, x, y, width, height, 0, 0, 752, 752);
    return await new Promise(resolve => c.toBlob(resolve, 'image/png'));
  } finally { img.close?.(); }
}

export async function recognizeScreenshot(source) {
  // First handle the user's exact neutral-gray chess.com piece style using
  // shape comparison; do not let the more generic ONNX model hallucinate bishops.
  try {
    const local = await recognizeGrayscaleBoard(source);
    if (local && validatePlacement(local.placement).ok) return local;
  } catch (error) {
    console.debug('Grayscale recognition skipped:', error);
  }
  const { recognizer, resolveOrientation } = await getRecognizer();
  const result = await recognizer.recognize(source);
  if (!result) return { placement: null, reliable: false, reason: 'لم يُكتشف إطار رقعة 8×8 في الصورة.' };
  // For full-browser screenshots, use the neural detector's crop and
  // re-run the deterministic grayscale piece matcher on that exact board.
  try {
    const cropped = await cropModelBoard(source, result.corners);
    if (cropped) {
      const local = await recognizeGrayscaleBoard(cropped);
      if (local && validatePlacement(local.placement).ok) return local;
    }
  } catch (error) {
    console.debug('Model-cropped grayscale recognition skipped:', error);
  }
  const oriented = resolveOrientation(result.placement);
  const placement = oriented.placement;
  const validation = validatePlacement(placement);
  return {
    placement: validation.ok ? placement : null,
    reliable: Boolean(result.reliable && result.plausible && validation.ok),
    reason: validation.reason || (!result.reliable || !result.plausible ?
      'بعض القطع غير مؤكدة، لن نعتمد النتيجة تلقائياً.' : ''),
    meanConfidence: result.meanConfidence,
    minConfidence: result.minConfidence,
    orientation: oriented.orientation,
    method: 'onnx-vision',
  };
}
