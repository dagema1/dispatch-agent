import { Phone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getConversation } from '#/fns'
import type { Conversation } from '#/server/api/story'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Empty } from './bits'
import { dayTime } from './format'
import { useSnap } from './live'
import { Composer } from './NeedsYou'
import { splitAgentText } from './transcript'

type Turn = { role: 'caller' | 'agent'; text: string }

/** A call transcript as a chat: the agent on the left, the caller on the right. */
export function TranscriptDialog({ turns, title, meta, open, onOpenChange }: { turns: Turn[]; title: string; meta?: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const shown = turns.map((t) => ({ ...t, parts: t.role === 'agent' ? splitAgentText(t.text) : [{ kind: 'speech' as const, text: t.text }] }))
  const notes = shown.some((t) => t.parts.some((p) => p.kind === 'note'))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Phone className="size-4 text-muted-foreground" /> {title}
          </DialogTitle>
          {meta && <DialogDescription className="line-clamp-2">{meta}</DialogDescription>}
        </DialogHeader>
        {notes && (
          <p className="border-b bg-(--attn-2)/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
            The agent read some of its internal notes aloud on this call. They are marked below. The voice agent is now told never to speak them.
          </p>
        )}
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {shown.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript; a turn never moves
            <li key={i} className={cn('flex', t.role === 'caller' && 'justify-end')}>
              <Bubble mine={t.role === 'caller'} who={t.role === 'agent' ? 'Agent' : 'Caller'}>
                {t.parts.map((p, j) =>
                  p.kind === 'note' ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: segments of one fixed turn
                    <div
                      key={j}
                      className="my-1.5 rounded-lg border border-dashed border-(--attn-2)/50 bg-(--attn-2)/8 px-2.5 py-1.5 text-xs text-muted-foreground first:mt-0 last:mb-0"
                    >
                      <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-300">Internal note · spoken by mistake</div>
                      {p.text}
                    </div>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: segments of one fixed turn
                    <p key={j}>{p.text}</p>
                  ),
                )}
              </Bubble>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  )
}

/** "Transcript" button that opens the dialog. */
export function TranscriptButton({ turns, title, meta, className }: { turns: Turn[]; title: string; meta?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  if (!turns.length) return null
  return (
    <>
      <Button size="xs" variant="outline" className={className} onClick={() => setOpen(true)}>
        <Phone /> Transcript · {turns.length} turns
      </Button>
      <TranscriptDialog turns={turns} title={title} meta={meta} open={open} onOpenChange={setOpen} />
    </>
  )
}

function Bubble({ mine, who, children, foot }: { mine: boolean; who?: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className={cn('max-w-[85%] space-y-0.5', mine && 'text-right')}>
      {who && <div className="px-1 text-[11px] font-medium text-muted-foreground">{who}</div>}
      <div className={cn('rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed whitespace-pre-wrap', mine ? 'rounded-br-md bg-primary/12' : 'rounded-bl-md bg-foreground/6')}>
        {children}
      </div>
      {foot && <div className="px-1 text-[11px] text-muted-foreground">{foot}</div>}
    </div>
  )
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const chan = (c: string) => (c === 'sms' ? 'text' : c === 'voice' ? 'phone' : c)
const delivery = (m: Conversation['messages'][number]) =>
  m.direction === 'in' ? null : m.delivered ? (m.via === 'test' ? 'test inbox' : m.via === 'manual' ? 'told another way' : 'delivered') : 'not delivered'

/**
 * One person's thread in a dialog: every message both ways in order (ours on the right), calls
 * inline with their transcript, and a composer for customers.
 */
export function ThreadDialog({ who, onClose }: { who: { customerId?: number; technicianId?: number } | null; onClose: () => void }) {
  return (
    <Dialog open={!!who} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85dvh] flex-col gap-0 p-0 sm:max-w-xl">{who && <Thread who={who} />}</DialogContent>
    </Dialog>
  )
}

function Thread({ who }: { who: { customerId?: number; technicianId?: number } }) {
  const snap = useSnap()
  const [c, setC] = useState<Conversation | null | undefined>(undefined)
  const [call, setCall] = useState<Conversation['calls'][number] | null>(null)
  const end = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: snap is the refresh signal (new message arrives)
  useEffect(() => {
    let live = true
    getConversation({ data: who })
      .then((r) => live && setC(r ?? null))
      .catch(() => live && setC(null))
    return () => {
      live = false
    }
  }, [who.customerId, who.technicianId, snap])
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest when the thread grows
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [c?.messages.length, c?.calls.length])

  if (c === undefined)
    return (
      <div className="space-y-3 p-5" aria-busy="true">
        <DialogTitle className="sr-only">Loading conversation</DialogTitle>
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-16 w-3/4" />
        <Skeleton className="ml-auto h-16 w-3/4" />
      </div>
    )
  if (!c)
    return (
      <div className="p-5">
        <DialogTitle className="sr-only">Conversation</DialogTitle>
        <Empty>This conversation is no longer available.</Empty>
      </div>
    )

  const items = [
    ...c.messages.map((m) => ({ at: +new Date(m.createdAt), m, call: null as null | Conversation['calls'][number] })),
    ...c.calls.map((x) => ({ at: +new Date(x.startedAt), m: null as null | Conversation['messages'][number], call: x })),
  ].sort((a, b) => a.at - b.at)
  const tech = c.kind === 'technician'

  return (
    <>
      <DialogHeader className="border-b p-4 pr-12">
        <DialogTitle>{c.name}</DialogTitle>
        <DialogDescription>
          {tech ? 'Technician · Telegram' : [c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'} · {plural(c.messages.length, 'message')}
          {c.calls.length ? ` · ${plural(c.calls.length, 'call')}` : ''}
        </DialogDescription>
      </DialogHeader>
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {items.map(({ m, call: x }) =>
          x ? (
            <li key={`c${x.id}`} className="flex justify-center">
              <button
                type="button"
                onClick={() => setCall(x)}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <Phone className="size-3.5" /> Phone call · {x.transcript.length} turns · {dayTime(x.startedAt)}
                {x.summary && <span className="max-w-48 truncate text-foreground/80">· {x.summary}</span>}
              </button>
            </li>
          ) : m ? (
            <li key={m.id} className={cn('flex', m.direction === 'out' && 'justify-end')}>
              <Bubble
                mine={m.direction === 'out'}
                foot={
                  <>
                    {chan(m.channel)} · {dayTime(m.createdAt)}
                    {delivery(m) && <span className={cn(!m.delivered && 'text-amber-700 dark:text-amber-300')}> · {delivery(m)}</span>}
                  </>
                }
              >
                {m.subject && <div className="mb-0.5 text-xs font-semibold">{m.subject}</div>}
                {m.channel === 'telegram' ? m.body.replace(/<[^>]+>/g, '') : m.body}
              </Bubble>
            </li>
          ) : null,
        )}
        <div ref={end} />
      </ol>
      {c.customerId != null && (
        <div className="border-t p-4">
          <Composer customerId={c.customerId} hasEmail={!!c.email} subject="Following up" body="" compact />
        </div>
      )}
      {call && (
        <TranscriptDialog
          turns={call.transcript}
          title={`Call with ${c.name}`}
          meta={`${dayTime(call.startedAt)}${call.summary ? ` · ${call.summary}` : ''}`}
          open
          onOpenChange={(o) => !o && setCall(null)}
        />
      )}
    </>
  )
}
