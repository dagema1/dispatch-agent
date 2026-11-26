import type { LucideIcon } from 'lucide-react'
import { CircleHelp } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

export type ConfirmOptions = {
  title: string
  description?: React.ReactNode
  /** Extra context shown in a recessed well, e.g. the message that will be sent. */
  detail?: React.ReactNode
  confirm?: string
  cancel?: string
  /** `danger` for destructive or customer-facing actions that cannot be taken back. */
  tone?: 'action' | 'attn' | 'danger'
  icon?: LucideIcon
}

type Ask = (o: ConfirmOptions) => Promise<boolean>
const Ctx = createContext<Ask | null>(null)

const TILE = { action: 'tile-action', attn: 'tile-attn', danger: 'tile-red' } as const

/** One shared confirmation dialog for the app. `const confirm = useConfirm(); if (await confirm({...})) run()` */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const ask = useCallback<Ask>((o) => {
    resolver.current?.(false)
    setOpts(o)
    setOpen(true)
    return new Promise<boolean>((res) => {
      resolver.current = res
    })
  }, [])

  const settle = (v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setOpen(false)
  }

  const tone = opts?.tone ?? 'action'
  const Icon = opts?.icon ?? CircleHelp
  return (
    <Ctx.Provider value={ask}>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => !o && settle(false)}>
        <AlertDialogContent className="sm:max-w-md">
          {opts && (
            <>
              <AlertDialogHeader>
                <AlertDialogMedia className={cn('tile size-10 rounded-xl', TILE[tone])}>
                  <Icon className="size-5" />
                </AlertDialogMedia>
                <AlertDialogTitle>{opts.title}</AlertDialogTitle>
                {opts.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
              </AlertDialogHeader>
              {opts.detail && <div className="well max-h-48 overflow-auto rounded-xl p-3 text-sm whitespace-pre-wrap">{opts.detail}</div>}
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => settle(false)}>{opts.cancel ?? 'Cancel'}</AlertDialogCancel>
                <AlertDialogAction variant={tone === 'danger' ? 'destructive' : 'default'} onClick={() => settle(true)}>
                  {opts.confirm ?? 'Confirm'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  )
}

export function useConfirm(): Ask {
  const ask = useContext(Ctx)
  if (!ask) throw new Error('useConfirm needs <ConfirmProvider>')
  return ask
}
