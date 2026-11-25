import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { P_LABEL, P_STYLE, STATUS_STYLE } from './format'

/** Priority and status keep their semantic colours on top of the shadcn Badge shape. */
export const Priority = ({ p, short }: { p: number | null | undefined; short?: boolean }) =>
  p ? (
    <Badge variant="outline" className={cn('border-transparent', P_STYLE[p])}>
      {short ? `P${p}` : P_LABEL[p]}
    </Badge>
  ) : null

export const Status = ({ s }: { s: string }) => (
  <Badge variant="outline" className={cn('border-transparent capitalize', STATUS_STYLE[s] ?? 'bg-muted text-muted-foreground')}>
    {s.replaceAll('_', ' ')}
  </Badge>
)

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const c =
    tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : tone === 'bad' ? 'text-destructive' : 'text-foreground'
  return (
    <Card size="sm" className="gap-1">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn('mt-0.5 text-xl font-semibold tabular-nums', c)}>{value}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
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
