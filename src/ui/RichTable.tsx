import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { CountChip, Empty, PanelHead } from './bits'

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
  onRowClick,
  rowLabel,
}: {
  title: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  empty: React.ReactNode
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  /** Makes each row open something (a detail dialog); rows get hover, pointer and Enter/Space. */
  onRowClick?: (row: T) => void
  /** Accessible name for a clickable row. */
  rowLabel?: (row: T) => string
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

  const clickable = (r: T) =>
    onRowClick
      ? {
          role: 'button' as const,
          tabIndex: 0,
          'aria-label': rowLabel?.(r),
          onClick: () => onRowClick(r),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onRowClick(r)
            }
          },
        }
      : {}
  const rowCls =
    onRowClick &&
    'cursor-pointer outline-none transition-colors hover:bg-foreground/4 focus-visible:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <PanelHead title={title} right={<CountChip>{rows.length} total</CountChip>} />
      {rows.length === 0 ? (
        <div className="px-5">
          <Empty>{empty}</Empty>
        </div>
      ) : (
        <>
          {/* phones: each row becomes a stacked card, so nothing hides off-screen in a sideways scroll */}
          <ul className="divide-y sm:hidden">
            {sorted.map((r) => (
              <li key={rowKey(r)} className={cn('space-y-2 px-4 py-3', rowCls)} {...clickable(r)}>
                <div className="min-w-0">{columns[0]?.cell(r)}</div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-sm">
                  {columns.slice(1).map((c) => (
                    <div key={c.key} className="contents">
                      <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{c.label}</dt>
                      <dd className="min-w-0 justify-self-end text-right">{c.cell(r)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="max-sm:hidden">
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
                  <TableRow key={rowKey(r)} className={cn(rowCls)} {...clickable(r)}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className={cn('px-5 py-3 align-middle', c.align === 'right' && 'text-right', c.className)}>
                        {c.cell(r)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
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
