import { useEffect, useState } from 'react'

export type SosFortune = { digit: number; stick: number; poem: string; poemAlt: string; topic: string }
type SosError = { code: string | number; message: string }
type Job = {
  id: string; phase: 'scheduled' | 'placing' | 'placed' | 'error'; callAt: number
  sid?: string; status?: string; duration?: string; error?: SosError
}
type Step = { say?: string; pause?: number }

const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error?.message || 'Something went wrong'), { code: j.error?.code ?? r.status })
  return j
}
const BAD = new Set(['failed', 'busy', 'no-answer', 'canceled'])
const isFinal = (j: Job) => j.phase === 'error' || (j.phase === 'placed' && (BAD.has(j.status || '') || j.status === 'completed'))

export default function Sos({ fortune }: { fortune: SosFortune }) {
  const [situation, setSituation] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [err, setErr] = useState<SosError | null>(null)
  const [trial, setTrial] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    fetch('/api/sos/info').then((r) => r.json()).then((j) => setTrial(!!j.trial)).catch(() => {})
  }, [])

  // Poll the server for the real call state; tick the countdown while scheduled.
  useEffect(() => {
    if (!job || isFinal(job)) return
    const tick = window.setInterval(() => setNow(Date.now()), 250)
    const poll = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/sos/status/${job.id}`)
        if (r.ok) setJob(await r.json())
      } catch { /* keep last status */ }
    }, 1500)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [job])

  const trigger = async () => {
    setErr(null); setJob(null)
    try {
      const j = await post('/api/sos', { situation })
      if (j.trial) setTrial(true)
      setJob(j)
    } catch (e) {
      const x = e as Error & { code?: string | number }
      setErr({ code: x.code ?? 'ERROR', message: x.message })
    }
  }

  const preview = async () => {
    setErr(null)
    try {
      const r = await post('/api/sos/preview', { fortune, situation })
      setSteps(r.steps); setSecs(r.seconds)
    } catch (e) {
      setErr({ code: 'PREVIEW', message: (e as Error).message })
    }
  }

  const shown = job?.phase === 'error' ? job.error : job?.error ?? err
  const left = job ? Math.max(0, Math.ceil((job.callAt - now) / 1000)) : 0
  const busy = !!job && !isFinal(job)
  let label = ''
  if (job?.phase === 'scheduled') label = left > 0 ? `Calling in ${left}s` : 'Placing the call…'
  else if (job?.phase === 'placing') label = 'Placing the call…'
  else if (job?.phase === 'placed' && !BAD.has(job.status || '')) {
    // "Call done" appears only once Twilio has returned a SID with status queued or ringing.
    label = job.status === 'queued' || job.status === 'ringing' ? 'Call done'
      : job.status === 'in-progress' ? 'On the line' : 'Call completed'
  }

  return (
    <div className="sos">
      {trial && (
        <p className="trial" role="note">Trial account: destination must be a Verified Caller ID in the Twilio console.</p>
      )}
      <div className="sosFields">
        <input
          placeholder="Situation? e.g. presenting" aria-label="Situation (optional)" maxLength={24}
          value={situation} onChange={(e) => setSituation(e.target.value)}
        />
      </div>
      <button className="sosBtn" onClick={trigger} disabled={busy}>SOS Stick 救急签</button>
      <p className="tip">Pro tip: save this number as 'YY' so nobody suspects a thing 😉</p>
      {label && (
        <p className={`status ${job?.phase === 'placed' ? 'done' : ''}`} role="status">
          <b>{label}</b>
          {job?.phase === 'placed' && (
            <span className="sid"> · {job.status}<br />SID {job.sid}</span>
          )}
        </p>
      )}
      {shown && (
        <p className="err" role="alert">
          Error {shown.code}: {shown.message}
          {job?.phase === 'placed' && job.sid && <><br />SID {job.sid}</>}
        </p>
      )}
      <button className="link" onClick={preview}>Preview the pep talk 预览</button>
      {steps && (
        <div className="script">
          <p className="tip">About {secs}s when spoken</p>
          {steps.map((s, i) => s.say
            ? <p key={i}>{s.say}</p>
            : (s.pause ?? 0) >= 2 ? <p key={i} className="pause">· · ·</p> : null)}
        </div>
      )}
      <p className="tip">Or text “SOS” (or “SOS presenting”) to the fortune line. 短信也行。</p>
    </div>
  )
}
