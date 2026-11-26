import { createFileRoute } from '@tanstack/react-router'
import { Camera, CheckCircle2, CircleAlert, Mic, Phone, PhoneOff, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { bookOnline } from '#/fns'
import { CustomerShell } from '#/ui/CustomerShell'
import { fileToMedia } from '#/ui/format'
import type { Turn, VoiceCall, VoiceState } from '#/ui/voice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/book')({
  component: Book,
  head: () => ({
    meta: [{ title: 'Book a visit · Northline Heating & Plumbing' }],
  }),
})

function Book() {
  return (
    <CustomerShell wide sub="Denver metro · open 24/7 for emergencies">
      <h1 className="text-2xl font-bold tracking-tight">How can we help?</h1>
      <p className="mt-1 text-sm text-muted-foreground">Talk to our receptionist or send the details. You'll get a confirmed arrival window in under a minute.</p>
      <Tabs defaultValue="call" className="mt-5">
        <TabsList className="grid h-10 w-full grid-cols-2">
          <TabsTrigger value="call">
            <Phone /> Call us
          </TabsTrigger>
          <TabsTrigger value="form">
            <Camera /> Details &amp; photos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="call" className="mt-2">
          <CallPanel />
        </TabsContent>
        <TabsContent value="form" className="mt-2">
          <FormPanel />
        </TabsContent>
      </Tabs>
      <p className="mt-8 text-center text-xs text-muted-foreground">
        Smell gas? Leave the house and call Xcel Energy at 1-800-895-2999 or 911 from outside. · Demo company, fictional data.
      </p>
    </CustomerShell>
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
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [turns])
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
    await call.current.start()
  }
  const live = state === 'live'
  return (
    <Card>
      <CardContent>
        <div className="flex flex-col items-center py-4">
          <div className={cn('relative size-24 rounded-full! text-white transition-colors', live ? 'tile tile-solid' : 'tile tile-solid opacity-90')}>
            {live && speaking && (
              <span className={cn('absolute inset-0 animate-ping rounded-full opacity-40 motion-reduce:hidden', speaking === 'agent' ? 'bg-primary' : 'bg-muted-foreground')} />
            )}
            {live ? <Mic className="size-8" /> : <Phone className="size-8" />}
          </div>
          <div className="mt-3 text-sm text-muted-foreground" aria-live="polite">
            {state === 'idle' && 'Uses your microphone. Speak naturally.'}
            {state === 'error' && 'Call ended.'}
            {state === 'connecting' && 'Connecting…'}
            {live && (speaking === 'agent' ? 'Receptionist is speaking…' : speaking === 'caller' ? 'Listening…' : 'Connected')}
            {state === 'ending' && 'Ending call…'}
          </div>
          {live || state === 'connecting' ? (
            <Button variant="destructive" size="lg" className="mt-4 h-11 px-6" onClick={() => call.current?.hangUp()}>
              <PhoneOff /> Hang up
            </Button>
          ) : (
            <Button size="lg" className="mt-4 h-11 px-6" onClick={start} disabled={state === 'ending'}>
              <Phone /> Start call
            </Button>
          )}
          {err && (
            <Alert variant="destructive" className="mt-3">
              <CircleAlert />
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
        </div>
        {booked && <BookedCard r={booked} />}
        {turns.length > 0 && (
          <div className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-xl well p-3">
            {turns.map((t, i) => (
              <div key={i} className={cn('arrive-pop flex', t.role === 'caller' && 'justify-end')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-1.5 text-sm',
                    t.role === 'caller' ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground shadow-xs',
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
              <Camera className="size-4 shrink-0" /> {files.length ? `${files.length} photo(s) selected` : 'Add photos: we diagnose and price options upfront'}
              <input id="photos" type="file" accept="image/*" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            </label>
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
