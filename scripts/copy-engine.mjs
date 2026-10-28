import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(root, 'node_modules', 'stockfish');
const targetRoot = path.join(root, 'public', 'engine');
const assets = [
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm'
];

function findFile(dir, filename, depth=0) {
  if (depth>5 || !fs.existsSync(dir)) return null;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name === filename) return path.join(dir, ent.name);
    if (ent.isDirectory() && !ent.name.startsWith('.')) {
      const found = findFile(path.join(dir, ent.name), filename, depth+1);
      if (found) return found;
    }
  }
  return null;
}

fs.mkdirSync(targetRoot, { recursive: true });
for (const asset of assets) {
  const found = findFile(packageRoot, asset);
  if (!found) {
    console.error(`Missing Stockfish engine asset: ${asset}. Run npm install first.`);
    process.exitCode=1;
    continue;
  }
  fs.copyFileSync(found, path.join(targetRoot, asset));
  console.log(`Copied ${asset} to public/engine`);
}
