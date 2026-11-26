import { Link2Off, Wrench } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Backdrop } from './Backdrop'
import { Empty } from './bits'
import { ThemeToggle } from './theme'

/** Customer-facing frame: phone-first, one column, tenant identity at the top. */
export function CustomerShell({ company, sub, wide, children }: { company?: { name: string; phone: string }; sub?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <Backdrop />
      <div className={cn('relative mx-auto px-4 py-4 sm:py-6', wide ? 'max-w-2xl' : 'max-w-xl')}>
        <header className="mb-6 flex items-center gap-2.5 rounded-full border border-(--edge) bg-(--glass) py-1.5 pr-1.5 pl-1.5 backdrop-blur-xl">
          <span className="tile tile-solid size-9 rounded-full">
            <Wrench className="size-4.5" />
          </span>
          <div>
            <div className="text-sm font-semibold">{company?.name ?? 'Northline Heating & Plumbing'}</div>
            <div className="text-xs text-muted-foreground">{sub ?? company?.phone ?? ''}</div>
          </div>
          <ThemeToggle className="ml-auto size-9 rounded-full" />
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
        <Empty icon={Link2Off}>This link is invalid or has expired. Call us and we'll send a fresh one.</Empty>
      </CardContent>
    </Card>
  </CustomerShell>
)
