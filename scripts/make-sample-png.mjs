// Writes public/sample.png: pen-like strokes with holes ("o", "8", "g"), used by
// the Milestone 0 Potrace check. No dependencies: draws with distance fields and
// encodes a grayscale PNG by hand. Run: node scripts/make-sample-png.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'

const W = 600
const H = 300
const SS = 3 // supersampling for anti-aliased edges

// Distance from p to an axis-aligned ellipse's outline (approximate, fine for strokes).
function ellipseDist(px, py, cx, cy, rx, ry) {
  const dx = (px - cx) / rx
  const dy = (py - cy) / ry
  const r = Math.hypot(dx, dy)
  return Math.abs(r - 1) * Math.min(rx, ry)
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

// Sample a quadratic curve as a polyline.
function quad(a, c, b, n = 24) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]])
  }
  return pts
}

const PEN = 9 // half stroke width in px
const shapes = [
  // "o"
  (x, y) => ellipseDist(x, y, 110, 165, 62, 70),
  // "8": two stacked loops
  (x, y) => ellipseDist(x, y, 290, 110, 48, 52),
  (x, y) => ellipseDist(x, y, 290, 207, 58, 58),
  // "g": bowl + stem + hook below the baseline
  (x, y) => ellipseDist(x, y, 465, 150, 58, 62),
  (x, y) => segDist(x, y, 523, 95, 523, 235),
]
const hook = quad([523, 235], [520, 300], [420, 268])
for (let i = 0; i < hook.length - 1; i++) {
  const [a, b] = [hook[i], hook[i + 1]]
  shapes.push((x, y) => segDist(x, y, a[0], a[1], b[0], b[1]))
}

const raw = Buffer.alloc((W + 1) * H)
for (let y = 0; y < H; y++) {
  raw[y * (W + 1)] = 0 // PNG filter type: none
  for (let x = 0; x < W; x++) {
    let ink = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS
        const py = y + (sy + 0.5) / SS
        if (shapes.some((d) => d(px, py) <= PEN)) ink++
      }
    }
    raw[y * (W + 1) + 1 + x] = Math.round(255 * (1 - ink / (SS * SS)))
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 0 // grayscale
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
writeFileSync(new URL('../public/sample.png', import.meta.url), png)
console.log(`wrote public/sample.png (${W}x${H}, ${png.length} bytes)`)
