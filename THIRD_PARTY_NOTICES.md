# Third-party notices

This project's own code is MIT-licensed (see [LICENSE](LICENSE)). The built web app
includes the following third-party packages, each under its own license.

## Bundled in the web app

| Package | License | Notes |
|---|---|---|
| [esm-potrace-wasm](https://github.com/tomayac/esm-potrace-wasm) (Potrace by Peter Selinger) | GPL-2.0 | Traces letter bitmaps into outlines. Because the built app includes it, the built app as a whole is distributed under GPL-2.0. Source: the linked repository and [potrace.sourceforge.net](https://potrace.sourceforge.net/). |
| [opentype.js](https://github.com/opentypejs/opentype.js) | MIT | Builds the OTF font |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | Generates the template PDF |
| [svgpath](https://github.com/fontello/svgpath) | MIT | Converts traced SVG paths to absolute coordinates |
| [React](https://github.com/facebook/react) | MIT | User interface |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval) | Apache-2.0 | Saves your project in the browser (IndexedDB) |

## Development and testing only (not shipped)

| Package | License |
|---|---|
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | Apache-2.0 |
| [Vite](https://github.com/vitejs/vite), [Vitest](https://github.com/vitest-dev/vitest), [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | MIT |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 |

## What this means in practice

- You can reuse any of this project's own source files under the MIT license.
- If you redistribute the **built app** (or anything else that includes Potrace), you
  must follow GPL-2.0: keep the license notices and make the complete source code
  available. This repository satisfies that for the hosted app.
- To make the built app fully permissive, Potrace would need to be replaced with a
  permissively licensed tracer.
