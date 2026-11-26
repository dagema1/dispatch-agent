import { createFileRoute } from '@tanstack/react-router'
import { Camera, Check, CheckCircle2, ChevronDown, CircleAlert, Mic, Phone, PhoneOff, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { bookOnline } from '#/fns'
import { CustomerShell } from '#/ui/CustomerShell'
import { fileToMedia } from '#/ui/format'
import { LiveWaveform, type WaveMode } from '#/ui/LiveWaveform'
import type { Turn, VoiceCall, VoiceState } from '#/ui/voice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/book')({
  component: Book,
  head: () => ({
    meta: [{ title: 'Book a visit · Northline Heating & Plumbing' }],
  }),
})

function Book() {
  const [mode, setMode] = useState<'call' | 'form'>('call')
  return (
    <CustomerShell wide sub="Denver metro · open 24/7 for emergencies">
      <div className="flex flex-col items-center pt-2 pb-8 text-center sm:pt-6">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          How can we <span className="font-display text-[1.12em] text-primary">help</span>?
        </h1>
        <p className="mt-4 max-w-md text-pretty text-muted-foreground">
          No heat, a leak, a dead AC? Talk to our receptionist or send the details. You'll get a confirmed arrival window in under a minute.
        </p>
      </div>
      <fieldset aria-label="How to reach us" className="grid grid-cols-2 gap-3">
        <Choice on={mode === 'call'} onPick={() => setMode('call')} icon={Phone} tile="tile-action" title="Talk to us" sub="Voice call · about 2 min" />
        <Choice on={mode === 'form'} onPick={() => setMode('form')} icon={Camera} tile="tile-action" title="Write it down" sub="Details and photos" />
      </fieldset>
      {/* both stay mounted so switching never drops a live call or a half-typed form */}
      <div className={cn('mt-3', mode !== 'call' && 'hidden')}>
        <CallPanel />
      </div>
      <div className={cn('mt-3', mode !== 'form' && 'hidden')}>
        <FormPanel />
      </div>
      <p className="mt-8 text-center text-xs text-muted-foreground">Demo company with fictional data.</p>
    </CustomerShell>
  )
}

