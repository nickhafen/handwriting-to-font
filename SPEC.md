# Handwriting-to-Font — Build Spec

A free, browser-only web app, hosted on GitHub Pages, that turns a filled-in handwriting template into an installable OTF font. All processing runs in the user's browser. There is no server, no account, and no AI model.

**How to use this spec (for Claude Code):** Work through the milestones in order. Stop at every **GATE** and ask the user to check the result before continuing. Keep this file up to date when a decision changes, and log decisions in [Decision log](#decision-log).

---

## 1. Goals and non-goals

### v1 goals
- Print a template → fill it in by hand → scan or photograph it → upload → review the extracted letters → type in a preview box → download an OTF.
- The font installs on Windows 11 and macOS and works in Microsoft Word, with correct descenders, letter holes, and spacing.
- Runs entirely client-side and deploys automatically to GitHub Pages.

### Non-goals (do not build unless asked)
- Reading ordinary freeform handwriting (no template).
- AI generation of missing letters.
- TTF output (OTF only), kerning, hinting.
- User accounts, servers, analytics, or tracking.
- Heavy computer-vision libraries (no OpenCV.js) unless the user approves.

---

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Build | Vite + TypeScript (strict) | |
| UI | React | Keep UI thin; all logic lives in `src/core` |
| Template PDF | `pdf-lib` | Draw exact geometry in points |
| Image decode | Browser `createImageBitmap` / canvas | JPG and PNG in v1; PDF input in Milestone 5 via `pdfjs-dist` |
| Image processing | Hand-written TypeScript on `ImageData` / typed arrays | Grayscale, adaptive threshold, connected components, homography |
| Tracing | Potrace compiled to WASM (`esm-potrace-wasm`, GPL-2.0) | If unusable, port the `kilobtye/potrace` JS port (also GPL-2.0, not MIT). **Do not use VTracer** (it's built for color images). |
| SVG path handling | `svgpath` | Converts Potrace's relative/transformed SVG paths to absolute coordinates |
| Font building | `opentype.js` | Writes CFF-flavored OTF |
| Storage | IndexedDB via `idb-keyval` | Autosave the current project |
| Heavy work | Web Worker | Keep the UI responsive while processing and tracing |
| Tests | Vitest (unit) + Playwright (end-to-end in a real browser) | `npm test` (unit), `npm run test:e2e` (Playwright). Locally Playwright uses the installed Chrome; CI installs Chromium |
| Deploy | GitHub Actions → GitHub Pages | `actions/upload-pages-artifact` + `actions/deploy-pages` |

Check each dependency's current version and license when adding it. Ask before adding any dependency that isn't listed here.

---

## 3. Architecture

```
src/
  core/
    template/
      layout.ts        # SINGLE SOURCE OF TRUTH for page/cell geometry (used by generator AND extractor)
      charset.ts       # characters, page assignment, glyph names
      generatePdf.ts   # layout -> printable PDF
    scan/
      load.ts          # file -> ImageData (downscale longest side to ~4000px)
      threshold.ts     # grayscale + adaptive threshold (Bradley/Sauvola via integral image)
      components.ts    # connected-component labeling
      fiducials.ts     # find 4 corner markers, determine orientation
      homography.ts    # 4-point DLT + warp to canonical page image
      pageId.ts        # read page-ID bit strip
      cells.ts         # crop cells, clean specks, detect empty / edge-touching
    trace/
      potrace.ts       # bitmap -> SVG path string (wrapper)
      svgToContours.ts # SVG path -> absolute contours in cell pixel coords
      winding.ts       # enforce outer/inner contour direction by nesting depth
    font/
      metrics.ts       # cell px -> font units; sidebearings; advance widths
      build.ts         # glyphs + metadata -> opentype.js Font -> ArrayBuffer
      validate.ts      # round-trip parse + checks (see §6)
    project.ts         # project state type + (de)serialization
  workers/
    pipeline.worker.ts
  ui/                  # React components: Template, Upload, Review, Preview
tests/
  unit/
  e2e/
  fixtures/
```

**Key rule:** `core/` contains pure functions (data in, data out) with no DOM or React dependencies, except `load.ts`. That keeps them testable in Vitest and usable inside the worker.

---

## 4. Template design

`layout.ts` defines everything below. The PDF generator draws from it, and the scan extractor reads from it. Never hard-code geometry anywhere else.

### Page
- US Letter by default (8.5 × 11 in), with an A4 option. Margins of at least 0.5 in.
- **Built (v1):** the marker box (outer edges of the corner markers) is the same 7.25 × 10 in on both paper sizes, centered on the page. The extractor works only in this "canonical frame" and never needs to know the paper size.
- The header text shows the page number, template version, and the line "Print at 100% / Actual size. Use a black felt-tip pen."

### Corner markers
- Four solid black squares (~0.35 in) at the corners of the content area.
- The **top-left** marker has a white square hole in its center, so the app can tell which way is up and handle scans rotated 90°, 180°, or 270°.
- Markers make the app robust to "fit to page" scaling and to phone-photo perspective.

### Page-ID strip
- A row of 8 small squares (~0.15 in) between the top two markers. Filled = 1.
- Bits 0–3 are the template version and bits 4–7 are the page index.
- **Extended (2026-11-06, no geometry change, still v1):** page index = styleIndex × 2 + page, styles in order Regular, Bold, Italic, Bold Italic (indices 0–7). Printed Regular pages (0, 1) are unaffected.
- If reading fails, fall back to a manual page-picker in the UI.

### Cells
- Starting size: about 0.75 in wide × 1.0 in tall, giving roughly 10 columns × 7–8 rows per page. Tune for comfortable handwriting, but prefer bigger cells to more cells.
- Each cell has a **label strip** at the top showing the target character in small gray text. The extractor excludes this strip.
- Below it is the **writing area** with guide lines: cap line, x-height (dashed), **baseline** (solid, slightly heavier), and descender line.
- **All cell borders and guides are printed in light "non-photo" blue** (around `#A4DDED`, lighter than 80% luminance) so thresholding removes them. Only the markers and the ID strip are black.
- Leave an inset margin (~0.05 in) inside each cell border that the extractor ignores.
- **Built (v1):** 7 columns × 8 rows (56 cells), each about 1.04 × 1.075 in. Label strip 0.2 in. The writing area is the cell below the label strip minus the 0.05 in inset on all sides (about 0.94 × 0.775 in); that exact rectangle maps to +900…−400 font units. Each section of the charset starts on a new row; unused cells aren't drawn.

### Vertical mapping (writing area → font units)
- `unitsPerEm = 1000`. The baseline maps to y = 0.
- Suggested guide positions in font units: cap line 700, x-height 480, descender line −250. The top of the writing area is about +900 and the bottom about −400 (was −300; lowered at the M1 gate for more tail room).
- **Use one constant scale (px → units) for every cell.** Never scale or center glyphs one at a time. Relative size and baseline position come from where the writer put the ink.

### Charset (v1)
- `A–Z`, `a–z`, `0–9`
- ASCII punctuation: `! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ { | } ~` and the backtick
- Typographic extras: `‘ ’ “ ” – — … § •`
- Word auto-converts straight quotes to curly ones as you type, so curly quotes must exist. If the user leaves them blank, generate fallbacks: copy `'` into `‘`/`’` and `"` into `“`/`”`. Mark these as fallbacks in the review grid.
- That's about 110 characters, which should fit on 2 pages. Order them so the letters are on page 1.
- **Built (v1):** 103 characters. Page 1: A–Z then a–z (52). Page 2: 0–9, then punctuation grouped so related marks sit together (straight and curly quotes, hyphen and dashes). Easily confused characters get a short printed hint (e.g. "capital i", "en dash").

---

## 5. Processing pipeline

1. **Load:** decode the file, apply the EXIF orientation, and downscale so the longest side is about 4000 px.
2. **Threshold:** convert to grayscale, then apply an adaptive threshold using an integral image. Phone photos have shadows, so a single global threshold isn't enough. The light-blue guides must drop out.
3. **Find markers:** label connected components and keep ones that are near-square (aspect ratio 0.8–1.25), solidly filled (more than 85%), and in a plausible size range relative to the image. Pick the best candidate in each image quadrant. Use the hollow top-left marker to work out rotation. If detection fails, show a clear error with tips on lighting, flatness, and making sure all four corners are in frame.
4. **Warp:** compute the homography from the 4 marker centers to their canonical positions and warp to a canonical page image at **300 DPI equivalent** (bilinear sampling).
5. **Read page ID:** sample the bit strip by the darkness of each square.
6. **Crop cells:** cut out each writing area minus the inset, then re-threshold the crop.
7. **Clean:** remove specks (components smaller than a configurable area). Flag each cell as:
   - `empty`: ink below the threshold
   - `touchesEdge`: ink reaches the crop boundary, so the letter is probably clipped
   - `suspicious`: very small or very large ink area compared with the median
8. **Trace:** run Potrace on each cell bitmap. Start with `turdsize ≈ 2`, `alphamax ≈ 1.0`, and `opttolerance ≈ 0.2`, and make them configurable.
9. **Convert:** turn the SVG path into absolute contours using `svgpath`, applying Potrace's transform. Map cell pixels to font units with the constant scale, flipping y so the baseline is 0 and y points up.
10. **Fix winding:** compute each contour's nesting depth. Even depth (outer) and odd depth (holes) must have opposite directions. Use counter-clockwise for outer contours in y-up font space, following the CFF convention. Test with `o e a 8 B Q @ %`.
11. **Metrics:** use left sidebearing 50 and right sidebearing 50 units by default, with a global "letter spacing" setting. Advance width = ink width + both sidebearings. The space glyph is about 280 units, also adjustable.
12. **Build** the font (see §6).

Run steps 2–9 in the Web Worker and show progress for each page.

---

## 6. Font output requirements

- Format: OTF (CFF) via `opentype.js`. Glyph 0 is `.notdef` (a simple box). Include `space` (U+0020).
- Use standard AGL glyph names (`A`, `a`, `zero`, `quoteright`, `section`, …).
- Metadata:
  - Family name comes from the user's input (default "My Handwriting"); style is `Regular`, weight 400.
  - **Add a short build suffix to the family name on every export** (for example `My Handwriting 0412`) unless the user turns it off. Windows caches installed fonts by name, and reinstalling the same name shows stale glyphs.
  - Set `fsType = 0` (installable embedding) so Word can embed the font in documents.
- Vertical metrics: set `ascender`, `descender`, typo metrics, and `usWinAscent`/`usWinDescent`. **`usWinAscent` must be ≥ the max glyph yMax and `usWinDescent` must be ≥ |min glyph yMin|**, or Windows clips the glyphs.
- `validate.ts` must, after every build:
  1. Re-parse the ArrayBuffer with `opentype.parse` and confirm every expected code point maps to a glyph.
  2. Check the win-metrics rule above.
  3. Load the font through the `FontFace` API. Chrome runs the OpenType Sanitizer on it, so if it loads, browsers accept it.
  4. Report the missing characters to the UI.

---

## 7. UI (v1)

A single page with four steps:

1. **Template:** a page-size choice and a "Download template PDF" button, plus short instructions: print at 100%, use a black felt-tip, keep strokes inside the writing area, and scan at 300 DPI or photograph flat in even light.
2. **Upload:** drag-and-drop for one or more JPG/PNG files. Show each detected page and its status. Re-uploading a page replaces that page.
3. **Review:** a grid of extracted glyphs drawn from the traced outlines, with baseline and x-height overlays and badges for the flags (empty, clipped, suspicious, fallback). Clicking a glyph shows the original cell crop next to the traced result.
4. **Preview & download:** a textarea with sample text (a pangram plus digits and punctuation), a size slider, letter-spacing and word-spacing sliders, a font-name field, and a "Download OTF" button. The preview uses the built font via `FontFace` and rebuilds when settings change (debounced).

Include a short privacy note: "Your handwriting never leaves your computer."

Keep styling simple and accessible: keyboard-navigable, with clear text contrast.

---

## 8. Testing

- **Unit (Vitest):** homography solve and inverse, thresholding on synthetic arrays, connected components, the page-ID bit codec, SVG→contours (relative commands and transforms), winding/nesting, metrics math, and a font build round-trip.
- **Synthetic scan fixtures:** write a generator that renders the real template, fills each cell by drawing the target character in a handwriting-like system font at the correct baseline, then applies rotation (±5°), perspective skew, a 180° rotation, uneven lighting, and noise. The end-to-end tests run the full pipeline on these and assert that the right number of glyphs is extracted, the page ID reads correctly, and baselines line up (the bottom of `x` ≈ 0, and the bottom of `g` < 0).
- **End-to-end (Playwright, Chromium):** upload the fixtures → download the OTF → re-parse it → check the cmap and metrics.
- **Real scan:** once the user provides a filled template, add it to `tests/fixtures/real/` and include it in the end-to-end tests.

---

## 9. Deployment

- Write a GitHub Actions workflow that, on every push to `main`, runs `npm ci`, the tests, and `npm run build`, then deploys `dist/` to GitHub Pages.
- In `vite.config.ts`, set `base: '/handwriting-to-font/'`, or whatever the repo is called.
- On a free GitHub plan, Pages needs a **public** repo. Tell the user this before creating anything.
- Don't create the GitHub repo, push, or enable Pages without the user's go-ahead.

---

## 10. Milestones

### M0: Risk check (about 1 hour) — GATE
- A minimal page that builds an OTF with `opentype.js` from a hard-coded glyph (a letter with a hole, such as `o`) plus `.notdef` and `space`, and downloads it.
- Run Potrace WASM on a sample PNG in the browser and draw the resulting path.
- **GATE:** the user installs the OTF on Windows, types with it in Word, and confirms the hole renders and nothing is clipped. Don't continue until they confirm.

### M1: Template generator
- `layout.ts`, `charset.ts`, `generatePdf.ts`, and the Template step UI.
- **GATE:** the user prints a page at 100% and checks that it's readable and the cells are a comfortable size.

### M2: Scan processing + review grid
- Loading, thresholding, markers, warping, page ID, cells, and cleaning in the worker. Show the review grid with raw cell bitmaps.
- Add the synthetic fixtures and end-to-end tests.
- **Done (2026-11-05):** worker pipeline, Upload step (drag-and-drop, per-file status, page picker fallback, re-upload replaces), Review grid (baseline/x-height overlays; empty, clipped, check-size and fallback badges; click for original vs cleaned). Unit tests run the pipeline on Node-drawn synthetic photos; Playwright runs 6 browser-made fixtures (scans and tilted/shaded/noisy/upside-down/sideways photos) plus a full UI upload test. Fixture harness: `dev/fixtures.html`.

### M3: Tracing + font build + preview
- Potrace, contour conversion, winding, metrics, build, validation, and the Preview & download step.
- **GATE:** the user fills in the real template, scans it, installs the font, and tests it in Word.

- **Built (2026-11-06):** Potrace runs in the worker on each cell (ImageData input), `svgpath` applies Potrace's transform, contours map to font units with the constant scale, winding is fixed by nesting depth. Review tiles draw the traced outlines (nonzero fill, so a wrong-direction hole would show). Preview & download step: size, letter- and word-spacing sliders, font name, build-code toggle, FontFace preview, checks list. Playwright downloads the OTF and re-parses it (cmap, win metrics, winding of every glyph, baselines, sidebearings, quote fallbacks).

- **GATE status (2026-11-06):** first real test used a template printed in grayscale; guide lines leaked into the scan (see the grayscale item under M5). User will retest with a color print.

### M4: Deploy
- **Done 2026-11-06:** `.github/workflows/deploy.yml` runs unit tests and the build on every push to `main`, then deploys `dist/` to GitHub Pages. End-to-end tests run in a separate, non-blocking job until they are confirmed stable on Linux (the fixtures use whichever handwriting-like font the runner has). Repo made public with the user's go-ahead.
- The GitHub Actions workflow and Pages setup, after the user approves.

### M5: Polish (phase 2)
- Per-glyph adjustments: ~~baseline shift~~, ~~left/right sidebearings~~ (done 2026-11-06 as Move up/down, Space before, Space after), ~~re-trace with different smoothing~~ (done), ~~per-glyph scale~~ (done 2026-11-07 as Size, 50–200%, scaled from the baseline).
- ~~Save ink settings and per-letter overrides with the project (IndexedDB autosave).~~ Done 2026-11-06: images and every setting are saved in the browser and restored on load; "Start over" clears them.
- PDF scan input via `pdfjs-dist`. **Remaining.**
- ~~Stroke weight adjustment (dilate/erode before tracing).~~ Done early (2026-11-06) as the Stroke thickness slider, global and per letter.
- Project export/import as a file, in addition to the IndexedDB autosave. **Remaining** (useful for moving a project between computers).
- **Grayscale printing support** (user request, 2026-11-06). A template printed in grayscale left guide lines in the scan: the printer turns light blue into gray, often as halftone dots, which threshold as ink. For now the app tells users to print in color. Candidate fixes, roughly cheapest first; test each against a real grayscale-printed scan (ask the user for one and add it to `tests/fixtures/real/`):
  1. Blur or median-filter each cell crop slightly before thresholding, so halftone dots average into a light, uniform gray that falls above the ink cutoff, while felt-tip strokes stay dark.
  2. Erase lines at known positions: after warping, every guide's y position is known from `layout.ts`. Remove thin horizontal runs in those bands (morphological opening with a long horizontal kernel), keeping pixels where a pen stroke crosses (ink thicker than the guide line).
  3. A "grayscale-friendly" template option (needs a template version bump): much lighter or dotted guides, or guides only as short ticks at the cell edges outside the writing area.
  4. Compare the scan with a rendering of the blank template (pdf.js, already a dev dependency) and subtract the expected guide pixels.
  - **Progress (2026-11-06):** per-cell lighting flattening fixed the shadow flooding on the user's grayscale scan, and detected guide rows are now guarded. Remaining: on grayscale prints the baseline is about as dark as ink, so it still bleeds into some lowercase letters (m, n, s, u, z). Test scan: `samples/grayscale p1 (shadow).jpg` (local only).

### Done early (2026-11-06, user requests)
- **Font styles:** Regular, Bold, Italic, Bold Italic. Each can be written on its own template set (style chosen in step 1, detected from the page ID) or generated from Regular: Bold by re-tracing Regular with thicker strokes (+1…4 px), Italic and Bold Italic by slanting (4–20°). Written glyphs win per character. Downloads are one family with a shared build code and correct style-linking (nameID 2, usWeightClass, fsSelection, macStyle, post.italicAngle).
- **Redo workflow:** uploads of the same style/page merge, newest non-blank box wins; blank boxes keep earlier versions. Step 3 can mark characters for redo; step 1 prints a redo sheet with only those boxes (same positions and page IDs). Marks clear when a new upload supplies the character. Uploads show how many characters they supply and can be removed.
- **Review drawer:** clicking a letter opens a fixed bottom drawer (page doesn't scroll) with scan / ink / outline, per-letter sliders, Revert to default, Apply to all letters, Mark for redo, Prev/Next, Esc to close.
- **Preview:** buttons insert – — § • … ‘ ’ “ ”.
- **Dev only:** "Load samples (dev)" loads `samples/*color*` via a dev-server-only Vite plugin; never in builds.
- ~~Saving the project~~ done (autosave).

### M6: Variants and ligatures (phase 3)
- **Start with a feasibility check:** can `opentype.js` write GSUB `calt` (contextual alternates) and `liga` lookups that Word and browsers honor? If not, write up options for the user, such as fontTools via Pyodide, before building anything.
- **Feasibility result (2026-11-06):** yes for ligatures. opentype.js 2.0 writes GSUB lookup types 1–6. Its `substitution.add()` helper covers `liga`, `dlig`, `rlig`, `ccmp`, `salt` and `ssXX` (not `calt`); features must be added in alphabetical order. Tested in Chrome: a `liga` f+i ligature renders by default and a `dlig` t+h ligature renders when `dlig` is on. `calt` needs hand-built chained-context lookups (type 6), which the writer supports but the helper doesn't.
- **Proposed design:** a "ligature sheet" template where the user lists letter sequences (e.g. th, oo, tt, ing). Each gets a wider cell (2–3 normal widths) on the same baseline grid, encoded with a sheet number in a free page-ID range (8–15) plus the sequence list saved in the project (or printed as labels and confirmed after upload). Glyphs named like `t_h`, added as `liga` (always on in browsers; Word: Font → Advanced → Ligatures "Standard Only") or `dlig` (Word: "All"). A per-ligature toggle chooses standard vs discretionary.
- **Built (2026-11-07):** ligatures **and contextual alternates** ("ligatures" in user requests includes both).
  - Sheets: page index 8 = common ligatures sheet (24 pre-labeled boxes: ffi ff fi / ffl fl ft / ing in on / tt th ch / sh wh ck / qu st ss / ll oo ee / er or ou); 9–15 = blank sheets 1–7 (rows of 7×1, 7×1, [2,2,2,1]×3, [3,3,1]×3 = 35 boxes). Boxes span 1–3 grid columns with the letter cells' exact row height, label strip and inset, so the font-unit scale is identical. Box numbers are printed in the label strip.
  - Box text (typed in the app, preset on the common sheet): `th` = ligature; `r[e]` = contextual alternate (the box holds one letter, used after r); `[o]n` = before n; both sides allowed. Errors are explained inline.
  - Fonts: ligatures as GSUB type 4 under a per-box feature (Standard `liga` default, Discretionary `dlig`, Contextual `calt`); alternates as a `calt` chained-context lookup (type 6 format 3) calling single substitutions (type 1). Built by hand in `core/font/gsub.ts` (opentype.js's helper can't do `calt`). Lookup order: liga, dlig, calt ligatures, then alternates. Glyph names: `t_h`, `f_f_i`, `e.alt1`.
  - Same text in two boxes: the newest (later sheet/box) wins; the other is marked duplicate. Ligatures go into Regular and into a generated (slanted) Italic. **Not yet:** Bold/Bold Italic ligatures, written-Italic ligature sheets, redo sheets for ligature boxes.
  - Review: a Ligatures tab with a text field, feature menu and status per box; the drawer works for boxes (ink, size, position, spacing). Preview: Ligatures On / On + discretionary / Off.
  - Verified in Chrome: standard and contextual ligatures and before/after alternates all render; the e2e test downloads the fonts and checks the GSUB tables.
- Word note: ligatures are **off by default** in Word. Font → Advanced → Ligatures: "Standard Only" turns on `liga`; "All" also turns on `dlig`.
- Note for the user docs: Word turns contextual alternates off by default. They're enabled under Font → Advanced → "Use Contextual Alternates".

---

## 11. Working rules for Claude Code

- Commit in small steps with clear messages. Keep `main` deployable once M4 is done.
- Run `npm test` and `npm run build` before saying a milestone is done.
- Keep geometry in `layout.ts` only. Keep `core/` free of React and DOM code.
- Don't change the template geometry after M1 without bumping the template version, because already-printed templates must keep working.
- Ask before adding dependencies not listed in §2, creating remote repos, pushing, or enabling Pages.
- At each GATE, explain exactly what the user should do and what to look for.

---

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-11-05 | Browser-only app on GitHub Pages; template-based input | No hosting cost; handwriting stays on the user's computer; freeform input is a research problem |
| 2026-11-05 | Potrace (WASM), not VTracer | Built for black-and-white tracing; correct holes |
| 2026-11-05 | OTF only via opentype.js | opentype.js doesn't write TrueType; OTF installs everywhere |
| 2026-11-05 | Corner markers + light-blue guides; no OpenCV.js | Small bundle; handles scaling and perspective; guides drop out when thresholded |
| 2026-11-05 | Repo lives outside OneDrive | Avoid syncing `node_modules` |
| 2026-11-05 | Potrace is GPL-2.0 in every available form; the app's own license must be GPL-compatible. (Resolved 2026-11-06: see the MIT row below) | Both `esm-potrace-wasm` and `kilobtye/potrace` are GPL-2.0, inherited from Potrace itself |
| 2026-11-05 | Versions at M0: Vite 8, React 19, TypeScript 7, Vitest 5, opentype.js 2.0, esm-potrace-wasm 0.5.1 | Current releases. opentype.js 2.0 ships no types, so `src/types/opentype.d.ts` declares the subset we use (no `@types` package, which targets 1.x) |
| 2026-11-05 | M0 test font has `o`, `p`, `l` (not just `o`) | Exercises a hole, a descender to −300, and an ascender to +900, so the Word test actually checks clipping |
| 2026-11-05 | Potrace output confirmed: relative path commands inside `translate(0,H) scale(0.1,-0.1)` | Confirms M3 needs `svgpath` to apply the transform before mapping to font units |
| 2026-11-05 | M0 GATE passed: test OTF installed on Windows and rendered correctly in Word (holes, no clipping) | User confirmed |
| 2026-11-05 | Same 7.25 × 10 in marker box on Letter and A4, centered | One geometry for both paper sizes; the scanner needs no paper-size setting |
| 2026-11-05 | 7 × 8 grid of ~1.04 × 1.075 in cells instead of ~0.75 × 1.0 in | 103 characters fit on 2 pages with letters alone on page 1 (52 of 56 cells); spec prefers bigger cells |
| 2026-11-05 | The font-unit range +900…−400 maps to the writing area *inside* the inset | Otherwise the inset would crop off the descender line (−250) |
| 2026-11-05 | Page-ID codec lives in `core/template/pageIdCodec.ts` (not `scan/pageId.ts`) | Shared by the generator and the reader; `scan/pageId.ts` will do only the pixel sampling |
| 2026-11-05 | M1 GATE: user approved the printed template with more tail room. Writing-area bottom moved from −300 to −400 units (descender guide stays at −250); still template v1 because no real templates were filled yet | Tails needed more space below the line |
| 2026-11-05 | `pdfjs-dist` added as a dev dependency at M1 (listed for M5) | Rasterizes the template for visual checks now, and for synthetic scan fixtures in M2 |
| 2026-11-05 | opentype.js has no `exports` map: plain Node resolves its CommonJS build, where named imports fail. Vite/Vitest use the ES build and are fine | Node-only scripts (e.g. fixture generators) must run through Vite with `ssr.noExternal: ['opentype.js']` |
| 2026-11-05 | Grayscale = brightest RGB channel, not luminance | The light-blue guides (#A4DDED) become 237/255 and drop out; with luminance they would be 0.82 gray, close to the ink cutoff |
| 2026-11-05 | Marker candidates: size range, orientation-free aspect (covariance eigenvalues), and solidity vs the convex hull (≥ 0.8); pick the candidate **farthest from the image center** in each quadrant | Bounding-box fill fails for tilted squares; "largest per quadrant" picked a filled-in letter in testing |
| 2026-11-05 | Markers are found on a copy shrunk to ~1600 px; the warp samples the full-resolution image | Fast detection, full detail in the canonical 300 DPI page |
| 2026-11-05 | Cell threshold = 0.6 × the cell's 95th-percentile brightness, then speck removal (12 px) | Simple and robust per cell; guides at ~0.93 × paper never count as ink |
| 2026-11-05 | Page ID trusted only if it decodes to a known page of this template version with confidence ≥ 0.25; otherwise the user picks the page | Avoids silently assigning a page wrongly |
| 2026-11-05 | "Suspicious" compares letters/digits with the median letter/digit ink area (< 0.12× or > 4×); punctuation is only flagged when too large | A period is legitimately tiny |
| 2026-11-05 | `core/project.ts` assembles per-glyph review status (incl. curly-quote fallbacks) from the scanned pages | Pure and unit-testable; the UI only renders it |
| 2026-11-05 | Fixtures write characters in Segoe Print / Ink Free / Comic Sans (whichever exists), shrunk to fit the writing area | Handwriting-like system fonts; CI (Linux) falls back to another font, so assertions use tolerances and compare photos against the clean scan |
| 2026-11-06 | Glyph bounding boxes use true cubic extremes, not control points | Control points bulge past round letters; sidebearings came out ~5 units too wide |
| 2026-11-06 | `validateFont` also checks every glyph's contour directions; `ok` ignores missing characters (reported separately) | A blank cell shouldn't block a download; a wrong winding should |
| 2026-11-06 | Preview fonts use the plain name; only the downloaded font gets the build code | The code changes every minute and is only needed for installs |
| 2026-11-06 | Line metrics: typo/hhea ascender 900, descender −300; usWin metrics from the actual ink extremes | Consistent line height; Windows never clips tails or tall letters |
| 2026-11-06 | `core/font/pathCommands.ts` holds the opentype-command converter with a type-only import | Lets Node-side tests (Playwright) use it without importing opentype.js |
| 2026-11-06 | License: **MIT** for this repo's code (user default; as permissive as possible). The built app bundles Potrace (GPL-2.0), so the built app as a whole is distributed under GPL-2.0; README, LICENSE note, THIRD_PARTY_NOTICES.md, and an in-app footer say so | MIT code may be combined into a GPL work; the public repo provides the complete source GPL requires. A fully permissive build would require replacing Potrace |
| 2026-11-06 | GitHub repo `nickhafen/handwriting-to-font` created **private** at the user's request to commit everything to GitHub; must become public before Pages can be enabled on a free plan (M4) | Private is the reversible default until the user approves going public |
| 2026-11-06 | Templates must be printed in color for now; the Template step and README say so | Grayscale printing turned the guides into ink (backlog item under M5) |
| 2026-11-06 | Cell thresholding is now **hysteresis**: definite ink < 0.6 × paper anchors strokes; faint ink < 0.8 × paper (the sensitivity slider moves this between 0.62 and 0.88) is kept only if connected to definite ink. Within ±4 px of each printed guide row, faint ink must be < 0.7 × paper | User's real scan with a fine pen lost faint parts of capitals (e.g. the left leg of A). The guide-band rule stops faint growth from running along a guide line |
| 2026-11-06 | Ink controls pulled forward from M5: "all letters" panel plus per-letter overrides for ink sensitivity, stroke thickness (chamfer distance transform, −2…+4 px at 300 DPI) and smoothing (Potrace alphamax 0.2…1.3). Changes re-trace only affected cells in the worker from the stored grayscale crops; stale results are discarded | User asked for settings and per-character controls instead of switching to a thick marker |
| 2026-11-06 | Trace options moved to `core/trace/options.ts` | Importing them in the UI no longer risks pulling the Potrace WASM into the main bundle |
| 2026-11-06 | Before thresholding, each cell is divided by a local paper-brightness estimate (block max over 24 px blocks, spread 3×3, smoothed) | Hysteresis alone flooded shaded areas on the user's grayscale/shadow scan; flattening restores shaded paper to white |
| 2026-11-06 | Guide guard also applies to rows that look like a printed line (≥ 35% of the width faint-but-not-dark), ±2 rows | On the user's sideways page-2 scan, guides sat more than 4 px from the predicted rows and grew into } and $ |
| 2026-11-06 | Tuned against the user's real scans in `samples/` (color p1, color p2 sideways, grayscale p1 with shadow). They stay local: `samples/` and `tests/fixtures/real/` are gitignored | It's the user's handwriting and the repo may become public; ask before committing any real scans |
| 2026-11-06 | Styles encoded in the page-ID page index (style × 2 + page) instead of a new template version | Keeps already-printed Regular templates valid; 4 bits allow 8 pages = 4 styles × 2 |
| 2026-11-06 | Generated Bold = Regular cells re-traced with thicker strokes in the worker; generated Italic = outline slant at build time | Reuses the ink pipeline (handles holes and joins naturally) and costs nothing for italics. Cursive written sets still can't join letters (needs contextual alternates, M6) |
| 2026-11-06 | Re-uploading a page merges instead of replacing: per box, the newest upload with writing wins | Makes partial redo sheets and "just rewrite a few boxes" work with no extra encoding |
| 2026-11-06 | "Revert to default" in the drawer removes the letter's own settings; "Apply to all letters" makes them the all-letters settings and clears every per-letter override | Matches the user's request; the global panel shows when it differs from the defaults |
| 2026-11-06 | Default letter spacing −20 (was 0) | User preference after testing with real handwriting |
| 2026-11-06 | Per-character position and spacing are build-time metrics (shift and extra sidebearings), separate from ink settings; generated Bold/Italic glyphs use the Regular glyph's metrics | Moves a character without re-tracing it; one adjustment carries to generated styles |
| 2026-11-06 | Autosave stores the original image files plus settings in IndexedDB (`idb-keyval`) and re-processes them on load, instead of storing processed cells | Small, simple and always consistent with the current pipeline; re-processing takes a few seconds |
| 2026-11-06 | Redo sheets keep the standard box positions (not packed onto one line) | Position is how the app knows which character is in a box; a packed sheet would only be readable by the browser that printed it (the page ID has no room for a character list). Revisit if paper use matters |
| 2026-11-07 | Per-letter Size scales from the baseline (and is stored as a factor; older saves default to 1) | A letter written too small grows without leaving the line; floating marks can be re-positioned with Move up/down |
| 2026-11-07 | Ligature sheets use page indices 8 (common) and 9–15 (blank sheets 1–7); letter pages keep 0–7; still template v1 | Uses the unused half of the 4-bit page index; nothing printed changes; each blank sheet merges only with re-uploads of the same number |
| 2026-11-07 | One text syntax for both kinds: `th` (ligature) and `r[e]` / `[o]n` (contextual alternate) | The user asked for contextual alternates to count as "ligatures"; one field per box keeps it simple |
| 2026-11-07 | GSUB built directly (lookup types 1, 4, 6) instead of opentype.js `substitution.add` | The helper can't write `calt` and requires alphabetical feature insertion |
