import { useState } from 'react'

// Status pill + accent per action state
const STATE_STYLE = {
  pending: { pill: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500 animate-pulse', label: 'Awaiting confirmation', accent: 'from-blue-500 to-indigo-500' },
  executing: { pill: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400 animate-pulse', label: 'Applying…', accent: 'from-slate-300 to-slate-400' },
  executed: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', label: 'Executed', accent: 'from-emerald-400 to-emerald-600' },
  failed: { pill: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500', label: 'Failed', accent: 'from-red-400 to-red-600' },
  cancelled: { pill: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-400', label: 'Cancelled', accent: 'from-slate-200 to-slate-300' },
  expired: { pill: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500', label: 'Expired', accent: 'from-amber-300 to-amber-400' },
}
// Password resets (kind "reset_*"): the broker types or generates the new password on the card and it
// is sent only in the confirm call — it never passes through the chat. Same rule as the AI backend:
// 8–64 characters, at least one letter and one digit, no spaces.
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)\S{8,64}$/
// 12 characters, always at least one upper, one lower and one digit (MT5 accepts this)
const generatePassword = () => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghjkmnpqrstuvwxyz', digits = '23456789', all = upper + lower + digits
  const pick = set => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length]
  const chars = [pick(upper), pick(lower), pick(digits)]
  while (chars.length < 12) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]] }
  return chars.join('')
}
const ROW_STATE_CLASS = { done: 'text-emerald-700 font-medium', failed: 'text-red-700 font-medium', running: 'text-blue-600 font-medium', skipped: 'text-slate-400' }

// Icon for the kind of action (key for passwords, coin for credit, shield for rules, bolt otherwise)
const KindIcon = ({ kind }) => {
  const k = String(kind || '')
  const path = k.startsWith('reset_')
    ? <><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.7-8.7M16 7l2.5 2.5M18.5 4.5 21 7" /></>
    : /credit|deposit|withdraw|balance/.test(k)
      ? <><circle cx="12" cy="12" r="8.5" /><path d="M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.7 0-2.8.8-2.8 2s1 1.7 2.8 2 2.8.8 2.8 2-1.1 2-2.8 2c-1.2 0-2.3-.5-2.9-1.3M12 6.5V8m0 8v1.5" /></>
      : /rule|access|trading|enable|disable/.test(k)
        ? <><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6Z" /><path d="m9 12 2 2 4-4" /></>
        : <path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z" />
  return <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
}

