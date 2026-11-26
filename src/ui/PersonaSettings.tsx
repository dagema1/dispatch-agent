import { Check, Loader2, Mail, Phone, Play, RotateCcw, Save, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { setPersona } from '#/fns'
import { personalize, salutation } from '#/server/domain/persona'
import type { Persona } from '#/server/domain/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { ErrorText, Muted, Section } from './bits'
import { useAction, useSnap } from './live'

/** Gemini Live prebuilt voices, with Google's own one-word character for each. */
const VOICES: Array<[Persona['voice'], string]> = [
  ['Aoede', 'Breezy'],
  ['Kore', 'Firm'],
  ['Puck', 'Upbeat'],
  ['Charon', 'Informative'],
  ['Leda', 'Youthful'],
  ['Orus', 'Firm, deeper'],
  ['Zephyr', 'Bright'],
  ['Fenrir', 'Excitable'],
]

const SAMPLE = { name: 'Linda Okafor', tech: 'Jake' }

/** Who the customer talks to: name, voice, tone, how they are addressed, with a live preview of the result. */
export function PersonaSettings() {
  const snap = useSnap()
  const saved = snap.settings.persona as Persona
  const [p, setP] = useState<Persona>(saved)
  const save = useAction(() => setPersona({ data: p }))
  const dirty = JSON.stringify(p) !== JSON.stringify(saved)
  const set = <K extends keyof Persona>(k: K, v: Persona[K]) => setP((x) => ({ ...x, [k]: v }))
  const company = snap.company.name

  const sms = personalize(`Hi Linda, you're booked. ${SAMPLE.tech} will arrive tomorrow between 9:00 AM and 10:00 AM for: furnace not heating.`, SAMPLE.name, p)
  const opening =
    p.greeting.trim() ||
    (p.tone === 'brief'
      ? `${company}, ${p.agentName} speaking. What's the problem?`
      : p.tone === 'formal'
        ? `Good afternoon, ${company}. My name is ${p.agentName}. How may I help you today?`
        : `Hi, thanks for calling ${company}! This is ${p.agentName}. What's going on at home?`)

  return (
    <Section title="Agent persona" right={<Muted>Calls, emails and texts to customers</Muted>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (dirty) save.run()
          }}
        >
          <div className="space-y-1.5 sm:max-w-xs">
            <Label htmlFor="agent-name">Name</Label>
            <Input id="agent-name" maxLength={40} required value={p.agentName} onChange={(e) => set('agentName', e.target.value)} />
          </div>
          <VoicePicker value={p.voice} onChange={(v) => set('voice', v)} line={opening} />

          <Choice
            label="Tone"
            value={p.tone}
            onChange={(v) => set('tone', v)}
            options={[
              ['warm', 'Warm'],
              ['brief', 'Brief'],
              ['formal', 'Formal'],
            ]}
          />
          <Choice
            label="Addresses customers"
            value={p.address}
            onChange={(v) => set('address', v)}
            options={[
              ['first', 'First name'],
              ['full', 'Full name'],
              ['neutral', 'No name'],
            ]}
          />

          <div className="space-y-1.5">
            <Label htmlFor="agent-greeting">Call opening line</Label>
            <Input
              id="agent-greeting"
              maxLength={200}
              placeholder="Leave empty to let the agent greet in its own words"
              value={p.greeting}
              onChange={(e) => set('greeting', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-signoff">Sign-off on messages</Label>
            <Input id="agent-signoff" maxLength={120} placeholder={`e.g. ${p.agentName} at ${company}`} value={p.signOff} onChange={(e) => set('signOff', e.target.value)} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!dirty || save.busy || !p.agentName.trim()}>
              <Save /> {save.busy ? 'Saving…' : 'Save persona'}
            </Button>
            {dirty && (
              <Button type="button" variant="ghost" onClick={() => setP(saved)}>
                <RotateCcw /> Undo changes
              </Button>
            )}
            <Muted>{dirty ? 'Unsaved changes. The next call and message use the saved version.' : 'Saved. Applies to the next call or message.'}</Muted>
          </div>
          <ErrorText error={save.error} />
        </form>

        <aside aria-label="Preview" className="space-y-3">
          <Preview icon={Phone} label={`Call · ${p.voice} voice`}>
            “{opening}”
          </Preview>
          <Preview icon={Mail} label="Booking confirmation">
            {sms}
          </Preview>
          <Muted className="block">
            Salutation for {SAMPLE.name}: <span className="text-foreground">{salutation(SAMPLE.name, p)}</span>
          </Muted>
        </aside>
      </div>
    </Section>
  )
}

function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{label}</div>
      <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={value} aria-label={label} onValueChange={(v) => v && onChange(v as T)}>
        {options.map(([v, l]) => (
          <ToggleGroupItem key={v} value={v} className="px-3 text-xs">
            {l}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

const Preview = ({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) => (
  <div className="well rounded-xl p-3">
    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="size-3.5" /> {label}
    </div>
    <p className="text-sm leading-relaxed whitespace-pre-wrap">{children}</p>
  </div>
)

/** Eight voices as cards: play one to hear it say the opening line, tap the card to choose it. */
function VoicePicker({ value, onChange, line }: { value: Persona['voice']; onChange: (v: Persona['voice']) => void; line: string }) {
  const [playing, setPlaying] = useState<{ voice: string; state: 'loading' | 'playing' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  const play = async (voice: Persona['voice']) => {
    stop.current?.()
    if (playing?.voice === voice) {
      setPlaying(null)
      return
    }
    setError(null)
    const { previewVoice } = await import('./voice')
    stop.current = previewVoice(voice, line, (st, detail) => {
      if (st === 'idle') setPlaying((x) => (x?.voice === voice ? null : x))
      else if (st === 'error') {
        setPlaying(null)
        setError(detail ? `Couldn't play ${voice}: ${detail}` : `Couldn't play ${voice}.`)
      } else setPlaying({ voice, state: st })
    })
  }
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-sm font-medium">Call voice</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {VOICES.map(([v, d]) => {
          const on = v === value
          const me = playing?.voice === v ? playing.state : null
          return (
            <div
              key={v}
              className={cn(
                'relative flex items-center gap-2 rounded-2xl border p-2 pl-3 transition-colors',
                on ? 'border-primary/60 bg-primary/10' : 'border-border bg-foreground/3 hover:bg-foreground/6',
              )}
            >
              <button type="button" aria-pressed={on} onClick={() => onChange(v)} className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-2xl">
                <span className="flex items-center gap-1 text-sm font-medium">
                  {v} {on && <Check className="size-3.5 text-primary" />}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{d}</span>
              </button>
              <Button
                type="button"
                size="icon-sm"
                variant={me ? 'default' : 'secondary'}
                className="relative z-10 shrink-0"
                aria-label={me ? `Stop ${v}` : `Play ${v}`}
                onClick={() => play(v)}
              >
                {me === 'loading' ? (
                  <Loader2 className="animate-spin" />
                ) : me === 'playing' ? (
                  <Square className="size-3 fill-current" />
                ) : (
                  <Play className="size-3.5 fill-current" />
                )}
              </Button>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">Plays the opening line below in that voice. Uses Gemini Live, like a real call.</p>
      {error && <ErrorText error={error} />}
    </fieldset>
  )
}
