# Chess Insight — Free PGN Game Review

A self-hosted, Arabic-first, zero-backend chess game review site. Enter a PGN, navigate the board, run Stockfish 19 Lite in the browser, and see estimated accuracy for White and Black, move classifications, suggestions, and an evaluation chart.

## Prerequisites

- Node.js 20.19+ (or Node.js 22.12+), and npm
- An up-to-date browser supporting WebAssembly

## Start locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). **Do not open `index.html` using `file://`** because the worker assets and module imports need HTTP(S).

The first `npm install` fetches free packages online and copies the Stockfish browser engine (`.js` and `.wasm`) to `public/engine`. After that, move analysis runs in your browser without paid APIs or server processing.

## Build for production

```bash
npm run build
```

Deploy the generated **`dist/`** folder to a static host such as Cloudflare Pages, Netlify, or your own HTTPS server. Example Cloudflare Pages settings:
- Build command: `npm run build`
- Output directory: `dist`
- Node.js version: 22

All browser analysis runs locally; however, downloading the site and the included engine assets requires network access unless served offline. Fonts are requested from Google Fonts; remove that `@import` line for a fully self-contained deployment.

## Accuracy methodology

- Every position is evaluated independently by Stockfish. Depth can be set to 8, 12, or 16.
- Evaluations are normalized to **White's perspective**.
- For each move, convert positions from centipawns to the mover's winning chance using:
  `Win% = 100 / (1 + exp(-0.00368208 * cp))`
- Estimated move accuracy is `clamp(103.1668 * exp(-0.04354 * max(0, WinBefore - WinAfter)) - 3.1669, 0, 100)`.
- Game accuracy is an **approximation** combining a local-volatility weighted mean and harmonic mean of move accuracies, inspired by Lichess. The weighting windows differ from Lichess's production implementation; **do not expect identical accuracy figures**.
- Categories are illustrative thresholds on **centipawn loss**, not Chess.com labels: Best ≤10cp (or Stockfish top move), Excellent ≤25cp, Good ≤50cp, Inaccuracy ≤100cp, Mistake ≤200cp, Blunder >200cp. These thresholds are product choices, not universal chess standards.
- Mate scores use a large signed centipawn equivalent. Unusual mate transitions, insufficient-material positions and other special cases can skew the estimated results.
- "Brilliant", "Book", "Great" and "Game Rating" require additional heuristics or databases and are not provided in the MVP.
- High engine depth will use more CPU and time.

## Privacy & limits

- The PGN is only processed in your browser. The project does not include a database, login, analytics, or a server API.
- Input is limited to a single PGN game of up to 500 half-moves and 2 MB for uploaded files.
- Currently supports standard chess PGN (not Chess960 or variants).
- This is an initial implementation. Validate with additional real-world PGNs before public launch.

## Source/license acknowledgements

Stockfish.js (the bundled browser chess engine installed through npm) is licensed **GPL-3.0**. Its source, license notice and official distribution are available at <https://github.com/nmrugg/stockfish.js>. Stockfish engine source is at <https://github.com/official-stockfish/Stockfish>.

chess.js is licensed under **BSD-2-Clause**: <https://github.com/jhlywa/chess.js>.

Lichess documents its accuracy model at <https://lichess.org/page/accuracy>.

When redistributing the site with the Stockfish binary, comply with the applicable GPL obligations, including supplying the corresponding engine source/license information. This demo project is not affiliated with Chess.com or Lichess.

## واجهة العرض (HTML)

- افتح `preview.html` بنقرتين لعرض **معاينة تفاعلية للواجهة** من دون أي تثبيت؛ النسب المعروضة فيها أمثلة تصميمية لا تنتج عن Stockfish.
- شغّل `npm install` ثم `npm run dev` لاستخدام التطبيق الفعلي لتحليل PGN بمحرك Stockfish. ملف `index.html` جزء من مشروع Vite وليس صفحة يمكن تشغيلها مباشرة بالنقر عليها.
- التصميم يدعم العربية واتجاه RTL، شاشة الحاسوب والهاتف، ويُظهر الفئات التي لا يحسبها المحرك بشرطة (`—`) بدلاً من الصفر.
