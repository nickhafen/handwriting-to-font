// Convert opentype.js path commands to our contour type. Type-only import, so
// this file also works in plain Node (where opentype.js named imports fail).
import type { PathCommand } from 'opentype.js'
import type { Contour } from '../geometry'

/** opentype.js path commands -> contours (for checking a parsed font). */
export function commandsToContours(commands: PathCommand[]): Contour[] {
  const out: Contour[] = []
  let cur: Contour | null = null
  let last = { x: 0, y: 0 }
  for (const c of commands) {
    if (c.type === 'M') {
      cur = { start: { x: c.x, y: c.y }, segments: [] }
      out.push(cur)
      last = { x: c.x, y: c.y }
    } else if (c.type === 'L') {
      cur?.segments.push({ type: 'L', to: { x: c.x, y: c.y } })
      last = { x: c.x, y: c.y }
    } else if (c.type === 'C') {
      cur?.segments.push({ type: 'C', c1: { x: c.x1, y: c.y1 }, c2: { x: c.x2, y: c.y2 }, to: { x: c.x, y: c.y } })
      last = { x: c.x, y: c.y }
    } else if (c.type === 'Q') {
      const to = { x: c.x, y: c.y }
      cur?.segments.push({
        type: 'C',
        c1: { x: last.x + (2 / 3) * (c.x1 - last.x), y: last.y + (2 / 3) * (c.y1 - last.y) },
        c2: { x: to.x + (2 / 3) * (c.x1 - to.x), y: to.y + (2 / 3) * (c.y1 - to.y) },
        to,
      })
      last = to
    }
  }
  return out.filter((c) => c.segments.length > 0)
}
