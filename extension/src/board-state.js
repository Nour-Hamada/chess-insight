// Read only the position of a visible board. This MAIN-world adapter has no
// extension APIs and never receives commands, URLs, credentials or game input.
const VERSION = typeof __CI_VERSION__ === 'string' ? __CI_VERSION__ : 'dev';
export function readBoardState(doc, boardId = '') {
  const boards = [...doc.querySelectorAll('wc-chess-board, chess-board, [data-fen]')].filter(node => {
    const rect = node.getBoundingClientRect();
    return rect.width >= 180 && rect.height >= 180 && (!boardId || node.id === boardId);
  }).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
  const board = boards[0];
  if (!board) return { fen: null, method: 'no-visible-board' };
  const readers = [
    ['board.game.getFEN', () => board.game?.getFEN?.()],
    ['board.game.getFen', () => board.game?.getFen?.()],
    ['board.getFEN', () => board.getFEN?.()],
    ['board.getFen', () => board.getFen?.()],
    ['board.fen', () => board.fen],
    ['data-fen', () => board.dataset.fen],
  ];
  for (const [method, read] of readers) {
    try {
      const value = read();
      if (typeof value === 'string' && value.length < 200 && /^[^\s]+ [wb] [KQkq-]+ (?:-|[a-h][36]) \d+ \d+$/.test(value.trim())) return { fen: value.trim(), method, boardId: board.id };
    } catch { /* Try the next read-only adapter if this site's API differs. */ }
  }
  return { fen: null, method: 'position-api-unavailable', boardId: board.id };
}

if (typeof window !== 'undefined') {
  const key = '__chessInsightBoardReader';
  if (window[key]?.version !== VERSION) {
    window[key]?.dispose?.();
    const onRequest = event => {
      try {
        const request = JSON.parse(event.detail);
        if (typeof request.nonce !== 'string' || request.nonce.length > 80 || typeof request.boardId !== 'string') return;
        const response = { nonce: request.nonce, ...readBoardState(document, request.boardId) };
        document.dispatchEvent(new CustomEvent('ci:position-response', { detail: JSON.stringify(response) }));
      } catch { /* An invalid page message must never affect its board. */ }
    };
    document.addEventListener('ci:position-request', onRequest);
    window[key] = { version: VERSION, dispose: () => document.removeEventListener('ci:position-request', onRequest) };
  }
}
