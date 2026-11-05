import { useEffect, useState } from 'react'
import { DEFAULT_TRACE_OPTIONS, traceToSvg, type TraceOptions } from '../core/trace/potrace'

const SAMPLE_URL = `${import.meta.env.BASE_URL}sample.png`

interface Traced {
  imageUrl: string
  svgUrl: string
  svg: string
  pathCount: number
  ms: number
}

export function PotraceCheck() {
  const [source, setSource] = useState<Blob | null>(null)
  const [sourceName, setSourceName] = useState('sample.png')
  const [options, setOptions] = useState<TraceOptions>(DEFAULT_TRACE_OPTIONS)
  const [traced, setTraced] = useState<Traced | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load the bundled sample on first render.
  useEffect(() => {
    fetch(SAMPLE_URL)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSource)
      .catch((e) => setError(`Couldn't load sample: ${e}`))
  }, [])

  // Re-trace whenever the image or options change.
  useEffect(() => {
    if (!source) return
    let cancelled = false
    const t0 = performance.now()
    traceToSvg(source, options)
      .then((svg) => {
        if (cancelled) return
        const ms = Math.round(performance.now() - t0)
        const pathCount = (svg.match(/<path/g) ?? []).length
        setTraced((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev.imageUrl)
            URL.revokeObjectURL(prev.svgUrl)
          }
          return {
            imageUrl: URL.createObjectURL(source),
            svgUrl: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })),
            svg,
            pathCount,
            ms,
          }
        })
        setError(null)
      })
      .catch((e) => !cancelled && setError(`Trace failed: ${e}`))
    return () => {
      cancelled = true
    }
  }, [source, options])

  const num = (key: keyof TraceOptions, label: string, step: number) => (
    <label>
      {label}{' '}
      <input
        type="number"
        step={step}
        min={0}
        value={options[key]}
        onChange={(e) => setOptions({ ...options, [key]: Number(e.target.value) })}
      />
    </label>
  )

  return (
    <section aria-labelledby="potrace-h">
      <h2 id="potrace-h">2. Potrace (WASM) check</h2>
      <p>
        Traces a black-and-white image into vector outlines in the browser. Starts with a bundled sample; you can also
        try your own PNG or JPG of handwriting.
      </p>
      <div className="row">
        <label>
          Image{' '}
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) {
                setSource(f)
                setSourceName(f.name)
              }
            }}
          />
        </label>
        {num('turdsize', 'turdsize', 1)}
        {num('alphamax', 'alphamax', 0.1)}
        {num('opttolerance', 'opttolerance', 0.1)}
      </div>
      {error && <p role="alert" className="bad">{error}</p>}
      {traced && (
        <>
          <p>
            <code>{sourceName}</code>: {traced.pathCount} path element(s), traced in {traced.ms} ms.
          </p>
          <div className="compare">
            <figure>
              <img src={traced.imageUrl} alt="Original image" />
              <figcaption>Original bitmap</figcaption>
            </figure>
            <figure>
              <img src={traced.svgUrl} alt="Traced vector outlines" className="traced" />
              <figcaption>Potrace vector output</figcaption>
            </figure>
          </div>
          <details>
            <summary>Raw SVG ({traced.svg.length.toLocaleString()} characters)</summary>
            <pre>{traced.svg.slice(0, 4000)}{traced.svg.length > 4000 ? '\n…' : ''}</pre>
          </details>
        </>
      )}
    </section>
  )
}
