import { Wrench } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ThemeToggle } from './theme'

/** Customer-facing frame: phone-first, one column, tenant identity at the top. */
export function CustomerShell({ company, sub, wide, children }: { company?: { name: string; phone: string }; sub?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <div className={cn('mx-auto px-4 py-6 sm:py-10', wide ? 'max-w-2xl' : 'max-w-xl')}>
        <header className="mb-6 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Wrench className="size-4.5" />
          </span>
          <div>
            <div className="font-semibold">{company?.name ?? 'Northline Heating & Plumbing'}</div>
            <div className="text-xs text-muted-foreground">{sub ?? company?.phone ?? ''}</div>
          </div>
          <ThemeToggle className="ml-auto" />
        </header>
        {children}
      </div>
    </div>
  )
}

export const NotFound = () => (
  <CustomerShell>
    <Card>
      <CardContent className="text-sm text-muted-foreground">This link is invalid or has expired. Please contact us.</CardContent>
    </Card>
  </CustomerShell>
)
