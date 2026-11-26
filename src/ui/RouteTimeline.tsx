import { Check, MapPin, Siren, Truck, UserX, Wrench } from 'lucide-react'
import type { Snapshot } from '#/server/api/views'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { minutesOfDay, time } from './format'

type Job = Snapshot['jobs'][number]
type Tech = Snapshot['techs'][number]

export const DAY_START = 7 * 60
export const DAY_END = 19 * 60
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START / 60 + i)
const pct = (m: number) => `${(Math.min(Math.max(m - DAY_START, 0), DAY_END - DAY_START) / (DAY_END - DAY_START)) * 100}%`
const hourLabel = (h: number) => `${((h - 1) % 12) + 1}${h < 12 ? 'a' : 'p'}`
const initials = (n: string) =>
  n
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}` : `${min}m`)
/** Tech colour mixed into the surface, so identity reads without a wall of saturated blocks. */
const tint = (c: string, pctMix: number) => `color-mix(in oklch, ${c} ${pctMix}%, var(--card))`

const span = (j: Job) => {
  const s = minutesOfDay(j.scheduledStart!)
  const e = j.scheduledEnd ? minutesOfDay(j.scheduledEnd) : s + j.durationMin
  return { s, e: Math.max(e, s + 15) }
}

const STATUS = {
  en_route: { icon: Truck, label: 'On the way' },
  on_site: { icon: Wrench, label: 'On site' },
  done: { icon: Check, label: 'Done' },
} as const

/**
 * The fleet's day: one lane per technician on a shared 7am–7pm axis. Visits are slabs tinted with
 * the tech's colour; dashed connectors trace the route between them; the elapsed part of today is
 * shaded up to a "now" marker. Hovering a visit shows its details, clicking opens the job sheet.
 */
export function RouteTimeline({
  techs,
  jobs,
  isToday,
  nowMin,
  isNew,
  isLive,
  onOpen,
  onToggleTech,
  toggleBusy,
}: {
  techs: Tech[]
  jobs: Job[]
  isToday: boolean
  nowMin: number
  isNew: (id: number) => boolean
  isLive: (t: Tech) => boolean
  onOpen: (jobId: number) => void
  onToggleTech: (id: number, active: boolean) => void
  toggleBusy: boolean
}) {
  const showNow = isToday && nowMin > DAY_START && nowMin < DAY_END
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[880px]">
        {/* hour axis, aligned with the lanes below */}
        <div className="flex">
          <div className="w-48 shrink-0" />
          <div className="relative h-6 flex-1 text-[11px] text-muted-foreground tabular-nums">
            {HOURS.map((h, i) => (
              <span key={h} className={cn('absolute top-0', i === 0 ? '' : i === HOURS.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: pct(h * 60) }}>
                {hourLabel(h)}
              </span>
            ))}
            {showNow && (
              <span
                className="absolute top-0 z-10 -translate-x-1/2 rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground"
                style={{ left: pct(nowMin) }}
              >
                Now
              </span>
            )}
          </div>
        </div>

        <ul className="space-y-1.5">
          {techs.map((t) => {
            const lane = jobs.filter((j) => j.technicianId === t.id && j.scheduledStart).sort((a, b) => +new Date(a.scheduledStart!) - +new Date(b.scheduledStart!))
            const booked = lane.reduce((a, j) => a + j.durationMin, 0)
            const skills = [...new Set(t.skills.map((s) => s.split('_')[0]))].join(', ')
            return (
              <li key={t.id} className="group/row flex items-center">
                {/* who */}
                <div className="flex w-48 shrink-0 items-center gap-2.5 pr-3">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold"
                    style={{ background: tint(t.color, 22), color: `color-mix(in oklch, ${t.color} 70%, var(--foreground))`, boxShadow: `inset 0 0 0 1px ${tint(t.color, 45)}` }}
                    aria-hidden
                  >
                    {initials(t.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium" title={`${t.level === 'senior' ? 'Senior · ' : ''}${skills}`}>
                      <span className="truncate">{t.name.split(' ')[0]}</span>
                      {isLive(t) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <MapPin className="size-3.5 shrink-0 text-primary" aria-label="Sharing live location" />
                          </TooltipTrigger>
                          <TooltipContent>Sharing live location</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {t.active ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                        <span className="truncate">{lane.length ? `${lane.length} visit${lane.length === 1 ? '' : 's'} · ${hm(booked)}` : 'Free'}</span>
                        <button
                          type="button"
                          onClick={() => onToggleTech(t.id, false)}
                          disabled={toggleBusy}
                          aria-label={`Mark ${t.name.split(' ')[0]} out`}
                          className="ml-auto rounded opacity-0 outline-none hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"
                        >
                          <UserX className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleTech(t.id, true)}
                        disabled={toggleBusy}
                        className="text-xs font-medium text-destructive outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Out · bring back
                      </button>
                    )}
                  </div>
                </div>

                {/* lane */}
                <div className={cn('well relative h-14 flex-1 overflow-hidden rounded-xl', !t.active && 'opacity-60')}>
                  {/* hour grid */}
                  {HOURS.slice(1, -1).map((h) => (
                    <span key={h} className="absolute inset-y-0 w-px bg-foreground/[0.06]" style={{ left: pct(h * 60) }} aria-hidden />
                  ))}
                  {/* elapsed part of today */}
                  {showNow && <span className="absolute inset-y-0 left-0 bg-foreground/[0.04]" style={{ width: pct(nowMin) }} aria-hidden />}
                  {showNow && <span className="absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-primary" style={{ left: pct(nowMin) }} aria-hidden />}

                  {!t.active ? (
                    <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Out today. Visits were re-planned to others.</span>
                  ) : lane.length === 0 ? (
                    <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">No visits</span>
                  ) : null}

                  {/* route between visits */}
                  {lane.slice(1).map((j, i) => {
                    const prev = span(lane[i])
                    const cur = span(j)
                    if (cur.s - prev.e < 5) return null
                    return (
                      <span
                        key={`leg-${j.id}`}
                        className="absolute top-1/2 h-0 border-t border-dashed"
                        style={{ left: pct(prev.e), width: `calc(${pct(cur.s)} - ${pct(prev.e)})`, borderColor: tint(t.color, 60) }}
                        aria-hidden
                      />
                    )
                  })}

                  {lane.map((j) => {
                    const { s, e } = span(j)
                    const st = STATUS[j.status as keyof typeof STATUS]
                    const p1 = j.priority === 1
                    const narrow = e - s < 55
                    return (
                      <Tooltip key={j.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => onOpen(j.id)}
                            aria-label={`${j.title}, ${j.customer.name}, ${time(j.scheduledStart)}${st ? `, ${st.label}` : ''}`}
                            className={cn(
                              'job-block absolute inset-y-1.5 z-10 flex min-w-0 flex-col justify-center overflow-hidden rounded-lg border px-2 text-left text-[11px] leading-tight text-foreground transition-[left,width,filter] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring',
                              j.status === 'done' && 'opacity-55',
                              isNew(j.id) && 'arrive-pop',
                            )}
                            style={{
                              left: pct(s),
                              width: `calc(${pct(e)} - ${pct(s)})`,
                              background: tint(t.color, 24),
                              borderColor: p1 ? 'var(--destructive)' : tint(t.color, 55),
                            }}
                          >
                            <span className="flex min-w-0 items-center gap-1 font-medium">
                              {p1 && <Siren className="size-3 shrink-0 text-destructive" />}
                              {st && !narrow && <st.icon className="size-3 shrink-0 text-primary" />}
                              <span className="truncate">{narrow ? time(j.scheduledStart) : j.title}</span>
                            </span>
                            {!narrow && (
                              <span className="truncate text-muted-foreground tabular-nums">
                                {time(j.scheduledStart)} · {j.customer.name.split(' ')[0]}
                              </span>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-64">
                          <div className="font-medium">
                            {p1 ? 'Emergency · ' : j.priority === 2 ? 'Urgent · ' : ''}
                            {j.title}
                          </div>
                          <div className="opacity-80">{j.customer.name}</div>
                          <div className="opacity-80">{j.customer.address}</div>
                          <div className="mt-1 tabular-nums opacity-80">
                            {time(j.scheduledStart)} – {time(j.scheduledEnd)}
                            {st ? ` · ${st.label}` : ''}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
