import Sos from './Sos'
import { FORTUNES as SHARED, type Fortune as SharedFortune } from '../shared/fortunes.mjs'
import { useCallback, useEffect, useRef, useState } from 'react'

type Fortune = SharedFortune

// Index 0 = digit 1 ... index 9 = digit 0 (data lives in shared/fortunes.mjs)
const FORTUNES = SHARED

const PER = 30 // degrees of rotation per digit
const STOP = 120 // finger stop angle (clockwise from top)
const holeAngle = (idx: number) => 90 - (idx - 1) * PER // idx 1..10 (10 = digit 0)
const digitOf = (idx: number) => idx % 10
const polar = (a: number, r: number) => ({
  x: 150 + r * Math.sin((a * Math.PI) / 180),
  y: 150 - r * Math.cos((a * Math.PI) / 180),
})
const HOLES = Array.from({ length: 10 }, (_, i) => ({ idx: i + 1, ...polar(holeAngle(i + 1), 100) }))

type Phase = 'idle' | 'press' | 'auto' | 'returning' | 'result'
type Result = { digit: number; fortune: Fortune; lucky: number }

const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { /* ignore */ }
    ta.remove()
    return ok
  }
}

export default function App() {
  const svgRef = useRef<SVGSVGElement>(null)
  const discRef = useRef<SVGGElement>(null)
  const phase = useRef<Phase>('idle')
  const rot = useRef(0)
  const pending = useRef(0) // idx to deliver once the dial has returned
  const drag = useRef<{ idx: number; last: number; x: number; y: number; moved: boolean } | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('')

  const draw = () => discRef.current?.setAttribute('transform', `rotate(${rot.current} 150 150)`)

  // Animation loop: hold-to-dial, auto-dial and spring-back
  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.05)
      prev = now
      const p = phase.current
      if (p === 'press' && drag.current && !drag.current.moved) {
        rot.current = Math.min(rot.current + 260 * dt, drag.current.idx * PER)
        draw()
      } else if (p === 'auto') {
        rot.current += 260 * dt
        if (rot.current >= pending.current * PER) {
          rot.current = pending.current * PER
          phase.current = 'returning'
        }
        draw()
      } else if (p === 'returning') {
        rot.current -= 330 * dt
        if (rot.current <= 0) {
          rot.current = 0
          const idx = pending.current
          pending.current = 0
          if (idx) {
            phase.current = 'result'
            const lucky = 1 + Math.floor(Math.random() * 99)
            setResult({ digit: digitOf(idx), fortune: FORTUNES[idx - 1], lucky })
            // The server stores this stick and schedules the 3 texts (works even if the page closes).
            fetch('/api/draw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ digit: digitOf(idx), lucky }) }).catch(() => {})
            setCopied('')
          } else {
            phase.current = 'idle'
            setPick(null)
          }
        }
        draw()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const autoDial = useCallback((idx: number) => {
    pending.current = idx
    phase.current = 'auto'
    setPick(digitOf(idx))
  }, [])

  // Keyboard: press 0-9 to dial
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase.current !== 'idle' || !/^[0-9]$/.test(e.key)) return
      const d = Number(e.key)
      autoDial(d === 0 ? 10 : d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [autoDial])

  const pointAt = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * 300, y: ((e.clientY - r.top) / r.height) * 300 }
  }
  const angleAt = (p: { x: number; y: number }) => (Math.atan2(p.x - 150, 150 - p.y) * 180) / Math.PI

  const onDown = (e: React.PointerEvent) => {
    if (phase.current !== 'idle') return
    const p = pointAt(e)
    const hole = HOLES.find((h) => Math.hypot(h.x - p.x, h.y - p.y) < 26)
    if (!hole) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { idx: hole.idx, last: angleAt(p), x: e.clientX, y: e.clientY, moved: false }
    phase.current = 'press'
    setPick(digitOf(hole.idx))
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || phase.current !== 'press') return
    const a = angleAt(pointAt(e))
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true
    if (d.moved) rot.current = Math.max(0, Math.min(d.idx * PER, rot.current + norm(a - d.last)))
    d.last = a
    draw()
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || phase.current !== 'press') return
    drag.current = null
    const cancelled = e.type === 'pointercancel'
    if (!d.moved && !cancelled) {
      autoDial(d.idx) // a tap rolls all the way round
    } else if (!cancelled && rot.current >= d.idx * PER - 15) {
      pending.current = d.idx
      phase.current = 'returning'
    } else {
      pending.current = 0
      phase.current = 'returning'
    }
  }

  const dialAgain = () => {
    fetch('/api/draw/cancel', { method: 'POST' }).catch(() => {}) // drop pending texts from the old stick
    setResult(null)
    setPick(null)
    phase.current = 'idle'
  }

  const shareText = result
    ? `签 Dial a Fortune #${result.digit}\n"${result.fortune.main}"\n${result.fortune.sub}\nLucky number: ${result.lucky}`
    : ''
  const copy = async () => {
    setCopied((await copyText(shareText)) ? 'ok' : 'fail')
  }

  return (
    <main className="app">
      <header>
        <h1>
          Dial a Fortune <span className="stamp">签</span>
        </h1>
        <p className="lcd" aria-live="polite">
          {pick === null ? 'Ready 请拨号' : `Dialing ${pick}…`}
        </p>
      </header>

      <svg
        ref={svgRef}
        className="dial"
        viewBox="0 0 300 300"
        role="img"
        aria-label="Rotary phone dial. Press a number or type 0 to 9."
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <defs>
          <mask id="holes" maskUnits="userSpaceOnUse" x="0" y="0" width="300" height="300">
            <rect width="300" height="300" fill="#fff" />
            {HOLES.map((h) => (
              <circle key={h.idx} cx={h.x} cy={h.y} r="21" fill="#000" />
            ))}
          </mask>
        </defs>
        {/* fixed backplate with numbers */}
        <circle cx="150" cy="150" r="148" fill="#FFF8E6" stroke="#2B0A0A" strokeWidth="4" />
        {HOLES.map((h) => (
          <text key={h.idx} x={h.x} y={h.y} className="num" textAnchor="middle" dominantBaseline="central">
            {digitOf(h.idx)}
          </text>
        ))}
        {/* rotating disc */}
        <g ref={discRef}>
          <circle cx="150" cy="150" r="146" fill="#A3101B" mask="url(#holes)" />
          {HOLES.map((h) => (
            <circle key={h.idx} cx={h.x} cy={h.y} r="21" fill="none" stroke="#2B0A0A" strokeWidth="3" />
          ))}
          <circle cx="150" cy="150" r="46" fill="#FFF8E6" stroke="#2B0A0A" strokeWidth="4" />
          <text x="150" y="152" className="hub" textAnchor="middle" dominantBaseline="central">运</text>
        </g>
        {/* finger stop */}
        <g transform={`rotate(${STOP} 150 150)`}>
          <rect x="142" y="2" width="16" height="36" rx="6" fill="#2B0A0A" stroke="#FFF8E6" strokeWidth="2" />
        </g>
      </svg>

      <p className="hint">
        Drag a number clockwise to the stop, or tap &amp; hold it.
        <br />
        顺时针拨动数字，再松手。
      </p>

      <section className={`card ${result ? 'open' : ''}`} aria-hidden={!result}>
        {result && (
          <>
            <div className="row">
              <span className="digit">{result.digit}</span>
              <span className="tag">
                {result.fortune.tag} <b>{result.fortune.zhTag}</b>
              </span>
              <span className="lucky">
                Lucky 幸运号
                <strong>{result.lucky}</strong>
              </span>
            </div>
            <p className="main">{result.fortune.main}</p>
            <p className="sub">{result.fortune.sub}</p>
            <p className="meta">
              <span>{result.fortune.level.en} <b>{result.fortune.level.zh}</b></span>
              <span><i className="swatch" style={{ background: result.fortune.color.hex }} />{result.fortune.color.en} <b>{result.fortune.color.zh}</b></span>
            </p>
            <p className="todayTip"><b>Today's tip 今日提示:</b> {result.fortune.tip}</p>
            <Sos fortune={{ digit: result.digit, stick: result.lucky, poem: result.fortune.main, poemAlt: result.fortune.sub, topic: result.fortune.tag }} />
            <div className="btns">
              <button className="primary" onClick={dialAgain}>Dial again 再拨</button>
              <button onClick={copy}>
                {copied === 'ok' ? 'Copied! 已复制' : copied === 'fail' ? 'Copy failed 复制失败' : 'Copy my fortune 复制'}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
