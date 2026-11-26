import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export type WaveMode = 'idle' | 'processing' | 'listening'

const BAR = 3
const GAP = 2

/**
 * Scrolling bar waveform. `listening` reads the loudest of the given analysers each frame and
 * pushes it in from the right; `processing` runs a soft travelling wave (connecting); `idle` is a
 * flat dotted line. Bars fade toward the left edge so the newest sound is the brightest.
 */
export function LiveWaveform({ mode, sources, className }: { mode: WaveMode; sources: () => Array<AnalyserNode | null>; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const history = useRef<number[]>([])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const buf = new Uint8Array(512)
    let raf = 0
    let timer = 0
    let stopped = false
    let t = 0

    const draw = () => {
      if (stopped) return
      const dpr = devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== w * dpr) c.width = w * dpr
      if (c.height !== h * dpr) c.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = getComputedStyle(c).color
      const n = Math.floor(w / (BAR + GAP))
      const hist = history.current

      if (mode === 'listening') {
        let level = 0
        for (const a of sources()) {
          if (!a) continue
          a.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < a.fftSize && i < buf.length; i++) sum += ((buf[i] - 128) / 128) ** 2
          level = Math.max(level, Math.sqrt(sum / Math.min(a.fftSize, buf.length)))
        }
        hist.push(Math.min(1, level * 4))
      } else {
        hist.push(0)
      }
      while (hist.length > n) hist.shift()

      for (let i = 0; i < n; i++) {
        let v: number
        if (mode === 'processing') v = reduce ? 0.25 : 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(i * 0.35 - t * 0.12))
        else v = hist[hist.length - n + i] ?? 0
        const bh = Math.max(BAR, v * h)
        const x = i * (BAR + GAP)
        ctx.globalAlpha = 0.25 + 0.75 * (i / n)
        ctx.beginPath()
        ctx.roundRect(x, (h - bh) / 2, BAR, bh, BAR / 2)
        ctx.fill()
      }
      t++
      // reduced motion: listening still updates, but at a slow step instead of every frame
      if (mode !== 'idle' && !reduce) raf = requestAnimationFrame(draw)
      else if (mode === 'listening') timer = window.setTimeout(draw, 150)
    }
    draw()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [mode, sources])

  return <canvas ref={canvas} aria-hidden className={cn('block h-12 w-full', className)} />
}
