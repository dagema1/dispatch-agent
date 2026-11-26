import { Camera, FileText, Phone, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { deletePriceItem, getPriceBook, savePriceItem } from '#/fns'
import { ErrorText, Muted, PanelHead } from '#/ui/bits'
import { useConfirm } from '#/ui/confirm'
import { money } from '#/ui/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Item = { code: string; name: string; trade: string; cents: number; minutes: number }
type Trade = 'hvac' | 'plumbing' | 'any'
const TRADE: Record<Trade, string> = { hvac: 'Heating & cooling', plumbing: 'Plumbing', any: 'Every visit' }
/** Codes the invoice code relies on: editable, never deleted. */
const CORE = new Set(['DIAG', 'EMERG'])

/** How a price reaches a customer, in the order it happens. */
const HOW: Array<{ icon: React.ComponentType<{ className?: string }>; title: string; body: string }> = [
  { icon: Phone, title: 'On the call', body: 'The receptionist only ever quotes the diagnostic visit (DIAG), and says it is waived if they go ahead.' },
  { icon: Camera, title: 'From photos', body: 'Good, better, best options are built only from items below; the model picks codes, never prices.' },
  { icon: FileText, title: 'On the invoice', body: 'The tech’s note is matched to these codes. Every invoice has DIAG; emergencies add EMERG.' },
  { icon: ShieldCheck, title: 'Anything else', body: 'A price outside this book or a discount follows your permissions in Settings.' },
]

export function PriceBook() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [edit, setEdit] = useState<(Item & { originalCode?: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const confirm = useConfirm()
  const load = useCallback(() => getPriceBook().then(setItems), [])
  useEffect(() => {
    load().catch((e) => setError((e as Error).message))
  }, [load])

  const remove = async (it: Item) => {
    const ok = await confirm({
      title: `Remove ${it.name}?`,
      description: 'Quotes and invoices already sent keep their lines. New ones can no longer use this item.',
      confirm: 'Remove',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    setError(null)
    try {
      await deletePriceItem({ data: { code: it.code } })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const groups = (['any', 'hvac', 'plumbing'] as Trade[]).map((t) => ({ t, rows: (items ?? []).filter((i) => i.trade === t) }))
  return (
    <div className="space-y-4">
      <Card className="gap-0 py-0">
        <PanelHead title="How prices are set" sub="Flat-rate pricing: one price per task, parts and labour included. The agents never invent a number." />
        <CardContent className="py-4">
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {HOW.map((h, i) => (
              <li key={h.title} className="well rounded-2xl p-3.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="tile tile-action size-7 rounded-lg">
                    <h.icon className="size-3.5" />
                  </span>
                  <span className="text-muted-foreground tabular-nums">{i + 1}</span>
                  {h.title}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{h.body}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Price book</h2>
        <Muted>{items ? `${items.length} items` : ''}</Muted>
        <Button size="sm" className="ml-auto" onClick={() => setEdit({ code: '', name: '', trade: 'hvac', cents: 0, minutes: 60 })}>
          <Plus /> Add item
        </Button>
      </div>
      <ErrorText error={error} />

      {!items ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        groups.map(
          ({ t, rows }) =>
            rows.length > 0 && (
              <Card key={t} size="sm" className="gap-0 py-0">
                <div className="flex items-center gap-2 border-b border-(--edge) px-4 py-2.5 text-xs font-medium text-muted-foreground">
                  {TRADE[t]} <span className="tabular-nums">· {rows.length}</span>
                </div>
                <ul className="divide-y divide-(--edge)">
                  {rows.map((it) => (
                    <li key={it.code} className="group flex items-center gap-3 px-4 py-2.5">
                      <code className="w-20 shrink-0 truncate font-mono text-[11px] text-muted-foreground">{it.code}</code>
                      <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline" onClick={() => setEdit({ ...it, originalCode: it.code })}>
                        {it.name}
                      </button>
                      <span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">{it.minutes ? `${it.minutes} min` : '—'}</span>
                      <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">{money(it.cents)}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${it.name}`}
                        disabled={CORE.has(it.code)}
                        title={CORE.has(it.code) ? 'Every invoice uses this item' : undefined}
                        className={cn('shrink-0 opacity-60 group-hover:opacity-100', CORE.has(it.code) && 'invisible')}
                        onClick={() => remove(it)}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            ),
        )
      )}
      <ItemDialog
        item={edit}
        onClose={() => setEdit(null)}
        onSaved={async () => {
          setEdit(null)
          await load()
        }}
      />
    </div>
  )
}

function ItemDialog({ item, onClose, onSaved }: { item: (Item & { originalCode?: string }) | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: '', name: '', trade: 'hvac' as Trade, dollars: '', minutes: '60' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (item) {
      setF({ code: item.code, name: item.name, trade: item.trade as Trade, dollars: item.cents ? (item.cents / 100).toFixed(2) : '', minutes: String(item.minutes) })
      setError(null)
    }
  }, [item])
  const isNew = !item?.originalCode
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await savePriceItem({
        data: {
          originalCode: item?.originalCode,
          code: f.code,
          name: f.name,
          trade: f.trade,
          cents: Math.round(Number(f.dollars || 0) * 100),
          minutes: Math.round(Number(f.minutes || 0)),
        },
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message.replace(/^\[.*?"message":\s*"([^"]+)".*$/s, '$1'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isNew ? 'Add a price' : `Edit ${item?.code}`}</DialogTitle>
            <DialogDescription>Flat rate for the whole task, parts and labour included.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <div>
              <Label htmlFor="pi-code" className="mb-1.5">
                Code
              </Label>
              <Input
                id="pi-code"
                required
                value={f.code}
                disabled={!isNew && CORE.has(item?.originalCode ?? '')}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
                className="font-mono"
                placeholder="CAP"
              />
            </div>
            <div>
              <Label htmlFor="pi-name" className="mb-1.5">
                Task
              </Label>
              <Input id="pi-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="AC capacitor replacement" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="pi-price" className="mb-1.5">
                Price ($)
              </Label>
              <Input id="pi-price" required type="number" inputMode="decimal" min={0} step="0.01" value={f.dollars} onChange={(e) => setF({ ...f, dollars: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pi-min" className="mb-1.5">
                Minutes
              </Label>
              <Input id="pi-min" type="number" inputMode="numeric" min={0} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pi-trade" className="mb-1.5">
                Trade
              </Label>
              <Select value={f.trade} onValueChange={(v) => setF({ ...f, trade: v as Trade })}>
                <SelectTrigger id="pi-trade" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hvac">HVAC</SelectItem>
                  <SelectItem value="plumbing">Plumbing</SelectItem>
                  <SelectItem value="any">Any</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save price'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
