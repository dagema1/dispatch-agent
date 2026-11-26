import { createFileRoute } from '@tanstack/react-router'
import { Check, Clock, ShieldCheck, ShieldQuestion, X } from 'lucide-react'
import { decide } from '#/fns'
import { AgentTile, Empty, ErrorText, Muted, PageTitle, Section, Status } from '#/ui/bits'
import { useConfirm } from '#/ui/confirm'
import { AGENT_LABEL, ago } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { useArrivals } from '#/ui/motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/approvals')({
  component: Approvals,
})

type Approval = ReturnType<typeof useSnap>['approvals'][number]

function Approvals() {
  const snap = useSnap()
  const confirm = useConfirm()
  const act = useAction((id: number, decision: 'approved' | 'rejected') => decide({ data: { id, decision } }))
  const pending = snap.approvals.filter((a) => a.status === 'pending')
  const isNew = useArrivals(pending.map((a) => a.id))
  const done = snap.approvals.filter((a) => a.status !== 'pending')

  const ask = async (a: Approval, decision: 'approved' | 'rejected') => {
    const body = typeof a.args.body === 'string' ? a.args.body : undefined
    const ok = await confirm(
      decision === 'approved'
        ? { title: 'Approve and run this?', description: a.summary, detail: body, confirm: 'Approve', icon: Check }
        : { title: 'Reject this action?', description: `${a.summary}. The agent will not run it.`, confirm: 'Reject', tone: 'danger', icon: X },
    )
    if (ok) act.run(a.id, decision)
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle title="Approvals" sub="Held by policy, low model confidence or after-hours. Rules live in Settings." />
      <ErrorText error={act.error} />
      <Section
        title={
          <span className="inline-flex items-center gap-2">
            Waiting
            <span
              className={cn(
                'grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                pending.length ? 'tile-attn' : 'bg-foreground/8 text-muted-foreground',
              )}
            >
              {pending.length}
            </span>
          </span>
        }
        className="mb-4"
      >
        {pending.length === 0 ? (
          <Empty icon={ShieldCheck}>Nothing waiting. The agents are inside their limits.</Empty>
        ) : (
          <ul className="space-y-3">
            {pending.map((a) => (
              <li key={a.id} className={cn('rounded-2xl border p-4', isNew(a.id) && 'arrive')}>
                <div className="flex flex-wrap items-start gap-3">
                  <AgentTile agent={a.agent} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="text-sm font-medium">{a.summary}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{AGENT_LABEL[a.agent] ?? a.agent} agent</span>
                      <span className="font-mono text-[11px]">{a.tool}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" /> {ago(a.createdAt)}
                      </span>
                    </div>
                    <span className="tile-attn inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium">
                      <ShieldQuestion className="size-3.5" /> {a.reason}
                    </span>
                  </div>
                  <div className="flex w-full gap-2 sm:w-auto">
                    <Button variant="outline" className="flex-1 sm:flex-none" disabled={act.busy} onClick={() => ask(a, 'rejected')}>
                      <X /> Reject
                    </Button>
                    <Button className="flex-1 sm:flex-none" disabled={act.busy} onClick={() => ask(a, 'approved')}>
                      <Check /> Approve
                    </Button>
                  </div>
                </div>
                {typeof a.args.body === 'string' && <p className="well mt-3 rounded-xl p-3 text-sm whitespace-pre-wrap text-muted-foreground sm:ml-12">{a.args.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {done.length > 0 && (
        <Section title="History">
          <ul className="divide-y">
            {done.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                <AgentTile agent={a.agent} className="size-7 [&_svg]:size-3.5" />
                <span className="min-w-0 flex-1 truncate">{a.summary}</span>
                <Muted className="max-sm:hidden">{a.decidedAt ? ago(a.decidedAt) : ''}</Muted>
                <Status s={a.status} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
