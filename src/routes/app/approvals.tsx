import { createFileRoute } from '@tanstack/react-router'
import { Check, X } from 'lucide-react'
import { decide } from '#/fns'
import { Empty, ErrorText, Muted, PageTitle, Section, Status } from '#/ui/bits'
import { AGENT_LABEL, ago } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { useArrivals } from '#/ui/motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/approvals')({
  component: Approvals,
})

function Approvals() {
  const snap = useSnap()
  const act = useAction((id: number, decision: 'approved' | 'rejected') => decide({ data: { id, decision } }))
  const pending = snap.approvals.filter((a) => a.status === 'pending')
  const isNew = useArrivals(pending.map((a) => a.id))
  const done = snap.approvals.filter((a) => a.status !== 'pending')
  return (
    <div>
      <PageTitle title="Approvals" sub="Held by policy, low model confidence or after-hours. Rules live in Settings." />
      <ErrorText error={act.error} />
      <Section title={`Waiting (${pending.length})`} className="mb-4">
        {pending.length === 0 ? (
          <Empty>Nothing waiting. The agents are inside their limits.</Empty>
        ) : (
          <ul className="divide-y">
            {pending.map((a) => (
              <li key={a.id} className={cn('-mx-2 flex flex-wrap items-start gap-3 rounded-lg px-2 py-3 first:pt-0 last:pb-0', isNew(a.id) && 'arrive')}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.summary}</div>
                  <Muted className="mt-0.5 block">
                    {AGENT_LABEL[a.agent] ?? a.agent} agent · {a.tool} · {ago(a.createdAt)} · <span className="text-amber-700 dark:text-amber-400">{a.reason}</span>
                  </Muted>
                  {typeof a.args.body === 'string' && <p className="mt-2 well rounded-lg p-2 text-xs whitespace-pre-wrap text-muted-foreground">{a.args.body}</p>}
                </div>
                <div className="flex gap-2">
                  <Button disabled={act.busy} onClick={() => act.run(a.id, 'approved')}>
                    <Check /> Approve
                  </Button>
                  <Button variant="destructive" disabled={act.busy} onClick={() => act.run(a.id, 'rejected')}>
                    <X /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {done.length > 0 && (
        <Section title="History">
          <ul className="divide-y">
            {done.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2 text-sm first:pt-0 last:pb-0">
                <Status s={a.status} />
                <span className="flex-1 truncate">{a.summary}</span>
                <Muted>{a.decidedAt ? ago(a.decidedAt) : ''}</Muted>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
