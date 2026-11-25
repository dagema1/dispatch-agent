import { createFileRoute } from '@tanstack/react-router'
import { CircleAlert, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ownerChat } from '#/fns'
import { ErrorText, PageTitle } from '#/ui/bits'
import { useAction, useSnap } from '#/ui/live'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/copilot')({ component: Copilot })

const SUGGESTIONS = [
  'What does tomorrow look like? Anyone overbooked?',
  'Tom called in sick, take him off today and re-plan.',
  'Simulate a cold snap and draft a furnace check campaign.',
  'Which invoices are still unpaid?',
  'Move job 5 to the day after tomorrow, morning.',
]

type Msg = { role: 'user' | 'assistant'; text: string }

function Copilot() {
  const snap = useSnap()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [history, setHistory] = useState<unknown[]>([])
  const [input, setInput] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const chat = useAction(async (text: string) => {
    setMsgs((m) => [...m, { role: 'user', text }])
    const r = await ownerChat({
      data: { history: history as never, message: text },
    })
    setHistory(r.history.slice(-40))
    setMsgs((m) => [...m, { role: 'assistant', text: r.text }])
  })
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs.length])
  const send = (t: string) => {
    if (!t.trim() || chat.busy) return
    setInput('')
    chat.run(t.trim())
  }
  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <PageTitle title="Ops copilot" sub="Ask about the business or give an instruction. Reads are instant; schedule changes and customer messages go through the policy engine." />
      {!snap.integrations.gemini && (
        <Alert className="mb-3">
          <CircleAlert />
          <AlertDescription>Add GEMINI_API_KEY to .env to enable the copilot.</AlertDescription>
        </Alert>
      )}
      <Card className="min-h-0 flex-1 gap-0 py-0">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {msgs.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" className="h-auto rounded-full py-1.5 whitespace-normal" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' && 'justify-end')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap',
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                )}
              >
                {m.text}
              </div>
            </div>
          ))}
          {chat.busy && <div className="animate-pulse text-sm text-muted-foreground">Thinking and checking the schedule…</div>}
          <div ref={end} />
        </div>
        <div className="px-3">
          <ErrorText error={chat.error} />
        </div>
        <form
          className="flex gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <Input aria-label="Message the copilot" placeholder="e.g. Who is closest to the emergency on Pearl St?" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button type="submit" size="icon" aria-label="Send" disabled={chat.busy || !input.trim()}>
            <Send />
          </Button>
        </form>
      </Card>
    </div>
  )
}
