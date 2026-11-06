# Handwriting to Font

A free, browser-only web app that turns your handwriting into an installable OTF font.
Print a template, fill it in with a black felt-tip pen, scan or photograph it, upload it,
review the extracted letters, and download a font that works in Word.

**Everything runs in your browser. Your handwriting never leaves your computer.**
There is no server, no account, and no AI model.

## How to use it

1. **Print the template** (US Letter or A4) at 100% / Actual size, **in color**. The guide
   lines are light blue so the scanner can ignore them. (Grayscale printing isn't
   supported yet: the gray guide lines can be mistaken for ink.)
2. **Write** each character in its box with a black felt-tip pen, sitting on the solid baseline.
3. **Scan** at 300 DPI, or photograph each page flat in even light with all four black
   corner squares in view.
4. **Upload** the images, **review** the letters, then **preview and download** your font.
5. Open the `.otf` file, click **Install**, and restart Word.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173/handwriting-to-font/
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end tests (Playwright; uses your installed Chrome locally)
npm run build      # production build in dist/
```

Dev-only pages: `/dev/render-template.html` (rasterizes the template PDF) and
`/dev/fixtures.html` (makes synthetic scans and runs them through the pipeline).

The build plan, architecture, and decision log are in [SPEC.md](SPEC.md).

## License

This project's code is released under the [MIT License](LICENSE). The built app bundles
Potrace, which is GPL-2.0, so the built app as a whole is distributed under GPL-2.0.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
