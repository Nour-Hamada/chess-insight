# Chess Insight Chrome extension

Manifest V3, Chrome 116 or newer. No external engine, telemetry, account or API key.

Run `npm install` in the repository root, then `npm run build:extension`.
Load `extension-dist/Chess-Insight-Extension` at `chrome://extensions` with Developer mode enabled.
Arabic installation and usage instructions are in `INSTALL_AR.html`.

Automatic adapters cover the visible main board on Chess.com, Lichess, and Chess Insight.
Version 1.0.2 analyzes the visible piece placement even without game history. It reads the side from explicit board attributes, an active clock or unambiguous last-move markers; if unavailable, selecting White/Black starts evaluation immediately. The visual fallback excludes unconfirmed castling and discloses its assumptions. Castling and en passant can be corrected in the position tools. A read-only Chess.com board-position adapter supplies authoritative FEN where available and overrides the approximate snapshot only when placement matches. A visible version number, replacement of stale panels after updates, and a copyable diagnostic report help troubleshoot remaining site differences.
Version 1.0.1 fixes midgame activation by reading Chess.com's simple/live move lists as well as its analysis move list, preserving piece figurines and selected-ply navigation.
Other sites can be enabled per origin from the popup; their board must expose a complete `data-fen`.
Images, Canvas boards, closed shadow roots and cross-origin frames are not read.

Positions come from explicit FEN, a matching main-line move history, or legal transitions from a known position.
Without history, the visible placement can be analyzed when the side is known from the board or selected explicitly. Unconfirmed castling is excluded and a visible notice explains the resulting limits. Exact FEN or explicit correction of castling and en passant provides a more complete position. The visual snapshot has no repetition history; use the full game for history-dependent draw analysis.
The latest position takes priority, stale search results are discarded, and arrows follow board orientation and scrolling.
Positive scores favor White. Stockfish search depth can be changed in the popup.

The extension source is GPL-3.0-or-later. Stockfish.js 19.0.1 is distributed unmodified under GPL-3.0;
chess.js 1.4.0 is BSD-2-Clause. License texts and exact upstream source links accompany the built extension.

Verification: `npm test` covers position reconstruction, castling, en passant, promotion, undo/branching,
unknown-turn handling and arrow coordinates. Browser component checks use the bundled WASM engine.
