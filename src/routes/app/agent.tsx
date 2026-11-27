import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowUp, CalendarSearch, CircleAlert, History, Megaphone, MessageSquare, Plus, Shuffle, Trash2, Wallet, Wrench } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ownerChat } from '#/fns'
import { ErrorText, Muted } from '#/ui/bits'
import { ago } from '#/ui/format'
import { useAction, useSnap } from '#/ui/live'
import { initials } from '#/ui/people'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/agent')({
  component: AgentChat,
  validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s.q === 'string' && s.q.trim() ? { q: s.q.slice(0, 500) } : {}),
})

/** Starting points: what the agent can do, phrased as something the owner would actually ask. */
const STARTERS: Array<{ icon: React.ComponentType<{ className?: string }>; title: string; prompt: string }> = [
  { icon: CalendarSearch, title: 'Check the schedule', prompt: 'What does tomorrow look like? Anyone overbooked?' },
  { icon: Shuffle, title: 'Reshuffle the day', prompt: 'Tom called in sick, take him off today and re-plan.' },
  { icon: Megaphone, title: 'Draft a campaign', prompt: 'Simulate a cold snap and draft a furnace check campaign.' },
  { icon: Wallet, title: 'Chase money', prompt: 'Which invoices are still unpaid?' },
]

/** Friendly names for the tools the agent used, shown under its answer. */
const TOOL_LABEL: Record<string, string> = {
  get_schedule: 'Read the schedule',
  find_customer: 'Looked up a customer',
  mark_technician_out: 'Marked a tech out',
  mark_technician_back: 'Brought a tech back',
  move_job: 'Moved a job',
  simulate_weather: 'Set demo weather',
  run_weather_campaign: 'Drafted a campaign',
  business_snapshot: 'Checked the numbers',
}

type Msg = { role: 'user' | 'assistant'; text: string; used?: string[]; runId?: string }
type Chat = { id: string; title: string; at: string; msgs: Msg[]; history: unknown[] }

/** Past conversations, kept in this browser (newest first, capped) so a chat survives reloads and can be reopened. */
const STORE = 'agent-chats'
const MAX_CHATS = 30
const loadChats = (): Chat[] => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const saveChats = (c: Chat[]) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(c.slice(0, MAX_CHATS)))
  } catch {}
}

