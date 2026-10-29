// Additional local classifier for grayscale Chess.com-style boards.
// Templates represent 14×14 signed contrast silhouettes of individual pieces,
// not a memorized chess position. The classifier accepts any valid arrangement.
// The reference masks were distilled from a user-provided chessboard screenshot.
const REFERENCE_ORDER = '.prnbkPRNBQK';
const REFERENCE_PIXELS = 14;
const COMPRESSED_TEMPLATES = 'eNrVlftTUlkcwE+ts9M4ajXm+sgM6GGzW21T8dBqts3adnU0Lu3+QTcfmYkhEl4RLoREimWAhu72cn2XbGGaiaAi0lUBRQTxkTp7z72ANjX7+37nDvd8uOd8z/k+zw6wXXaA/4V8dsydO7fTxjeb22mDok2bJQTf69SfLVqlejEyw3FPjVW8ihChlEnL30Zo85moXLMeVfapt8O/pfpPjUQbjMCITIFVPo9+qqmtqZLRCzdeqJuNqrtlWh+k55qGejVWXXkL/wSATymvrq7GMPHt0tH/NHchtJ0CS6H2/ul6zeCIwQV5QtvU1/rYqC+j9vfqWhpM98VYaQ8k34NGtUQirRLZqaVmqURUXl5WRysa0KnwWrFQQ5NZX4fjWIWapp62ehyX31EtQQi1m7QKRa0Io/abrZFWSSRVFeW9JARNDx8bjEaj/qFm9isnn+rYTm9k+uG1CNgb6mWY5IGbgpDukQrHcanoIySb/B4O5a6KhOWmJiUux3C8RjgAQGd9HS4TiXDypw14xMoakVErhWQCoA0z+vrl5DrsjgnqDHY3NJJGiO+0QaVWXK1QKDBRxTMqRBIoImHZG5gDeJOetMGg1z3/mvtXnhoXt8iqxSxb9EoiHoiCuUmqqWsJw0yDoUpnrOmj6aWpTqzX1UpoamxWSeRaedkKRSYNrtSopGLaNWMSHFdIhRE1LTJ5VaV8KUyjcgzD2uGotbXVVK+TKxRSXVvrE63BYCSjXkUa32Ss+5oRj9XbbDCLS15s0cfywrAN/kciFSFCpxuFajdwY7dLb9xofioR3kQLJx9iN9GiYrS8thQtQm/LlGhTWWFJxa2iVrQQVd0rq+gvLi5BezEURUcqZTcKUZKKSXgF3glLyU8lJUUo+pTc4i+0pLi4uBBF71P1hoblPSRldXWNTCbDpEIvWN/YfvpNqowXfHRtU5VlW945HC11YpPLifkQIVcMlxM7FO0BthgwsBJVtd7fvbSleCKwYotqmd7ksL+1RrVkstmZtsg8PyeLc8r7gYrRWCw3i8dmH117B0sswKbkeDJBlse0O4mS2PWPI18Gwb247BxfCdE5bx947VgLWiw9lPNdsYQldb/B7qE8MQFYGSxmWrp1BlLw9fKsxUI4wzFzxKSl7AIz7eHWk8JgMvas9dLUxSAlDdAZutbFYjGZBwDtirlxxncJCfvAIGVDn3nCPT8/a+8aXiVz1X/0CCWH5+0eMN5hDotp2AvnLr77zAjWjM8dAS+4lnOONeSjyZOP8PlIDqBaQWC/AEFI/pmgLMojx7/w+bnJpEun2ALBFXCGj+SdcJAeFFzY6xnKRvi5XHK7sfhp3wS4xkeusOfoOBy8jiAF3FNUawgkQKVXTh+00rZ//0PmMUYyGKRmXi5ABAIk/8IChFMF+ZQUJNFnm3tvCW4Z0ZeR4IzCsjl+aDSaIR/S4t6sjKyGCy4he+HJj4mOsOc5XOcL3plwTRPneWurWZyecF84zePyeIfDcXDsys7mHv/kitwyiwuEazTS+0a9pIxAsrjdziTO6bNn9zrdbtsqj5d1ng0AJ4vH4+1xxMfFxYXs9hD5ihv+Mpk6u4m53s7wjTQZ3N9pSAIwLu/1Ts8IsE7NO2cJo9mZ/g/QgTECtID+ZI8ZDMy9Te8wpg3O9YIO8PfulwGW08YKNgOyK46Ri5mJicx4Ugfs3YeYDCb5HHg7T1LH3kMwtQ6ALridExxKT01OBH7q4rLCJhpcmOuj0m4yg8FksViMDBeMX/QynfJGbjPg2jIiePBqxDT/rCcIGP7FGQ8sRZAApq2OCRBPDj37EAFyztl9iC9AeMOjv/6275jg4snrl3ZzCoAj9yeb7QiCXJq3puaBiazfMyc78pEMC8jNIgCRg7BP8vk5h/Oy/WROei/DhETyzwOYSwFw7erFC9lnU6i7cXwBpGYwUuIpFwbAH2E5QSQBX/S8Lmfqv8l86ew=';
let templatesPromise;

