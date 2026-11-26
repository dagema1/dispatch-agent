import { cn } from '@/lib/utils'

/** A colour mixed into the card surface: identity reads without walls of saturated colour. */
export const tint = (c: string, pct: number) => `color-mix(in oklch, ${c} ${pct}%, var(--card))`

export const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

/**
 * Initials disc. Technicians pass their colour (the same one as the timeline and map); everyone
 * else stays neutral so colour keeps meaning "this is a person on the crew".
 */
export function Avatar({ name, color, size = 'md', badge, className }: { name: string; color?: string; size?: 'sm' | 'md' | 'lg'; badge?: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center rounded-full font-semibold select-none',
        size === 'sm' ? 'size-7 text-[10px]' : size === 'lg' ? 'size-11 text-sm' : 'size-9 text-xs',
        !color && 'bg-foreground/8 text-muted-foreground ring-1 ring-foreground/10 ring-inset',
        className,
      )}
      style={color ? { background: tint(color, 22), color: `color-mix(in oklch, ${color} 70%, var(--foreground))`, boxShadow: `inset 0 0 0 1px ${tint(color, 45)}` } : undefined}
      aria-hidden
    >
      {initials(name)}
      {badge && <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full bg-card text-muted-foreground ring-2 ring-card">{badge}</span>}
    </span>
  )
}
