/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const BASE = '/handwriting-to-font/'

/**
 * Dev server only: lists and serves the images in ./samples (gitignored) at
 * `${BASE}__samples/`, for the "Load samples" button. Never part of a build.
 */
function devSamples(): Plugin {
  const dir = join(import.meta.dirname, 'samples')
  return {
    name: 'dev-samples',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(`${BASE}__samples`, (req, res) => {
        const name = decodeURIComponent((req.url ?? '/').replace(/^\//, '').split('?')[0])
        try {
          if (!name) {
            const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f))
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(files))
          } else if (!/[\\/]/.test(name) && /\.(jpe?g|png)$/i.test(name)) {
            res.setHeader('Content-Type', /\.png$/i.test(name) ? 'image/png' : 'image/jpeg')
            res.end(readFileSync(join(dir, name)))
          } else {
            res.statusCode = 400
            res.end()
          }
        } catch {
          res.statusCode = 404
          res.end(name ? '' : '[]')
        }
      })
    },
  }
}

export default defineConfig({
  // GitHub Pages serves the app from /<repo-name>/.
  base: BASE,
  plugins: [react(), devSamples()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
