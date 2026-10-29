import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const tempDir = path.join(rootDir, '..', 'gh-pages-temp');

console.log('Deploying dist to gh-pages branch...');

if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

execSync(`git clone --branch gh-pages --single-branch https://github.com/Nour-Hamada/chess-insight.git "${tempDir}"`, { stdio: 'inherit' });

// Remove old files except .git
const existing = fs.readdirSync(tempDir);
for (const file of existing) {
  if (file !== '.git') {
    fs.rmSync(path.join(tempDir, file), { recursive: true, force: true });
  }
}

// Copy dist files
function copyFolder(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) {
      copyFolder(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

copyFolder(distDir, tempDir);

execSync('git config user.name "Chess Insight Developer"', { cwd: tempDir, stdio: 'inherit' });
execSync('git config user.email "dev@chess-insight.local"', { cwd: tempDir, stdio: 'inherit' });
execSync('git add -A', { cwd: tempDir, stdio: 'inherit' });

try {
  execSync('git commit -m "deploy: update live site with robust screenshot recognition and full board rendering"', { cwd: tempDir, stdio: 'inherit' });
  execSync('git push origin gh-pages', { cwd: tempDir, stdio: 'inherit' });
  console.log('Successfully pushed to gh-pages branch!');
} catch (e) {
  console.log('No new changes to commit or push:', e.message);
}

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('Done!');