// A proposed credit/rule/account action awaiting the broker's confirmation, sent as an
// `action` SSE event: { action: card }. `card` matches store.action_view() in the backend:
// { id, kind, label, summary, payload: { details: [[label,value]], items?: [...bulk] }, status }.
const AiActionCard = ({ action, onConfirm, onCancel, busy }) => {
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)
  if (!action) return null
  const style = STATE_STYLE[action.status] || STATE_STYLE.pending
  const details = action.payload?.details || []
  const items = action.payload?.items
  const isPending = action.status === 'pending'
  const inactive = ['cancelled', 'expired'].includes(action.status)
  const needsPassword = String(action.kind || '').startsWith('reset_')
  const passwordOk = !needsPassword || PASSWORD_RULE.test(password)
  const minutesLeft = isPending && action.expires_at ? Math.max(0, Math.round((new Date(action.expires_at) - Date.now()) / 60000)) : null
  const copyPassword = () => {
    navigator.clipboard?.writeText(password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  return (
    <div className="relative w-full min-w-0 max-w-[600px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      {/* Accent strip in the state colour */}
      <div className={`h-1 w-full bg-gradient-to-r ${style.accent}`} />

      {/* Header: icon, title, subtitle, status */}
      <div className="flex min-w-0 flex-wrap items-start gap-2 px-4 pb-3 pt-3.5 sm:flex-nowrap sm:gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${inactive ? 'bg-slate-100 text-slate-400' : 'bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-600 ring-1 ring-blue-100'}`}>
          <KindIcon kind={action.kind} />
        </span>
        <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-0">
          <p className={`text-[14px] font-semibold leading-5 ${inactive ? 'text-slate-500' : 'text-slate-900'}`}>{action.label || action.summary}</p>
          {action.summary && action.label && <p className="mt-0.5 truncate text-[12px] text-slate-500">{action.summary}</p>}
        </div>
        <span className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${style.pill}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />{style.label}
        </span>
      </div>

      {/* Details */}
      {details.length > 0 && (
        <dl className={`mx-4 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60 ${inactive ? 'opacity-75' : ''}`}>
          {details.map(([label, value], i) => (
            <div key={i} className="grid min-w-0 grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2 text-[13px] max-sm:grid-cols-[80px_minmax(0,1fr)] max-sm:gap-2">
              <dt className="text-slate-500">{label}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere] font-medium text-slate-800">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {Array.isArray(items) && items.length > 0 && (
        <div className="mx-4 mt-3 max-h-56 overflow-auto rounded-xl border border-slate-100">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50"><tr className="text-slate-500"><th className="px-3 py-2 text-left font-semibold">Login</th><th className="px-3 py-2 text-left font-semibold">Name</th><th className="px-3 py-2 text-right font-semibold">Status</th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.login}-${i}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{it.login}</td>
                  <td className="px-3 py-1.5 text-slate-600">{it.name || '—'}</td>
                  <td className={`px-3 py-1.5 text-right ${ROW_STATE_CLASS[it.status] || 'text-slate-500'}`}>{it.note || it.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New password (password resets only) */}
      {needsPassword && (isPending || action.status === 'executing') && (
        <div className="mx-4 mt-3 rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/70 to-indigo-50/40 p-3">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-blue-700">New password</label>
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="text" autoComplete="off" spellCheck={false} aria-label="New password"
                value={password} disabled={!isPending || busy || confirming}
                onChange={event => setPassword(event.target.value)}
                placeholder="8+ characters, letters and digits"
                className={`h-10 w-full rounded-lg border bg-white pl-3 pr-9 font-mono text-[13.5px] tracking-wide text-slate-800 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-50 ${password && !passwordOk ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'}`}
              />
              {password && <button type="button" onClick={copyPassword} title={copied ? 'Copied' : 'Copy password'} aria-label="Copy password" className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                {copied
                  ? <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                  : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>}
              </button>}
            </div>
            <button type="button" disabled={!isPending || busy || confirming} onClick={() => setPassword(generatePassword())} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 text-[12px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
              Generate
            </button>
          </div>
          <p className={`mt-1.5 text-[11.5px] ${password && !passwordOk ? 'text-red-600' : 'text-slate-500'}`}>{password && !passwordOk ? 'Use 8–64 characters with at least one letter and one digit, no spaces.' : 'Copy the password to the client before you confirm. Ask AI does not keep it.'}</p>
        </div>
      )}

      {/* Outcome messages */}
      <div className="px-4 pb-3.5 pt-3 empty:hidden">
        {needsPassword && action.status === 'executed' && <p className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>Password changed. Make sure the client has the new password.</p>}
        {action.status === 'expired' && <p className="text-[12.5px] text-slate-500">Not confirmed in time. Ask again if you still want it.</p>}
        {action.status === 'cancelled' && <p className="text-[12.5px] text-slate-500">This action was cancelled. Nothing was changed.</p>}
        {action.result?.message && <p className="text-[13px] text-slate-600">{action.result.message}</p>}
        {action.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{action.error}</p>}

        {isPending && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !passwordOk}
              onClick={() => { setConfirming(true); Promise.resolve(onConfirm(action.id, needsPassword ? { password } : undefined)).finally(() => setConfirming(false)) }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-b from-blue-600 to-blue-700 px-4 text-[13px] font-semibold text-white shadow-[0_4px_10px_rgba(37,99,235,0.3)] hover:from-blue-700 hover:to-blue-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
              {confirming ? 'Confirming…' : 'Confirm'}
            </button>
            <button type="button" disabled={busy} onClick={() => onCancel(action.id)} className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <span className="ml-auto flex items-center gap-1 text-[11.5px] text-slate-400">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              {minutesLeft != null ? (minutesLeft ? `Expires in ${minutesLeft} min` : 'Expiring') : 'Audited · applied with your rights'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default AiActionCard
