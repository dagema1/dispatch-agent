import { cn } from '@/lib/utils'

/** Stops along the drawn route, in viewBox units; the last one is "now", drawn as the van. */
const STOPS: Array<[number, number]> = [
  [90, 420],
  [330, 240],
  [570, 330],
  [810, 150],
  [1050, 270],
]
const ROUTE = 'M90 420 H210 V240 H330 M330 240 V330 H570 M570 330 H690 V150 H810 M810 150 V270 H1050 H1140'

/**
 * The world's signature: a dispatcher's route over a street grid, faint in the top light.
 * It is the one decorative element, and it comes from the work itself (a tech's day on the map),
 * not from the AI category. Purely decorative, so hidden from assistive tech.
 */
export function RouteMotif({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 600"
      preserveAspectRatio="xMidYMin slice"
      className={cn('pointer-events-none [mask-image:linear-gradient(to_bottom,black_40%,transparent)]', className)}
    >
      <defs>
        <pattern id="streets" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M60 0H0V60" fill="none" stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="1200" height="600" fill="url(#streets)" className="text-foreground" />
      <path d={ROUTE} fill="none" stroke="var(--primary)" strokeOpacity="0.45" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" />
      {STOPS.map(([x, y], i) => (
        <g key={x}>
          <circle
            cx={x}
            cy={y}
            r={i === STOPS.length - 1 ? 9 : 5}
            fill="var(--background)"
            stroke="var(--primary)"
            strokeOpacity={i === STOPS.length - 1 ? 0.9 : 0.5}
            strokeWidth="2"
          />
          {i === STOPS.length - 1 && <circle cx={x} cy={y} r="3.5" fill="var(--primary)" />}
        </g>
      ))}
    </svg>
  )
}
