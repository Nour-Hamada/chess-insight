// Local, confidence-aware screenshot recognition. No chess image is uploaded.
const MODEL_CDN = 'https://cdn.jsdelivr.net/npm/@scoriiu/fenshot@0.1.5/model/chess-tiles-v2.onnx';
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';
const ENGINE_ESM = 'https://esm.sh/@scoriiu/fenshot@0.1.5?bundle&target=es2022';
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
  if (Math.abs(kings[0][0] - kings[1][0]) <= 1 && Math.abs(kings[0][1] - kings[1][1]) <= 1) {
    return { ok: false, reason: 'الملكان متجاوران.' };
  }
  return { ok: true, reason: '' };
}

async function getRecognizer() {
  if (!recognizerPromise) {
    recognizerPromise = import(/* @vite-ignore */ ENGINE_ESM).then(({ createRecognizer, resolveOrientation }) => ({
      recognizer: createRecognizer({ modelUrl: MODEL_CDN, wasmPaths: WASM_CDN }),
      resolveOrientation,
    })).catch(error => {
      recognizerPromise = null; // A transient CDN failure must be retryable.
      throw error;
    });
  }
  return recognizerPromise;
}

export async function recognizeScreenshot(source) {
  const { recognizer, resolveOrientation } = await getRecognizer();
  const result = await recognizer.recognize(source);
  if (!result) return { placement: null, reliable: false, reason: 'لم يُكتشف إطار رقعة 8×8 في الصورة.' };
  const oriented = resolveOrientation(result.placement);
  const placement = oriented.placement;
  const validation = validatePlacement(placement);
  return {
    placement: validation.ok ? placement : null,
    reliable: Boolean(result.reliable && validation.ok),
    reason: validation.reason || (!result.reliable ? 'توجد مربعات غير مؤكدة؛ راجع جميع القطع قبل التحليل.' : ''),
    meanConfidence: result.meanConfidence,
    minConfidence: result.minConfidence,
    orientation: oriented.orientation,
  };
}