/** Large radio card for picking how to get in touch: a native radio, so arrow keys and screen readers just work. */
function Choice({
  on,
  onPick,
  icon: Icon,
  tile,
  title,
  sub,
}: {
  on: boolean
  onPick: () => void
  icon: React.ComponentType<{ className?: string }>
  tile: string
  title: string
  sub: string
}) {
  return (
    <label
      className={cn(
        'slab relative flex min-w-0 cursor-pointer items-center gap-3 rounded-3xl border p-3 transition-[box-shadow,background-color] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring sm:p-4',
        on ? 'border-primary outline-1 outline-primary' : 'hover:bg-foreground/5',
      )}
    >
      <input type="radio" name="contact-mode" className="sr-only" checked={on} onChange={onPick} />
      <span className="shrink-0 max-sm:hidden">
        <span className={cn('tile size-10 rounded-xl', tile)}>
          <Icon className="size-5" />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <span
        className={cn('ml-auto grid size-5 shrink-0 place-items-center rounded-full border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}
        aria-hidden
      >
        {on && <Check className="size-3" />}
      </span>
    </label>
  )
}

function CallPanel() {
  const [state, setState] = useState<VoiceState>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [speaking, setSpeaking] = useState<'caller' | 'agent' | null>(null)
  const [booked, setBooked] = useState<Record<string, unknown> | null>(null)
  const call = useRef<VoiceCall | null>(null)
  const end = useRef<HTMLDivElement>(null)
  // remembered on this device only, so a caller who rings back is recognised without retyping
  const [phone, setPhone] = useState('')
  useEffect(() => {
    try {
      setPhone(localStorage.getItem('caller-phone') ?? '')
    } catch {}
  }, [])
  // the transcript stays folded away unless the caller opens it
  const [showText, setShowText] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the transcript grows or opens
  useEffect(() => {
    if (showText) end.current?.scrollIntoView({ block: 'nearest' })
  }, [turns, showText])
  useEffect(() => {
    return () => {
      call.current?.hangUp()
    }
  }, [])

  const start = async () => {
    setErr(null)
    setTurns([])
    setBooked(null)
    const { VoiceCall } = await import('#/ui/voice')
    call.current = new VoiceCall({
      state: (s, d) => {
        setState(s)
        if (s === 'error') setErr(d ?? 'Something went wrong')
      },
      transcript: setTurns,
      level: setSpeaking,
      booked: setBooked,
    })
    try {
      if (phone.trim()) localStorage.setItem('caller-phone', phone.trim())
    } catch {}
    await call.current.start(phone.trim())
  }
  const live = state === 'live'
  const sources = useCallback(() => [call.current?.micAnalyser ?? null, call.current?.outAnalyser ?? null], [])
  const mode: WaveMode = live ? 'listening' : state === 'connecting' ? 'processing' : 'idle'
  return (
    <Card className="rounded-3xl">
      <CardContent className="px-6 sm:px-10">
        <div className="mx-auto flex max-w-sm flex-col items-center py-6 text-center">
          <span className="tile tile-action size-14 rounded-full">{live ? <Mic className="size-6" /> : <Phone className="size-6" />}</span>
          <h2 className="mt-5 text-2xl font-bold tracking-tight">
            {live ? (speaking === 'agent' ? 'Receptionist speaking' : 'We’re listening') : state === 'connecting' ? 'Connecting you' : 'Talk to our receptionist'}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground" aria-live="polite">
            {live
              ? 'Describe the problem and your address. We’ll book you while you talk.'
              : state === 'connecting'
                ? 'Allow the microphone if your browser asks.'
                : state === 'error'
                  ? 'The call ended. You can start again or send the details instead.'
                  : 'Uses your microphone. Speak naturally; you’ll get a confirmed arrival window before you hang up.'}
          </p>
          <LiveWaveform mode={mode} sources={sources} className={cn('mt-6', live ? 'text-primary' : 'text-muted-foreground')} />
          {live || state === 'connecting' ? (
            <Button className="mt-6 h-12 w-full bg-red-600 text-base text-white hover:bg-red-500" onClick={() => call.current?.hangUp()}>
              <PhoneOff /> Hang up
            </Button>
          ) : (
            <div className="mt-6 w-full space-y-3 text-left">
              <div>
                <Label htmlFor="caller-phone" className="mb-1.5">
                  Your phone number <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="caller-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(303) 555-0187"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 rounded-xl"
                  aria-describedby="caller-phone-hint"
                />
                <p id="caller-phone-hint" className="mt-1 text-xs text-muted-foreground">
                  Calling back about a visit, or got cut off? With your number we pick up where you left off.
                </p>
              </div>
              <Button className="h-12 w-full text-base" onClick={start} disabled={state === 'ending'}>
                <Phone /> Start call
              </Button>
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">Calls are transcribed so your booking is accurate.</p>
          {err && (
            <Alert variant="destructive" className="mt-4 text-left">
              <CircleAlert />
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
        </div>
        {booked && <BookedCard r={booked} />}
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => setShowText((v) => !v)}
            aria-expanded={showText}
            aria-controls="call-transcript"
            className="mx-auto mt-4 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className={cn('size-3.5 transition-transform duration-200', showText && 'rotate-180')} />
            {showText ? 'Hide transcript' : `Show transcript (${turns.length})`}
          </button>
        )}
        {turns.length > 0 && showText && (
          <div id="call-transcript" className="route-in mt-2 max-h-72 space-y-2 overflow-y-auto rounded-xl well p-3">
            {turns.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript; a turn never moves
              <div key={i} className={cn('arrive-pop flex', t.role === 'caller' && 'justify-end')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                    t.role === 'caller' ? 'bg-accent text-accent-foreground' : 'bg-card text-card-foreground',
                  )}
                >
                  {t.text}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BookedCard({ r }: { r: Record<string, unknown> }) {
  if (r.status !== 'booked') return null
  return (
    <Alert className="mt-2 border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
      <CheckCircle2 className="text-emerald-600" />
      <AlertTitle>Booked</AlertTitle>
      <AlertDescription className="text-inherit">
        {String(r.technician)} arrives {String(r.arrival)}. {r.safetyAdvice ? <span className="font-medium text-destructive">Please follow the safety advice given.</span> : null}
      </AlertDescription>
    </Alert>
  )
}

const field = 'h-10 text-base sm:text-sm'

function FormPanel() {
  const [f, setF] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    issue: '',
  })
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [res, setRes] = useState<Awaited<ReturnType<typeof bookOnline>> | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const photos = await Promise.all(files.slice(0, 4).map(fileToMedia))
      setRes(
        await bookOnline({
          data: { ...f, photos: photos.length ? photos : undefined },
        }),
      )
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (res)
    return (
      <Card>
        <CardContent>
          {res.safety && (
            <Alert variant="destructive" className="mb-3">
              <TriangleAlert />
              <AlertDescription>Safety first, please read the advice below.</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 className="text-emerald-600" /> {res.status === 'booked' ? "You're booked" : 'Request received'}
          </div>
          <p className="mt-3 text-sm whitespace-pre-wrap text-foreground/80">{res.replyText}</p>
          <Button variant="outline" className="mt-4" onClick={() => setRes(null)}>
            Book another visit
          </Button>
        </CardContent>
      </Card>
    )
  return (
    <Card>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="issue">What's going on?</Label>
            <Textarea
              id="issue"
              className="text-base sm:text-sm"
              rows={4}
              required
              minLength={5}
              placeholder="e.g. Furnace won't turn on, house is 58°F, we have a newborn."
              value={f.issue}
              onChange={(e) => setF({ ...f, issue: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" className={field} autoComplete="name" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" type="tel" className={field} autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email (for your confirmation and tracking link)</Label>
            <Input id="email" type="email" className={field} autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Service address</Label>
            <Input
              id="address"
              className={field}
              autoComplete="street-address"
              required
              minLength={5}
              placeholder="Street, city, zip"
              value={f.address}
              onChange={(e) => setF({ ...f, address: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="photos">Photos of the unit, its label, or the problem (optional)</Label>
            <label
              htmlFor="photos"
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Camera className="size-4 shrink-0" />{' '}
              {files.length ? `${files.length} photo${files.length === 1 ? '' : 's'} added · tap to change` : 'Add photos: we diagnose and price options upfront'}
              <input id="photos" type="file" accept="image/*" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 4))} />
            </label>
            {files.length > 0 && <Thumbs files={files} />}
          </div>
          {err && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={busy}>
            {busy ? (files.length ? 'Reading your photos and finding a slot…' : 'Finding the best slot…') : 'Book my visit'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/** Small previews of the chosen photos so people can see what they are sending. */
function Thumbs({ files }: { files: File[] }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f))
    setUrls(u)
    return () => {
      for (const x of u) URL.revokeObjectURL(x)
    }
  }, [files])
  return (
    <ul className="grid grid-cols-4 gap-2 pt-1">
      {urls.map((u, i) => (
        <li key={u} className="aspect-square overflow-hidden rounded-xl border">
          <img src={u} alt={`Upload ${i + 1} of ${urls.length}`} className="size-full object-cover" />
        </li>
      ))}
    </ul>
  )
}