function AgentChat() {
  const snap = useSnap()
  const name = (snap.settings.persona as { agentName: string }).agentName || 'Agent'
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [history, setHistory] = useState<unknown[]>([])
  const [chatId, setChatId] = useState<string>(() => crypto.randomUUID())
  const [chats, setChats] = useState<Chat[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  // only a new turn saves; merely reopening a chat must not bump it to the top
  const talking = useRef(false)
  // reopen the most recent conversation on arrival
  useEffect(() => {
    const all = loadChats()
    setChats(all)
    const last = all[0]
    if (last) {
      setChatId(last.id)
      setMsgs(last.msgs)
      setHistory(last.history)
    }
  }, [])
  // every finished turn is written back to the chat's entry, which moves to the top
  // biome-ignore lint/correctness/useExhaustiveDependencies: persist when the transcript changes
  useEffect(() => {
    if (!msgs.length || !talking.current) return
    setChats((all) => {
      const first = msgs.find((m) => m.role === 'user')?.text ?? 'New chat'
      const next = [{ id: chatId, title: first.slice(0, 80), at: new Date().toISOString(), msgs, history }, ...all.filter((c) => c.id !== chatId)]
      saveChats(next)
      return next
    })
  }, [msgs, history])
  const [input, setInput] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const chat = useAction(async (text: string) => {
    setMsgs((m) => [...m, { role: 'user', text }])
    const r = await ownerChat({ data: { history: history as never, message: text } })
    setHistory(r.history.slice(-40))
    setMsgs((m) => [...m, { role: 'assistant', text: r.text, used: r.used, runId: r.runId }])
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a message is added
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs.length, chat.busy])

  const send = (t: string) => {
    if (!t.trim() || chat.busy) return
    talking.current = true
    setInput('')
    chat.run(t.trim())
  }
  const reset = () => {
    talking.current = false
    setChatId(crypto.randomUUID())
    setMsgs([])
    setHistory([])
    setHistoryOpen(false)
    box.current?.focus()
  }
  const open = (c: Chat) => {
    talking.current = false
    setChatId(c.id)
    setMsgs(c.msgs)
    setHistory(c.history)
    setHistoryOpen(false)
  }
  const remove = (id: string) => {
    setChats((all) => {
      const next = all.filter((c) => c.id !== id)
      saveChats(next)
      return next
    })
    if (id === chatId) {
      setChatId(crypto.randomUUID())
      setMsgs([])
      setHistory([])
    }
  }

  // A question typed in the top bar arrives as ?q= and is sent once, then cleared from the URL.
  const { q } = Route.useSearch()
  const navigate = Route.useNavigate()
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (!q || asked.current === q) return
    asked.current = q
    send(q)
    navigate({ search: {}, replace: true })
  })

  const empty = msgs.length === 0
  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-3xl flex-col">
      <header className="flex items-center gap-3 pb-3">
        {!empty && <Orb name={name} size="sm" />}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
          <p className="truncate text-xs text-muted-foreground">Operations agent · reads the live board · risky actions wait in Approvals</p>
        </div>
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" disabled={chat.busy}>
              <History /> History
            </Button>
          </SheetTrigger>
          <SheetContent className="gap-0">
            <SheetHeader>
              <SheetTitle>Chat history</SheetTitle>
              <SheetDescription>Conversations with {name}, kept in this browser.</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-3">
              <Button className="w-full" onClick={reset}>
                <Plus /> New chat
              </Button>
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
              {chats.length === 0 && <Muted className="block px-2 py-6 text-center">No conversations yet.</Muted>}
              {chats.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => open(c)}
                    aria-current={c.id === chatId ? 'true' : undefined}
                    className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 pr-10 text-left transition-colors outline-none hover:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-foreground/8"
                  >
                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{c.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {ago(c.at)} · {c.msgs.length} messages
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    aria-label={`Delete chat: ${c.title}`}
                    className="absolute top-2 right-2 grid size-7 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
        {!empty && (
          <Button variant="outline" size="sm" onClick={reset} disabled={chat.busy}>
            <Plus /> New chat
          </Button>
        )}
      </header>

      {!snap.integrations.gemini && (
        <Alert className="mb-3">
          <CircleAlert />
          <AlertDescription>Add GEMINI_API_KEY to .env to talk to {name}.</AlertDescription>
        </Alert>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {empty ? (
          <div className="flex min-h-full flex-col items-center justify-center py-8 text-center">
            <Orb name={name} size="lg" />
            <h2 className="mt-5 text-3xl font-semibold tracking-tight">
              Hi, I’m <span className="font-display text-[1.15em] text-primary">{name}</span>.
            </h2>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              Ask about the schedule, the crew or the money. I check the live data before I answer, and I can make changes for you.
            </p>
            <ul className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
              {STARTERS.map((s) => (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => send(s.prompt)}
                    disabled={chat.busy}
                    className="slab flex h-full w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="tile tile-quiet size-8 shrink-0">
                      <s.icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{s.title}</span>
                      <span className="block text-xs text-muted-foreground">{s.prompt}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="space-y-6 py-2">
            {msgs.map((m, i) =>
              m.role === 'user' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript; a turn never moves
                <li key={i} className="arrive-pop flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm whitespace-pre-wrap text-accent-foreground">{m.text}</div>
                </li>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript; a turn never moves
                <li key={i} className="arrive-pop flex gap-3">
                  <Orb name={name} size="xs" />
                  <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                    <Reply text={m.text} />
                    {(m.used?.length || m.runId) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {m.used?.map((u) => (
                          <span key={u} className="well inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground">
                            <Wrench className="size-3" /> {TOOL_LABEL[u] ?? u}
                          </span>
                        ))}
                        {m.runId && (
                          <Link to="/app/agents" search={{ run: m.runId }} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                            View trace
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ),
            )}
            {chat.busy && (
              <li className="flex gap-3">
                <Orb name={name} size="xs" busy />
                <span className="shimmer-text pt-1 text-sm">Checking the live board…</span>
              </li>
            )}
          </ol>
        )}
        <div ref={end} />
      </div>

      <ErrorText error={chat.error} />
      <form
        className="slab mt-3 flex items-end gap-2 rounded-2xl border p-2 focus-within:ring-2 focus-within:ring-ring"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <label htmlFor="agent-input" className="sr-only">
          Message {name}
        </label>
        <textarea
          id="agent-input"
          ref={box}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send(input)
            }
          }}
          placeholder={`Ask ${name} anything about today…`}
          className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        />
        <Button type="submit" size="icon" className="size-10 shrink-0 rounded-xl" aria-label="Send" disabled={chat.busy || !input.trim()}>
          <ArrowUp />
        </Button>
      </form>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">Enter to send · Shift + Enter for a new line</p>
    </div>
  )
}

/** The agent's mark: initials on the blue action gradient; pulses while it works. */
function Orb({ name, size, busy }: { name: string; size: 'xs' | 'sm' | 'lg'; busy?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'tile tile-solid shrink-0 rounded-full font-semibold',
        size === 'xs' ? 'size-7 text-[10px]' : size === 'sm' ? 'size-9 text-xs' : 'size-16 text-xl',
        busy && 'motion-safe:animate-pulse',
      )}
    >
      {initials(name)}
    </span>
  )
}

/** The model's light markdown (bold, bullet lines) as text, never raw asterisks. */
function Reply({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, k) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: static split of one line
        <strong key={k} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      ) : (
        part
      ),
    )
  const blocks: Array<{ list: boolean; lines: string[] }> = []
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*(?:[*\-•]|\d+\.)\s+(.*)$/)
    const list = !!m
    const line = m ? m[1] : raw
    const last = blocks.at(-1)
    if (last && last.list === list) last.lines.push(line)
    else blocks.push({ list, lines: [line] })
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) =>
        b.list ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static parse of one reply
          <ul key={i} className="list-disc space-y-0.5 pl-5">
            {b.lines.map((l, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static parse of one reply
              <li key={j}>{inline(l)}</li>
            ))}
          </ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static parse of one reply
          <p key={i} className="whitespace-pre-wrap">
            {inline(b.lines.join('\n').trim())}
          </p>
        ),
      )}
    </div>
  )
}
