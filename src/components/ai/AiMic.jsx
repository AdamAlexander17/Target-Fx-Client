import { useEffect, useRef, useState } from 'react'
import { aiAPI } from '../../services/api'

const BARS = 200 // waveform history; enough bars to fill the whole message box on wide screens (extra ones are clipped on the left)

// Voice question: record with MediaRecorder, send the raw audio to /ai/transcribe, hand the
// text back. Hidden entirely when the server has no STT configured (/ai/transcribe/status).
// While recording, the message box turns into a recorder (it overlays the nearest positioned
// parent, the composer form): ✕ discards,
// ↑ stops and sends it straight away as a voice message (onVoice gets the audio + transcript).
// ■ stops and keeps the recording as a clip to play back; ↑ then sends it, ✕ discards it.
const AiMic = ({ onTranscript, onVoice, disabled }) => {
  const [available, setAvailable] = useState(false)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState(() => Array(BARS).fill(0))
  const [failed, setFailed] = useState('')
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const audioRef = useRef(null) // { context, analyser, timer }
  const finishRef = useRef('cancel') // what to do when the recorder stops: 'cancel' | 'review' | 'send'
  const [clip, setClip] = useState(null) // stopped recording waiting to be sent: { blob, url, seconds }

  useEffect(() => {
    let active = true
    aiAPI.getTranscribeStatus().then(s => { if (active) setAvailable(!!s?.enabled) }).catch(() => {})
    return () => { active = false }
  }, [])

  const secondsRef = useRef(0)
  useEffect(() => { secondsRef.current = seconds }, [seconds])
  // Elapsed time while recording
  useEffect(() => {
    if (!recording) return undefined
    setSeconds(0)
    const timer = setInterval(() => setSeconds(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])

  useEffect(() => {
    if (!failed) return undefined
    const timer = setTimeout(() => setFailed(''), 4000)
    return () => clearTimeout(timer)
  }, [failed])

  const stopMeter = () => {
    const meter = audioRef.current
    if (!meter) return
    clearInterval(meter.timer)
    meter.context.close?.().catch(() => {})
    audioRef.current = null
  }
  const stopStream = () => {
    stopMeter()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  // Live input level for the waveform (RMS of the mic signal, sampled ~12 times a second)
  const startMeter = stream => {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      context.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (const value of data) { const centred = (value - 128) / 128; sum += centred * centred }
        const level = Math.min(1, Math.sqrt(sum / data.length) * 4)
        setLevels(current => [...current.slice(1), level])
      }, 80)
      audioRef.current = { context, analyser, timer }
    } catch { /* no waveform, recording still works */ }
  }

  const sendVoice = async blob => {
    setBusy(true)
    try {
      const out = await aiAPI.transcribeAudio(blob)
      if (!out?.text) { setFailed('Could not hear a question. Please try again.'); return false }
      if (onVoice) onVoice(blob, out.text)
      else onTranscript?.(out.text)
      return true
    } catch { setFailed('Voice could not be processed. Please try again or type.'); return false }
    finally { setBusy(false) }
  }
  const discardClip = () => setClip(current => { if (current) URL.revokeObjectURL(current.url); return null })
  const sendClip = async () => {
    if (!clip) return
    const sent = await sendVoice(clip.blob)
    if (sent) setClip(null) // the chat keeps using the same audio, so its URL is not revoked here
  }

  const start = async () => {
    if (recording || busy || clip) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      finishRef.current = 'cancel'
      setLevels(Array(BARS).fill(0))
      const mime = ['audio/webm', 'audio/ogg', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported?.(t)) || ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorder.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stopStream()
        setRecording(false)
        const mode = finishRef.current
        if (mode === 'cancel') return
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size < 500) { setFailed('That was too short. Please try again.'); return }
        // ■ keeps the audio as a clip to play back, then ↑ sends it; ↑ while recording sends at once
        if (mode === 'review') { setClip({ blob, url: URL.createObjectURL(blob), seconds: secondsRef.current }); return }
        await sendVoice(blob)
      }
      recorderRef.current = recorder
      recorder.start()
      startMeter(stream)
      setRecording(true)
    } catch { setFailed('Microphone not available. Allow mic access in the browser.') }
  }

  const finish = mode => {
    finishRef.current = mode
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  useEffect(() => () => { finishRef.current = 'cancel'; recorderRef.current?.state === 'recording' && recorderRef.current.stop(); stopStream() }, [])

  if (!available) return null

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const roundButton = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition'

  return (
    <>
      {/* Recorder: covers the message box while recording or converting */}
      {(recording || busy || clip) && (
        <div className="absolute inset-[1px] z-10 flex items-center gap-2 rounded-[15px] bg-white px-2.5 sm:px-3" role="group" aria-label="Voice recorder">
          <button type="button" onClick={() => (clip ? discardClip() : finish('cancel'))} disabled={busy} aria-label={clip ? 'Discard recording' : 'Cancel recording'} title={clip ? 'Discard' : 'Cancel'}
            className={`${roundButton} border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40`}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          {busy ? (
            <p className="flex min-w-0 flex-1 items-center justify-center gap-2 text-[13px] font-medium text-slate-500" role="status">
              <svg className="h-4 w-4 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeOpacity=".3" strokeWidth="2.4" /><path d="M20 12a8 8 0 0 1-8 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
              Sending your voice…
            </p>
          ) : clip ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <audio controls controlsList="nodownload noplaybackrate" onContextMenu={event => event.preventDefault()} preload="metadata" src={clip.url} className="h-9 min-w-0 flex-1" aria-label="Your recording" />
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600" aria-hidden="true"><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg></span>
            </div>
          ) : (
            <>
              {/* Waveform: newest level on the right; quiet moments show as dots */}
              <div className="flex h-9 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden" aria-hidden="true">
                {levels.map((level, index) => (
                  <span key={index} className={`w-[3px] shrink-0 rounded-full ${level > 0.04 ? 'bg-slate-500' : 'bg-slate-300'}`} style={{ height: `${Math.max(3, Math.round(level * 30))}px` }} />
                ))}
              </div>
              <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums text-slate-500" role="timer">{clock}</span>
            </>
          )}
          {!clip && <button type="button" onClick={() => finish('review')} disabled={busy} aria-label="Stop recording" title="Stop (listen before sending)"
            className={`${roundButton} border-2 border-blue-500 text-slate-900 hover:bg-blue-50 disabled:opacity-40`}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
          </button>}
          <button type="button" onClick={() => (clip ? sendClip() : finish('send'))} disabled={busy} aria-label="Send voice message" title="Send"
            className={`${roundButton} bg-gradient-to-br from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 disabled:opacity-40`}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      )}
      <span className="relative mb-0.5 shrink-0">
        {failed && <span className="absolute bottom-full right-0 mb-2 w-max max-w-[240px] rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg" role="alert">{failed}</span>}
        <button
          type="button"
          onClick={start}
          disabled={disabled || busy || recording || !!clip}
          aria-label="Ask by voice"
          title="Ask by voice"
          className={`${roundButton} text-slate-500 hover:bg-slate-100 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </span>
    </>
  )
}

export default AiMic
