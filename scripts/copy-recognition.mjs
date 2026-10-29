import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assets = [
  {
    from: path.join(root, 'node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx'),
    to: path.join(root, 'public/models/chess-tiles-v2.onnx'),
  },
  ...['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map(filename => ({
    from: path.join(root, 'node_modules/onnxruntime-web/dist', filename),
    to: path.join(root, 'public/ort', filename),
  })),
];

for (const { from, to } of assets) {
  if (!fs.existsSync(from)) {
    throw new Error(`Recognition asset missing after npm install: ${from}`);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log('Chess recognition model and ONNX WASM assets copied to public/.');
