import { Bot, CircleAlert, CircleDashed, Headset, Receipt, Route, Stethoscope } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AGENT_LABEL, P_LABEL, P_STYLE, STATUS_TONE, TONE_DOT } from './format'

/** Priority and status keep their semantic colours on top of the shadcn Badge shape. */
export const Priority = ({ p, short }: { p: number | null | undefined; short?: boolean }) =>
  p ? (
    <Badge variant="outline" className={cn('border-transparent', P_STYLE[p])}>
      {short ? `P${p}` : P_LABEL[p]}
    </Badge>
  ) : null

/** Sentence case for stored states: "awaiting_customer" → "Awaiting customer". */
export const stateLabel = (s: string) => {
  const t = s.replaceAll('_', ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** A stored state as a quiet chip. `undelivered` marks a run that finished but whose customer message never left. */
export const Status = ({ s, undelivered }: { s: string; undelivered?: boolean }) => (
  <Badge
    variant="outline"
    className={cn(
      'gap-1.5 border-border font-normal text-muted-foreground',
      s === 'cancelled' && 'line-through',
      undelivered && 'border-(--attn-2)/50 text-amber-800 dark:text-amber-300',
    )}
  >
    <span className={cn('size-1.5 rounded-full', undelivered ? 'bg-(--attn-2)' : TONE_DOT[STATUS_TONE[s] ?? 'none'])} aria-hidden />
    {stateLabel(s)}
    {undelivered && ' · not delivered'}
  </Badge>
)

/** Progress ring for a share (0..1), e.g. visits done of visits today. */
function Ring({ value }: { value: number }) {
  const r = 18
  const c = 2 * Math.PI * r
  const v = Math.min(Math.max(value, 0), 1)
  return (
    <svg viewBox="0 0 44 44" className="size-11 shrink-0 -rotate-90" role="img" aria-label={`${Math.round(v * 100)}%`}>
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-muted" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        className="stroke-primary motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700"
      />
    </svg>
  )
}

/** KPI card: icon tile, the number with a short note, an optional progress ring, the label underneath. */
export function Stat({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  ratio,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'good' | 'warn' | 'bad'
  icon?: React.ComponentType<{ className?: string }>
  ratio?: number
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className={cn('tile size-9 shrink-0 rounded-xl sm:size-11', tone === 'bad' ? 'tile-red' : tone === 'warn' ? 'tile-attn' : 'tile-quiet')}>
              <Icon className="size-4 sm:size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl leading-tight font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</div>
            {hint && (
              <div className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground max-sm:line-clamp-2 sm:items-center sm:truncate">
                {tone && <span className={cn('mt-1 size-1.5 shrink-0 rounded-full sm:mt-0', TONE_DOT[tone === 'warn' ? 'attn' : tone])} aria-hidden />}
                {hint}
              </div>
            )}
          </div>
          {ratio != null && ratio > 0 && (
            <span className="max-sm:hidden">
              <Ring value={ratio} />
            </span>
          )}
        </div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

export function Section({ title, right, children, className }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="border-b">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {right && <CardAction className="self-center">{right}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** Nothing to show yet: a quiet glyph and one line saying what fills this space. */
export const Empty = ({ children, icon: Icon = CircleDashed }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) => (
  <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
    <span className="tile tile-quiet size-10 rounded-full">
      <Icon className="size-4.5" />
    </span>
    <p className="max-w-xs text-pretty">{children}</p>
  </div>
)

export const ErrorText = ({ error }: { error: string | null }) =>
  error ? (
    <Alert variant="destructive" className="my-2">
      <CircleAlert />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null

export const PageTitle = ({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) => (
  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
    {right}
  </div>
)

export const Muted = ({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) => (
  <span className={cn('text-xs text-muted-foreground', className)} title={title}>
    {children}
  </span>
)

const AGENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  front_desk: Headset,
  diagnosis: Stethoscope,
  dispatch: Route,
  revenue: Receipt,
  ops: Bot,
}

/** Quiet icon tile naming which agent did something; same tile everywhere an agent appears. */
export const AgentTile = ({ agent, className }: { agent: string; className?: string }) => {
  const I = AGENT_ICON[agent] ?? Bot
  return (
    <span
      className={cn('tile tile-quiet size-9 shrink-0', className)}
      role="img"
      aria-label={`${AGENT_LABEL[agent] ?? agent} agent`}
      title={`${AGENT_LABEL[agent] ?? agent} agent`}
    >
      <I className="size-4" />
    </span>
  )
}

/** One colour per priority, used everywhere a priority appears: red P1, amber P2, blue P3, grey P4. */
export const PRIORITY_TILE: Record<number, string> = { 1: 'tile-red', 2: 'tile-attn', 3: 'tile-action', 4: 'tile-quiet' }
export const PriorityTile = ({ p, className }: { p: number; className?: string }) => (
  <span className={cn('tile size-8 shrink-0 text-[11px] font-semibold', PRIORITY_TILE[p] ?? 'tile-quiet', className)} title={`Priority ${p}`}>
    P{p}
  </span>
)
