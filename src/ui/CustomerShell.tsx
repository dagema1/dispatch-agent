import { Link } from '@tanstack/react-router'
import { Link2Off, Phone, Wrench } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Backdrop } from './Backdrop'
import { Empty } from './bits'
import { ThemeToggle } from './theme'

const FALLBACK = { name: 'Northline Heating & Plumbing', phone: '(720) 555-0142' }
/** `(720) 555-0142` → `tel:+17205550142` */
export const telHref = (phone: string) => `tel:+1${phone.replace(/\D/g, '').slice(-10)}`

/** Customer-facing frame: phone-first, one column, the company and a call button always at the top. */
export function CustomerShell({ company, sub, wide, children }: { company?: { name: string; phone: string }; sub?: string; wide?: boolean; children: React.ReactNode }) {
  const c = company ?? FALLBACK
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <Backdrop />
      <div className={cn('relative mx-auto px-4 py-4 sm:py-6', wide ? 'max-w-2xl' : 'max-w-xl')}>
        <header className="mb-3 flex items-center gap-2.5 rounded-full border border-(--edge) bg-(--glass) p-1.5 backdrop-blur-xl">
          <span className="tile tile-solid size-9 shrink-0">
            <Wrench className="size-4.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{c.name}</div>
            {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
          </div>
          <ThemeToggle className="ml-auto size-9 shrink-0 rounded-full" />
          <a
            href={telHref(c.phone)}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.16)] transition-colors hover:bg-[color-mix(in_oklch,var(--primary),white_10%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            <Phone className="size-4" />
            <span>
              <span className="max-sm:sr-only">Call </span>
              <span className="tabular-nums max-[380px]:sr-only">{c.phone}</span>
            </span>
          </a>
        </header>
        {children}
      </div>
    </div>
  )
}

export const NotFound = () => (
  <CustomerShell>
    <Card>
      <CardContent>
        <Empty icon={Link2Off}>
          This link is invalid or has expired. Call us at{' '}
          <a href={telHref(FALLBACK.phone)} className="font-medium whitespace-nowrap text-foreground underline underline-offset-2">
            {FALLBACK.phone}
          </a>{' '}
          and we'll send a fresh one, or{' '}
          <Link to="/book" className="font-medium text-foreground underline underline-offset-2">
            book a new visit
          </Link>
          .
        </Empty>
      </CardContent>
    </Card>
  </CustomerShell>
)
