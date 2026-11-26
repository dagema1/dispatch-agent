import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { withViewTransition } from './motion'

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'theme'

/** Runs in <head> before first paint so the page never flashes the wrong theme. */
export const THEME_BOOT = `(function(){try{var p=localStorage.getItem('${KEY}')||'dark';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.rail=localStorage.getItem('rail')==='open'?'open':'closed'}catch(e){}})()`

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'system' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

function apply(p: ThemePref) {
  const dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

const NEXT: Record<ThemePref, ThemePref> = { dark: 'light', light: 'system', system: 'dark' }
const LABEL: Record<ThemePref, string> = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }

export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref | null>(null)
  useEffect(() => setPref(read()), [])
  useEffect(() => {
    // null until the stored preference is read; the boot script already painted that theme
    if (!pref) return
    const want = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    if (document.documentElement.classList.contains('dark') !== want) withViewTransition(() => apply(pref))
    if (pref !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => apply('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [pref])
  const cycle = () => {
    const n = NEXT[pref ?? 'dark']
    try {
      localStorage.setItem(KEY, n)
    } catch {}
    setPref(n)
  }
  const cur = pref ?? 'dark'
  const Icon = cur === 'dark' ? Moon : cur === 'light' ? Sun : Monitor
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className={className} onClick={cycle} aria-label={`${LABEL[cur]} (click to change)`}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{LABEL[cur]}</TooltipContent>
    </Tooltip>
  )
}
