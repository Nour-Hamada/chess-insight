import { makePlacement } from './position.js';

const file = 'abcdefgh';
const names = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
export function sanText(element) {
  const figurines = { '♔': 'K', '♚': 'K', '♕': 'Q', '♛': 'Q', '♖': 'R', '♜': 'R', '♗': 'B', '♝': 'B', '♘': 'N', '♞': 'N', '♙': '', '♟': '' };
  const content = element.cloneNode(true);
  for (const extra of content.querySelectorAll('.timestamp, .move-time, .annotation, [data-nag], .evaluation, draw')) extra.remove();
  let text = (element.dataset.san || element.dataset.uci || content.textContent).trim().replace(/[♔♚♕♛♖♜♗♝♘♞♙♟]/g, x => figurines[x]);
  const icon = element.querySelector('[data-figurine], .icon-font-chess');
  const kind = icon?.dataset.figurine?.toLowerCase() || Object.keys(names).find(name => icon?.classList.contains(name) || icon?.getAttribute('class')?.includes(name));
  const piece = names[kind] || (/^[pnbrqk]$/.test(kind || '') ? kind : null);
  text = text.replace(/[\u200b-\u200f\u202a-\u202e\ufe0e\ufe0f]/g, '').replace(/^\s*\d+\.(?:\.\.)?\s*/, '').replace(/[!?\s]/g, '').replace(/^[.…]+/, '').replace(/e\.?p\.?$/i, '');
  if (piece && piece !== 'p' && !/^[KQRBN]/.test(text)) text = piece.toUpperCase() + text;
  return text.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
}

export function readMoveHistory(doc, type, boardElement) {
  let list = [];
  if (type === 'Chess.com') {
    // The analysis board uses wc-move-list; play/bot pages use
    // wc-simple-move-list. Reading only the former breaks midgame activation.
    const roots = [...doc.querySelectorAll('wc-move-list, wc-simple-move-list, vertical-move-list, move-list, #live-game-tab-scroll-container, .play-controller-moveList')];
    const owned = roots.filter(root => boardElement.id && root.getAttribute('board-id') === boardElement.id);
    const sources = owned.length ? owned : roots.length ? roots : [doc];
    for (const root of sources) {
      let nodes = [...root.querySelectorAll('.main-line-ply')].filter(n => !n.dataset.node || n.dataset.node.startsWith('0-'));
      if (!nodes.length) nodes = [...root.querySelectorAll('.node-highlight-content, .move-text-component, [data-san], [data-uci]')].filter(n => !n.closest('.variation, .variation-line, .variation-move-list'));
      const leaves = nodes.map(n => n.querySelector('.node-highlight-content, .move-text-component') || n);
      // Nested list roots and responsive duplicates must not duplicate plies.
      const unique = [...new Set(leaves)].filter(n => !leaves.some(other => other !== n && n.contains(other)));
      if (unique.length > list.length) list = unique;
    }
  } else {
    list = [...doc.querySelectorAll('.tview2 move, .analyse__moves move, .round__app .moves move, rm6 l4x kwdb')];
    // Lichess round views use changing, shortened tag names. Discover a group
    // of sibling SAN moves structurally instead of depending on those names.
    const groups = new Map();
    const sanPattern = /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/;
    for (const node of doc.querySelectorAll('.round__app *')) {
      if (!sanPattern.test(sanText(node)) || [...node.children].some(child => child.tagName.toLowerCase() !== 'draw')) continue;
      const group = groups.get(node.parentElement) || [];
      group.push(node); groups.set(node.parentElement, group);
    }
    for (const group of groups.values()) if (group.length > list.length) list = group;
  }
  const moves = [];
  let selectedPly = null;
  for (const node of list) {
    const san = sanText(node);
    if (!san || /^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(san)) continue;
    moves.push(san);
    if (node.matches('.selected, .active, .a1t') || node.closest('.main-line-ply')?.matches('.selected, .active')) selectedPly = moves.length;
  }
  return { sans: moves, selectedPly };
}
function visible(element) {
  const r = element.getBoundingClientRect();
  return r.width >= 180 && r.height >= 180 && Math.abs(r.width - r.height) < r.width * .12 && getComputedStyle(element).visibility !== 'hidden';
}
function lastVisibleMove(element, pieces) {
  const squares = [...new Set([...element.querySelectorAll('.highlight')].map(node => [...node.classList].find(c => /^square-[1-8][1-8]$/.test(c))).filter(Boolean))];
  if (squares.length !== 2) return null;
  const names = squares.map(s => file[Number(s[7]) - 1] + s[8]);
  const from = names.find(square => !pieces.has(square)), to = names.find(square => pieces.has(square));
  return from && to ? { from, to, piece: pieces.get(to) } : null;
}
export function readVisibleTurn(doc, element, flipped, lastMove = null) {
  const explicit = element.getAttribute('data-turn');
  if (['w', 'b', 'white', 'black'].includes(explicit)) return { turn: explicit[0], turnSource: 'دور الرقعة' };
  const scope = element.closest('.board-layout-main, .board-layout-component, .round__app') || doc;
  const clocks = [...scope.querySelectorAll('.clock-player-turn, .rclock.running')].filter(clock => {
    const rect = clock.getBoundingClientRect(); return rect.width > 0 && rect.height > 0;
  });
  if (clocks.length === 1) {
    const clock = clocks[0];
    if (clock.closest('.clock-white, .rclock-white')) return { turn: 'w', turnSource: 'الساعة النشطة' };
    if (clock.closest('.clock-black, .rclock-black')) return { turn: 'b', turnSource: 'الساعة النشطة' };
    if (clock.closest('.clock-top, .rclock-top')) return { turn: flipped ? 'w' : 'b', turnSource: 'الساعة النشطة' };
    if (clock.closest('.clock-bottom, .rclock-bottom')) return { turn: flipped ? 'b' : 'w', turnSource: 'الساعة النشطة' };
  }
  if (lastMove?.piece) return { turn: lastMove.piece[0] === 'w' ? 'b' : 'w', turnSource: 'آخر نقلة مظلّلة' };
  return { turn: null, turnSource: null };
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
  const { sans, selectedPly } = readMoveHistory(doc, type, element);
  if (!fullFen) {
    for (const input of doc.querySelectorAll('input.fen, input[name="fen"], .copyables input, input[aria-label*="FEN"], textarea[name="fen"]')) {
      if (input.value?.split(' ')[0] === placement) { fullFen = input.value.trim(); break; }
    }
  }
  const lastMove = lastVisibleMove(element, pieces);
  return { element, placement, fullFen, sans, selectedPly, flipped, type, rect, lastMove, ...readVisibleTurn(doc, element, flipped, lastMove) };
}

export function arrowPoints(move, flipped = false) {
  const point = square => {
    const col = file.indexOf(square[0]), rank = Number(square[1]) - 1;
    return { x: ((flipped ? 7 - col : col) + .5) * 12.5, y: ((flipped ? rank : 7 - rank) + .5) * 12.5 };
  };
  return { from: point(move.slice(0, 2)), to: point(move.slice(2, 4)) };
}
