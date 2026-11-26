import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export type Column<T> = {
  key: string
  label: string
  cell: (row: T) => React.ReactNode
  /** Value to sort by; columns without one are not sortable. */
  sort?: (row: T) => number | string
  align?: 'left' | 'right'
  className?: string
}

/** Card-framed data table: title with a total chip, quiet uppercase headers, click-to-sort columns. */
export function RichTable<T>({
  title,
  rows,
  columns,
  rowKey,
  empty,
  initialSort,
}: {
  title: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  empty: React.ReactNode
  initialSort?: { key: string; dir: 'asc' | 'desc' }
}) {
  const [sort, setSort] = useState(initialSort ?? null)
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key)
    if (!col?.sort || !sort) return rows
    const get = col.sort
    const m = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      return (x < y ? -1 : x > y ? 1 : 0) * m
    })
  }, [rows, columns, sort])

  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-2.5 px-5 py-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground tabular-nums">{rows.length} total</span>
      </div>
      {rows.length === 0 ? (
        <div className="border-t px-5 py-8 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => {
                const active = sort?.key === c.key
                const Icon = active ? (sort?.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                return (
                  <TableHead
                    key={c.key}
                    aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('h-10 px-5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase', c.align === 'right' && 'text-right', c.className)}
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                          active && 'text-foreground',
                        )}
                      >
                        {c.label}
                        <Icon className={cn('size-3', !active && 'opacity-50')} />
                      </button>
                    ) : (
                      c.label
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={rowKey(r)}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn('px-5 py-3 align-middle', c.align === 'right' && 'text-right', c.className)}>
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

/** Two-line cell: primary text over a muted detail line. */
export const Cell2 = ({ top, sub }: { top: React.ReactNode; sub?: React.ReactNode }) => (
  <div className="min-w-0">
    <div className="truncate font-medium">{top}</div>
    {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
  </div>
)
