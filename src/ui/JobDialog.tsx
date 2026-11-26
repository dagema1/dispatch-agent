import { Check, ExternalLink, FileText, MapPin, Receipt, UserRound } from 'lucide-react'
import { useState } from 'react'
import { completeJob } from '#/fns'
import type { Snapshot } from '#/server/api/views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ErrorText, Priority, Status } from './bits'
import { useConfirm } from './confirm'
import { dayTime, minutesOfDay, money, time } from './format'
import { useAction, useSnap } from './live'
import { Avatar, tint } from './people'

type Job = Snapshot['jobs'][number]

const START = 7 * 60
const END = 19 * 60
const pct = (m: number) => `${(Math.min(Math.max(m - START, 0), END - START) / (END - START)) * 100}%`
const width = (a: number, b: number) => `calc(${pct(b)} - ${pct(a)})`

/** Job details as a centred dialog: who, when (on the same 7am–7pm strip as the board), money, and closing the job. */
export function JobDialog({ job, onClose }: { job: Job | null; onClose: () => void }) {
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-xl">{job && <JobBody key={job.id} job={job} />}</DialogContent>
    </Dialog>
  )
}

function JobBody({ job }: { job: Job }) {
  const snap = useSnap()
  const confirm = useConfirm()
  const [note, setNote] = useState('')
  const done = useAction(() => completeJob({ data: { jobId: job.id, note } }))
  const tech = snap.techs.find((t) => t.id === job.technicianId)
  const quote = snap.quotes.find((q) => q.jobId === job.id)
  const invoice = snap.invoices.find((i) => i.jobId === job.id)
  const report = job.report as { workDone?: string; followUp?: string } | null
  const open = !['done', 'cancelled'].includes(job.status)

  const close = async () => {
    const ok = await confirm({
      title: `Complete job #${job.id}?`,
      description: `The agent writes the job report from your note and sends ${job.customer.name.split(' ')[0]} an invoice with a payment link.`,
      detail: note,
      confirm: 'Complete and invoice',
      icon: Check,
    })
    if (ok) done.run()
  }

  return (
    <>
      <DialogHeader className="gap-3 border-b p-5 pr-12">
        <div className="flex items-start gap-3">
          {tech ? (
            <Avatar name={tech.name} color={tech.color} size="lg" />
          ) : (
            <span className="tile tile-attn size-11 rounded-full">
              <UserRound className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <DialogDescription className="text-xs">
              Job #{job.id} · {job.skill.replaceAll('_', ' ')} · {tech ? tech.name : 'no technician yet'}
            </DialogDescription>
            <DialogTitle className="text-lg leading-snug font-semibold">{job.title}</DialogTitle>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Priority p={job.priority} />
              <Status s={job.status} />
            </div>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-5 p-5">
        <DayStrip job={job} color={tech?.color} />

        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer">
            <div className="flex items-center gap-2.5">
              <Avatar name={job.customer.name} size="sm" />
              <div className="min-w-0">
                <div className="truncate font-medium">{job.customer.name}</div>
                <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <MapPin className="size-3 shrink-0" /> {job.customer.address}
                </div>
              </div>
            </div>
          </Field>
          <Field label="Estimated value">
            <div className="text-lg font-semibold tabular-nums">{money(job.estValueCents)}</div>
          </Field>
          <Field label="Planned">
            {job.scheduledStart ? `${dayTime(job.scheduledStart)} – ${time(job.scheduledEnd)}` : 'Not scheduled'}
            {job.etaAt && <div className="text-xs text-primary">Live ETA {time(job.etaAt)}</div>}
          </Field>
          <Field label="Customer window">
            {dayTime(job.windowStart)} – {dayTime(job.windowEnd)}
          </Field>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={job.trackUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Tracking page
            </a>
          </Button>
          {quote && (
            <Button variant="outline" size="sm" asChild>
              <a href={quote.url} target="_blank" rel="noreferrer">
                <FileText /> Quote #{quote.id}
              </a>
            </Button>
          )}
        </div>

        {report?.workDone && (
          <section className="well space-y-1 rounded-xl p-3 text-sm">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Check className="size-3.5 text-primary" /> Job report
            </h3>
            <p>{report.workDone}</p>
            {report.followUp && <p className="text-xs text-muted-foreground">Next: {report.followUp}</p>}
          </section>
        )}

        {invoice && (
          <section className="flex items-center gap-3 rounded-xl border p-3 text-sm">
            <span className="tile tile-quiet size-9">
              <Receipt className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Invoice #{invoice.id}</div>
              <div className="text-xs text-muted-foreground tabular-nums">{money(invoice.totalCents, 2)}</div>
            </div>
            {invoice.payUrl && (
              <a href={invoice.payUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
                Pay link
              </a>
            )}
            <Status s={invoice.status} />
          </section>
        )}

        {open && (
          <section className="space-y-2 border-t pt-5">
            <Label htmlFor="close-note">Close the job</Label>
            <p className="text-xs text-muted-foreground">Technicians usually tap Job done in Telegram and send a voice note. You can type the same note here.</p>
            <Textarea
              id="close-note"
              rows={3}
              placeholder="Replaced the igniter, cleaned the flame sensor, furnace running fine. Customer declined duct cleaning."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex justify-end">
              <Button disabled={done.busy || note.trim().length < 3} onClick={close}>
                {done.busy ? 'Writing report and invoice…' : 'Complete job'}
              </Button>
            </div>
            <ErrorText error={done.error} />
          </section>
        )}
      </div>
    </>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="well rounded-xl px-3 py-2.5 text-sm">
    <dt className="mb-1 text-xs text-muted-foreground">{label}</dt>
    <dd>{children}</dd>
  </div>
)

/** The day on the board's 7am–7pm axis: dashed customer window, the planned visit inside it. */
function DayStrip({ job, color }: { job: Job; color?: string }) {
  const ws = minutesOfDay(job.windowStart)
  const we = minutesOfDay(job.windowEnd)
  const sameDay = new Date(job.windowStart).toDateString() === new Date(job.windowEnd).toDateString()
  const s = job.scheduledStart ? minutesOfDay(job.scheduledStart) : null
  const e = job.scheduledStart ? (job.scheduledEnd ? minutesOfDay(job.scheduledEnd) : (s as number) + job.durationMin) : null
  const c = color ?? 'var(--muted-foreground)'
  return (
    <div>
      <div className="relative mb-1 h-4 text-[10px] text-muted-foreground tabular-nums">
        {[7, 10, 13, 16, 19].map((h, i, a) => (
          <span key={h} className={cn('absolute', i === 0 ? '' : i === a.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: pct(h * 60) }}>
            {((h - 1) % 12) + 1}
            {h < 12 ? 'a' : 'p'}
          </span>
        ))}
      </div>
      <div className="well relative h-10 overflow-hidden rounded-xl">
        {[10, 13, 16].map((h) => (
          <span key={h} className="absolute inset-y-0 w-px bg-foreground/[0.06]" style={{ left: pct(h * 60) }} aria-hidden />
        ))}
        {sameDay && we > ws && (
          <span
            className="absolute inset-y-1 rounded-lg border border-dashed border-foreground/45 bg-foreground/[0.04]"
            style={{ left: pct(ws), width: width(ws, we) }}
            title="Customer window"
          />
        )}
        {s != null && e != null && (
          <span
            className="absolute inset-y-2 rounded-md border"
            style={{
              left: pct(s),
              width: width(s, Math.max(e, s + 15)),
              background: color ? tint(color, 30) : 'var(--muted)',
              borderColor: color ? tint(color, 60) : 'var(--border)',
            }}
            title="Planned visit"
          />
        )}
      </div>
      <div className="mt-1.5 flex gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm border border-dashed border-foreground/45" aria-hidden /> Customer window
        </span>
        {s != null && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-4 rounded-sm border"
              style={{ background: color ? tint(c, 30) : 'var(--muted)', borderColor: color ? tint(c, 60) : 'var(--border)' }}
              aria-hidden
            />{' '}
            Planned visit
          </span>
        )}
      </div>
    </div>
  )
}
