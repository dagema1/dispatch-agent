import { Link } from '@tanstack/react-router'
import { CarFront, Check, CheckCircle2, Clock, Hand, MapPin, Navigation, NotebookPen, Power, Send, Timer, UserCheck, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { fieldAct, getField } from '#/fns'
import { Empty, ErrorText, Muted, PanelHead, PriorityTile } from '#/ui/bits'
import { ago, dayTime, time } from '#/ui/format'
import { useLive } from '#/ui/live'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type View = Awaited<ReturnType<typeof getField>>
type Tech = View['techs'][number]
type Job = Tech['jobs'][number]
type Act = Parameters<typeof fieldAct>[0]['data']['act']

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-foreground/8 text-muted-foreground' },
  en_route: { label: 'On the way', cls: 'bg-primary/15 text-primary' },
  on_site: { label: 'On site', cls: 'bg-(--attn-1)/25 text-amber-700 dark:text-(--attn-1)' },
  done: { label: 'Done', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
}

/** Ready-made notes, so a demo can close a job in two taps. Edit freely before sending. */
const DONE_NOTE = 'Replaced the hot-surface igniter, cleaned the flame sensor, ran two full heat cycles. System working. Unit is 17 years old; mentioned replacement options.'
const NOTE = 'Customer asked for a quote on a smart thermostat while I was here.'

/**
 * Plays a technician: everything the Telegram app does, as buttons. Each action runs the same code
 * as the bot, so customers get the same texts and the board re-plans live.
 */
export function FieldSim() {
  const { snap } = useLive()
  const [view, setView] = useState<View | null>(null)
  const [techId, setTechId] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<Array<{ id: number; text: string; at: string; tech: string }>>([])
  const [writing, setWriting] = useState<{ kind: 'note' | 'done'; job: Job } | null>(null)

  const load = useCallback(() => getField().then(setView), [])
  // any live event refreshes the snapshot; follow it so other tabs' actions show here too
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload whenever the live snapshot changes
  useEffect(() => {
    load().catch((e) => setError((e as Error).message))
  }, [load, snap])
  useEffect(() => {
    if (view && techId == null) setTechId((view.techs.find((t) => t.active && t.jobs.some((j) => j.status !== 'done')) ?? view.techs[0])?.id ?? null)
  }, [view, techId])

  const tech = view?.techs.find((t) => t.id === techId) ?? null
  const act = async (key: string, a: Act) => {
    if (!tech) return
    setBusy(key)
    setError(null)
    try {
      const r = await fieldAct({ data: { techId: tech.id, act: a } })
      setLog((l) => [{ id: Date.now(), text: r.text, at: new Date().toISOString(), tech: tech.name }, ...l].slice(0, 30))
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!view) return <Skeleton className="h-[520px] w-full rounded-2xl" />
  const open = tech?.jobs.filter((j) => j.status !== 'done') ?? []
  const next = open.find((j) => j.status === 'en_route') ?? open[0]
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
      {/* who you are playing */}
      <Card size="sm" className="h-fit gap-0 pt-0">
        <PanelHead title={<>Play as</>} />
        <CardContent className="pt-3">
          <ul className="flex gap-1.5 overflow-x-auto lg:flex-col" aria-label="Technicians">
            {view.techs.map((t) => {
              const on = t.id === techId
              const left = t.jobs.filter((j) => j.status !== 'done').length
              return (
                <li key={t.id} className="shrink-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTechId(t.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors',
                      on ? 'bg-foreground/10 font-medium shadow-[inset_0_1px_0_var(--edge)]' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                    )}
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: t.color }}>
                      {t.name
                        .split(' ')
                        .map((p) => p[0])
                        .join('')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{t.name}</span>
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {t.active ? `${left} open visit${left === 1 ? '' : 's'}` : 'Off duty'}
                        {t.live ? ' · live' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {/* the technician's app */}
      <div className="min-w-0 space-y-4">
        {tech && (
          <Card size="sm">
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full font-semibold text-white" style={{ background: tech.color }}>
                  <Wrench className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold">{tech.name}</div>
                  <Muted className="block">
                    {tech.live ? `Location shared ${ago(tech.live.at)}` : 'No live location yet'}
                    {tech.telegram ? ' · also on Telegram' : ''}
                  </Muted>
                </div>
                <Button variant={tech.active ? 'outline' : 'default'} size="sm" disabled={!!busy} onClick={() => act('duty', { action: 'duty', active: !tech.active })}>
                  <Power /> {tech.active ? 'Go off duty' : 'Back on duty'}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled={!!busy || !next} onClick={() => next && act('drive', { action: 'drive', jobId: next.id })}>
                  <CarFront /> Drive toward next visit
                </Button>
                <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => act('home', { action: 'locate', lat: tech.home.lat, lng: tech.home.lng })}>
                  <MapPin /> Share location (home)
                </Button>
                <span className="flex items-center gap-1 rounded-full bg-foreground/5 p-0.5 pl-3 text-xs text-muted-foreground">
                  <Timer className="size-3.5" /> Running late
                  {[10, 15, 30].map((m) => (
                    <Button key={m} variant="ghost" size="xs" disabled={!!busy} onClick={() => act(`late${m}`, { action: 'late', minutes: m })}>
                      {m}m
                    </Button>
                  ))}
                </span>
              </div>
              <ErrorText error={error} />
            </CardContent>
          </Card>
        )}

        <Card size="sm" className="gap-0 pt-0">
          <PanelHead title={<>Today’s route</>} />
          <CardContent className="pt-3">
            {!tech?.jobs.length ? (
              <Empty icon={Clock}>{tech?.active ? 'Nothing on this route yet. Take a visit from the unassigned list.' : 'Off duty.'}</Empty>
            ) : (
              <ol className="space-y-2.5">
                {tech.jobs.map((j, i) => (
                  <li key={j.id} className={cn('well rounded-2xl p-3.5', j.status === 'done' && 'opacity-60')}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-foreground/8 text-[11px] font-semibold tabular-nums">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{j.title}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS[j.status]?.cls)}>{STATUS[j.status]?.label ?? j.status}</span>
                          {j.acceptedAt && j.status !== 'done' && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <UserCheck className="size-3" /> Accepted
                            </span>
                          )}
                        </div>
                        <Muted className="block truncate">
                          {j.customer.name} · {j.customer.address}
                        </Muted>
                        <Muted className="block">
                          {j.status === 'done'
                            ? `Finished ${time(j.completedAt)}`
                            : j.status === 'en_route' && j.eta
                              ? `ETA ${time(j.eta)}`
                              : j.start
                                ? `${time(j.start)} to ${time(j.end)}`
                                : `Window ends ${dayTime(j.windowEnd)}`}
                        </Muted>
                      </div>
                    </div>
                    {j.status !== 'done' && (
                      <div className="mt-3 flex flex-wrap gap-2 pl-9">
                        {j.status === 'scheduled' && !j.acceptedAt && (
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(`acc${j.id}`, { action: 'accept', jobId: j.id })}>
                            <Check /> Accept
                          </Button>
                        )}
                        {j.status === 'scheduled' && (
                          <Button size="sm" disabled={!!busy} onClick={() => act(`omw${j.id}`, { action: 'omw', jobId: j.id })}>
                            <Navigation /> On my way
                          </Button>
                        )}
                        {j.status === 'en_route' && (
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(`drv${j.id}`, { action: 'drive', jobId: j.id })}>
                            <CarFront /> Drive closer
                          </Button>
                        )}
                        {(j.status === 'en_route' || j.status === 'scheduled') && (
                          <Button
                            size="sm"
                            variant={j.status === 'en_route' ? 'default' : 'outline'}
                            disabled={!!busy}
                            onClick={() => act(`arr${j.id}`, { action: 'arrive', jobId: j.id })}
                          >
                            <MapPin /> Arrived
                          </Button>
                        )}
                        {j.status === 'on_site' && (
                          <>
                            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setWriting({ kind: 'note', job: j })}>
                              <NotebookPen /> Add note
                            </Button>
                            <Button size="sm" disabled={!!busy} onClick={() => setWriting({ kind: 'done', job: j })}>
                              <CheckCircle2 /> Job done
                            </Button>
                          </>
                        )}
                        {busy?.replace(/^\D+/, '') === String(j.id) && <Muted className="self-center">Working…</Muted>}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* what's up for grabs, and what just happened */}
      <div className="min-w-0 space-y-4 lg:col-span-2 xl:col-span-1">
        <Card size="sm" className="gap-0 pt-0">
          <PanelHead title={<>Unassigned ({view.unassigned.length})</>} />
          <CardContent className="pt-3">
            {view.unassigned.length === 0 ? (
              <Empty icon={Hand}>Every visit has a technician.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {view.unassigned.map((j) => (
                  <li key={j.id} className="flex items-center gap-2.5 rounded-xl p-1.5">
                    <PriorityTile p={j.priority} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{j.title}</span>
                      <Muted className="block truncate">{j.customer.name}</Muted>
                    </span>
                    <Button size="xs" variant="outline" disabled={!!busy || !tech?.active} onClick={() => act(`take${j.id}`, { action: 'take', jobId: j.id })}>
                      Take
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card size="sm" className="gap-0 pt-0">
          <PanelHead
            title={<>What happened</>}
            right={
              <Link to="/app" className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                See the board
              </Link>
            }
          />
          <CardContent className="pt-3">
            {log.length === 0 ? (
              <Empty icon={Send}>Actions you take show here, with what the customer was told.</Empty>
            ) : (
              <ul className="space-y-2">
                {log.map((l) => (
                  <li key={l.id} className="arrive-pop rounded-xl bg-foreground/4 px-3 py-2 text-xs">
                    <span className="block leading-relaxed">{l.text}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {l.tech.split(' ')[0]} · {time(l.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <WriteDialog
        state={writing}
        busy={!!busy}
        onClose={() => setWriting(null)}
        onSend={async (text) => {
          if (!writing) return
          const w = writing
          setWriting(null)
          await act(`${w.kind}${w.job.id}`, w.kind === 'done' ? { action: 'done', jobId: w.job.id, text } : { action: 'note', jobId: w.job.id, text })
        }}
      />
    </div>
  )
}

function WriteDialog({ state, busy, onClose, onSend }: { state: { kind: 'note' | 'done'; job: Job } | null; busy: boolean; onClose: () => void; onSend: (t: string) => void }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (state) setText(state.kind === 'done' ? DONE_NOTE : NOTE)
  }, [state])
  const done = state?.kind === 'done'
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim().length >= 3) onSend(text.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>{done ? `Finish #${state?.job.id}` : `Note on #${state?.job.id}`}</DialogTitle>
            <DialogDescription>
              {done
                ? 'What you did and which parts you used, like the voice note on Telegram. The agent writes the report and invoice from it.'
                : 'Saved on the visit for the office. The customer does not see it.'}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="fs-text" className="mb-1.5">
              {done ? 'Work summary' : 'Note'}
            </Label>
            <Textarea id="fs-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || text.trim().length < 3}>
              {done ? 'Close job and invoice' : 'Save note'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
