import { makePlacement } from './position.js';

const file = 'abcdefgh';
const names = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
export function sanText(element) {
  const figurines = { '♔': 'K', '♚': 'K', '♕': 'Q', '♛': 'Q', '♖': 'R', '♜': 'R', '♗': 'B', '♝': 'B', '♘': 'N', '♞': 'N', '♙': '', '♟': '' };
  let text = element.textContent.trim().replace(/[♔♚♕♛♖♜♗♝♘♞♙♟]/g, x => figurines[x]);
  const icon = element.querySelector('[data-figurine], .icon-font-chess');
  const kind = icon?.dataset.figurine || Object.keys(names).find(name => icon?.className.includes(name));
  if (kind && !/^[KQRBN]/.test(text)) text = (names[kind]?.toUpperCase() || kind.toUpperCase()) + text;
  return text.replace(/\d+\.(\.\.)?/g, '').replace(/[!?\s]/g, '').replace(/^[.…]+/, '');
}
function visible(element) {
  const r = element.getBoundingClientRect();
  return r.width >= 180 && r.height >= 180 && Math.abs(r.width - r.height) < r.width * .12 && getComputedStyle(element).visibility !== 'hidden';
}
export function detectBoard(doc = document) {
  const candidates = [...doc.querySelectorAll('wc-chess-board, chess-board, cg-board, [data-fen]')].filter(visible);
  const element = candidates.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const flipped = element.classList.contains('flipped') || !!element.closest('.orientation-black, .flipped') || element.dataset.orientation === 'black';
  const pieces = new Map();
  let placement, fullFen = element.dataset.fen || null, type = 'رقعة متوافقة';
  if (fullFen) placement = fullFen.split(' ')[0];
  else if (element.matches('wc-chess-board, chess-board')) {
    type = 'Chess.com';
    for (const node of element.querySelectorAll('.piece')) {
      if (node.matches('.ghost, .dragging, .fading')) continue;
      const code = [...node.classList].find(x => /^[wb][pnbrqk]$/.test(x));
      const square = [...node.classList].find(x => /^square-[1-8][1-8]$/.test(x));
      if (!code || !square) continue;
      const name = file[Number(square[7]) - 1] + square[8];
      if (pieces.has(name)) return null;
      pieces.set(name, code);
    }
    placement = makePlacement(pieces);
  } else if (element.matches('cg-board')) {
    type = 'Lichess';
    for (const node of element.querySelectorAll('piece')) {
      if (node.matches('.ghost, .dragging, .fading')) continue;
      const color = node.classList.contains('white') ? 'w' : node.classList.contains('black') ? 'b' : null;
      const kind = Object.keys(names).find(name => node.classList.contains(name));
      if (!color || !kind) continue;
      const r = node.getBoundingClientRect();
      const x = ((r.left + r.width / 2 - rect.left) / rect.width) * 8 - .5;
      const y = ((r.top + r.height / 2 - rect.top) / rect.height) * 8 - .5;
      if (Math.abs(x - Math.round(x)) > .18 || Math.abs(y - Math.round(y)) > .18) return null;
      const col = Math.round(x), row = Math.round(y);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      const square = file[flipped ? 7 - col : col] + (flipped ? row + 1 : 8 - row);
      if (pieces.has(square)) return null;
      pieces.set(square, color + names[kind]);
    }
    placement = makePlacement(pieces);
  } else return null;
  // Wait for animations/re-rendering rather than analyzing a half-updated board.
  if ((placement.match(/K/g) || []).length !== 1 || (placement.match(/k/g) || []).length !== 1) return null;
  const list = type === 'Chess.com'
    ? [...doc.querySelectorAll('wc-move-list .main-line-ply[data-node^="0-"]')].map(n => n.querySelector('.node-highlight-content') || n)
    : [...doc.querySelectorAll('.tview2 move, .analyse__moves move, .round__app .moves move')];
  const sans = list.map(sanText).filter(x => x && !/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(x));
  const selected = list.findIndex(n => n.matches('.selected, .active') || n.closest('.main-line-ply')?.matches('.selected, .active'));
  if (!fullFen) {
    for (const input of doc.querySelectorAll('input.fen, input[name="fen"], .copyables input, input[aria-label*="FEN"], textarea[name="fen"]')) {
      if (input.value?.split(' ')[0] === placement) { fullFen = input.value.trim(); break; }
    }
  }
  return { element, placement, fullFen, sans, selectedPly: selected >= 0 ? selected + 1 : null, flipped, type, rect };
}

export function arrowPoints(move, flipped = false) {
  const point = square => {
    const col = file.indexOf(square[0]), rank = Number(square[1]) - 1;
    return { x: ((flipped ? 7 - col : col) + .5) * 12.5, y: ((flipped ? rank : 7 - rank) + .5) * 12.5 };
  };
  return { from: point(move.slice(0, 2)), to: point(move.slice(2, 4)) };
}