async function getTemplates() {
  if (!templatesPromise) {
    templatesPromise = (async () => {
      const compressed = Uint8Array.from(atob(COMPRESSED_TEMPLATES), c => c.charCodeAt(0));
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      const count = REFERENCE_ORDER.length * REFERENCE_PIXELS ** 2;
      if (bytes.length !== count) throw new Error('Invalid piece template data');
      return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    })().catch(e => { templatesPromise = null; throw e; });
  }
  return templatesPromise;
}

function median(values) {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}
function toPlacement(pieces) {
  return Array.from({ length: 8 }, (_, row) => {
    let result = '', empty = 0;
    for (let col = 0; col < 8; col++) {
      const piece = pieces[row * 8 + col];
      if (piece === '.') empty++;
      else {
        if (empty) result += empty;
        result += piece;
        empty = 0;
      }
    }
    return result + (empty ? empty : '');
  }).join('/');
}
function grayscaleData(data) {
  const out = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
  }
  return out;
}

export async function recognizeGrayscaleBoard(source) {
  if (!('DecompressionStream' in window) || !('createImageBitmap' in window)) return null;
  const image = await createImageBitmap(source);
  try {
    // This supplemental recognizer is intentionally limited to tightly
    // cropped 2D boards with the same neutral gray chess-piece style.
    if (image.width < 140 || image.height < 140) return null;
    if (Math.abs(image.width - image.height) > Math.max(image.width, image.height) * .06) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 752;
    canvas.height = 752;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, 752, 752);
    const pixels = ctx.getImageData(0, 0, 752, 752).data;
    const gray = grayscaleData(pixels);
    const backgrounds = [];
    let neutralCount = 0;
    const side = 94;

    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const x = col * side, y = row * side;
      const corners = [], neutral = [];
      // Sample strips at all edges to estimate the checkerboard background.
      for (let sy = 4; sy < 90; sy += 3) for (let sx = 4; sx < 90; sx += 3) {
        if (!((sy >= 4 && sy < 14) || (sy >= 80 && sy < 90) ||
              (sx >= 4 && sx < 14) || (sx >= 80 && sx < 90))) continue;
        const z = ((y + sy) * 752 + x + sx);
        corners.push(gray[z]);
        const pixel = z * 4;
        neutral.push(Math.max(pixels[pixel], pixels[pixel+1], pixels[pixel+2]) -
                     Math.min(pixels[pixel], pixels[pixel+1], pixels[pixel+2]));
      }
      backgrounds.push(median(corners));
      if (median(neutral) < 12) neutralCount++;
    }
    const light = [], dark = [];
    for (let i = 0; i < 64; i++) {
      (((Math.floor(i / 8) + i % 8) & 1) ? dark : light).push(backgrounds[i]);
    }
    const difference = median(light) - median(dark);
    // We know this chess.com theme: gray/white tiles, not a random image.
    if (neutralCount < 55 || difference < 25 || difference > 115) return null;

    const templates = await getTemplates();
    const small = document.createElement('canvas');
    small.width = REFERENCE_PIXELS;
    small.height = REFERENCE_PIXELS;
    const sc = small.getContext('2d', { willReadFrequently: true });
    const classes = [];
    const scores = [];
    const size = REFERENCE_PIXELS ** 2;

    for (let i = 0; i < 64; i++) {
      const x = (i % 8) * side, y = Math.floor(i / 8) * side;
      sc.clearRect(0, 0, REFERENCE_PIXELS, REFERENCE_PIXELS);
      sc.drawImage(canvas, x + side * .1, y + side * .1, side * .8, side * .8,
                   0, 0, REFERENCE_PIXELS, REFERENCE_PIXELS);
      const data = grayscaleData(sc.getImageData(0, 0, REFERENCE_PIXELS, REFERENCE_PIXELS).data);
      const feature = new Float32Array(size);
      const background = backgrounds[i];
      for (let j = 0; j < size; j++) {
        const delta = Math.max(-127, Math.min(127, data[j] - background));
        feature[j] = Math.abs(delta) < 12 ? 0 : delta;
      }
      let winning = '.', best = Infinity;
      for (let k = 0; k < REFERENCE_ORDER.length; k++) {
        let err = 0;
        for (let j = 0; j < size; j++) {
          const d = feature[j] - templates[k * size + j];
          err += d * d;
        }
        const rms = Math.sqrt(err / size);
        if (rms < best) { best = rms; winning = REFERENCE_ORDER[k]; }
      }
      classes.push(winning);
      scores.push(best);
    }
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const max = Math.max(...scores);
    // Never turn a weak match into a confident FEN.
    const reliable = mean < 17 && max < 36;
    if (!reliable) return null;
    return { placement: toPlacement(classes), reliable: true,
      meanConfidence: 1 - mean / 55, minConfidence: 1 - max / 55,
      method: 'chesscom-gray-templates', meanError: mean, maxError: max };
  } finally {
    image.close?.();
  }
}
