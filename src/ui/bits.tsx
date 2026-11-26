import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { P_LABEL, P_STYLE, STATUS_TONE, TONE_DOT } from './format'

/** Priority and status keep their semantic colours on top of the shadcn Badge shape. */
export const Priority = ({ p, short }: { p: number | null | undefined; short?: boolean }) =>
  p ? (
    <Badge variant="outline" className={cn('border-transparent', P_STYLE[p])}>
      {short ? `P${p}` : P_LABEL[p]}
    </Badge>
  ) : null

export const Status = ({ s }: { s: string }) => (
  <Badge variant="outline" className={cn('gap-1.5 border-border font-normal text-muted-foreground capitalize', s === 'cancelled' && 'line-through')}>
    <span className={cn('size-1.5 rounded-full', TONE_DOT[STATUS_TONE[s] ?? 'none'])} aria-hidden />
    {s.replaceAll('_', ' ')}
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
          {ratio != null && (
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

export const Empty = ({ children }: { children: React.ReactNode }) => <div className="py-6 text-center text-sm text-muted-foreground">{children}</div>

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

export const Muted = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('text-xs text-muted-foreground', className)}>{children}</span>
)
