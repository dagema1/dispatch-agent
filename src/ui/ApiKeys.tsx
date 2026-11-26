import { CreditCard, Mail, MessageCircle, Route as RouteIcon, Send, Sparkles } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export type KeyName = 'GEMINI_API_KEY' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_OWNER_CHAT_ID' | 'ORS_API_KEY' | 'STRIPE_SECRET_KEY' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'
export type KeyStatus = { name: KeyName; source: 'saved' | 'server' | 'none'; hint: string | null }
export type KeyPatch = Partial<Record<KeyName, string>>

type Icon = React.ComponentType<{ className?: string }>
/** One group per service, in the order an owner would set them up. */
const GROUPS: Array<{ title: string; icon: Icon; what: string; keys: Array<[KeyName, string, string?]> }> = [
  { title: 'Gemini', icon: Sparkles, what: 'Triage, photo quotes, voice calls, agent chat', keys: [['GEMINI_API_KEY', 'API key']] },
  {
    title: 'Telegram',
    icon: Send,
    what: 'Technician app and owner alerts',
    keys: [
      ['TELEGRAM_BOT_TOKEN', 'Bot token', 'From @BotFather'],
      ['TELEGRAM_OWNER_CHAT_ID', 'Owner chat ID', 'Optional. Or send /owner in your group'],
    ],
  },
  { title: 'Stripe', icon: CreditCard, what: 'Payment links, test mode only', keys: [['STRIPE_SECRET_KEY', 'Secret key', 'Must start with sk_test_']] },
  { title: 'OpenRouteService', icon: RouteIcon, what: 'Real drive times (estimates without it)', keys: [['ORS_API_KEY', 'API key']] },
  {
    title: 'Google',
    icon: Mail,
    what: 'Gmail intake and replies, Calendar',
    keys: [
      ['GOOGLE_CLIENT_ID', 'OAuth client ID'],
      ['GOOGLE_CLIENT_SECRET', 'OAuth client secret'],
    ],
  },
]

const SOURCE: Record<KeyStatus['source'], { label: string; cls: string }> = {
  saved: { label: 'Saved', cls: 'bg-primary/12 text-primary' },
  server: { label: 'Server default', cls: 'bg-foreground/8 text-muted-foreground' },
  none: { label: 'Not set', cls: 'bg-foreground/5 text-muted-foreground' },
}

/**
 * Key entry. The full key never comes back from the server: each field shows where the current
 * value comes from and its last four characters. Typing replaces it; an empty field keeps it.
 */
export function ApiKeyFields({ keys, value, onChange }: { keys: KeyStatus[]; value: KeyPatch; onChange: (v: KeyPatch) => void }) {
  const st = new Map(keys.map((k) => [k.name, k]))
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="well rounded-2xl p-4">
          <legend className="sr-only">{g.title}</legend>
          <div className="mb-3 flex items-center gap-3">
            <span className="tile tile-quiet size-9 shrink-0 rounded-xl">
              <g.icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{g.title}</div>
              <div className="truncate text-xs text-muted-foreground">{g.what}</div>
            </div>
          </div>
          <div className="space-y-3">
            {g.keys.map(([name, label, hint]) => {
              const s = st.get(name)
              const src = SOURCE[s?.source ?? 'none']
              return (
                <div key={name}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Label htmlFor={`key-${name}`}>{label}</Label>
                    <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium', src.cls)}>
                      {src.label}
                      {s?.hint ? ` · ${s.hint}` : ''}
                    </span>
                  </div>
                  <Input
                    id={`key-${name}`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={s?.source === 'none' ? 'Paste to turn on' : 'Paste to replace'}
                    value={value[name] ?? ''}
                    onChange={(e) => onChange({ ...value, [name]: e.target.value })}
                    className="font-mono text-xs"
                  />
                  {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
                </div>
              )
            })}
          </div>
        </fieldset>
      ))}
      <p className="flex items-start gap-2 text-xs text-muted-foreground lg:col-span-2">
        <MessageCircle className="mt-0.5 size-3.5 shrink-0" />
        Keys are stored on your server and never shown again in full. Leave a field empty to keep what's there.
      </p>
    </div>
  )
}

/** Only the fields the owner actually typed in, so untouched keys are left alone. */
export const typedKeys = (v: KeyPatch): KeyPatch => Object.fromEntries(Object.entries(v).filter(([, x]) => x && x.trim() !== '')) as KeyPatch
