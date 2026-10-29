# Chess Insight Chrome extension

Manifest V3, Chrome 116 or newer. No external engine, telemetry, account or API key.

Run `npm install` in the repository root, then `npm run build:extension`.
Load `extension-dist/Chess-Insight-Extension` at `chrome://extensions` with Developer mode enabled.
Arabic installation and usage instructions are in `INSTALL_AR.html`.

Automatic adapters cover the visible main board on Chess.com, Lichess, and Chess Insight.
Other sites can be enabled per origin from the popup; their board must expose a complete `data-fen`.
Images, Canvas boards, closed shadow roots and cross-origin frames are not read.

Positions come from explicit FEN, a matching main-line move history, or legal transitions from a known position.
An arbitrary arrangement without known turn/castling rights requires full FEN; these fields are never inferred from appearance.
The latest position takes priority, stale search results are discarded, and arrows follow board orientation and scrolling.
Positive scores favor White. Stockfish search depth can be changed in the popup.

The extension source is GPL-3.0-or-later. Stockfish.js 19.0.1 is distributed unmodified under GPL-3.0;
chess.js 1.4.0 is BSD-2-Clause. License texts and exact upstream source links accompany the built extension.

Verification: `npm test` covers position reconstruction, castling, en passant, promotion, undo/branching,
unknown-turn handling and arrow coordinates. Browser component checks use the bundled WASM engine.
