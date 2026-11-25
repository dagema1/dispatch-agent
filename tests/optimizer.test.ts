import { describe, expect, it } from 'vitest'
import { baselinePlan, evalRoute, optimise, type OptJob, type OptTech } from '../src/server/domain/optimizer'

// 1-D world: node i sits at position i km on a line; 2 min per km.
const travel = (a: number, b: number) => Math.abs(a - b) * 2

const techs: OptTech[] = [
  { id: 1, skills: ['hvac_repair'], senior: true, startNode: 0, startMin: 480, endMin: 1020 },
  { id: 2, skills: ['hvac_repair', 'plumbing'], senior: false, startNode: 20, startMin: 480, endMin: 1020 },
]
const job = (id: number, node: number, extra: Partial<OptJob> = {}): OptJob => ({
  id,
  node,
  durationMin: 60,
  skill: 'hvac_repair',
  priority: 3,
  winStart: 480,
  winEnd: 960,
  valueCents: 20000,
  ...extra,
})

describe('optimiser', () => {
  it('never violates time windows or skills', () => {
    const jobs = [job(1, 2), job(2, 18), job(3, 5, { skill: 'plumbing' }), job(4, 10, { winStart: 780, winEnd: 800 })]
    const plan = optimise(techs, jobs, travel)
    expect(plan.unassigned).toEqual([])
    for (const t of techs) {
      const ev = evalRoute(t, plan.routes[t.id].map((s) => jobs.find((j) => j.id === s.jobId)!), travel)
      expect(ev.ok).toBe(true)
    }
    expect(plan.routes[2].some((s) => s.jobId === 3)).toBe(true) // only tech 2 does plumbing
    const s4 = Object.values(plan.routes).flat().find((s) => s.jobId === 4)!
    expect(s4.start).toBeGreaterThanOrEqual(780)
    expect(s4.start).toBeLessThanOrEqual(800)
  })

  it('serves emergencies first and drops low priority when the day is full', () => {
    const one = [techs[0]]
    const jobs = [
      ...Array.from({ length: 8 }, (_, i) => job(10 + i, 1, { priority: 4 })),
      job(99, 3, { priority: 1, durationMin: 90 }),
    ]
    const plan = optimise(one, jobs, travel)
    expect(plan.routes[1][0].jobId).toBe(99)
    expect(plan.unassigned.length).toBeGreaterThan(0)
    expect(plan.unassigned).not.toContain(99)
  })

  it('keeps pinned in-progress visits where they are', () => {
    const jobs = [job(1, 15, { pinnedTechId: 1, pinnedStart: 500 }), job(2, 1)]
    const plan = optimise(techs, jobs, travel)
    expect(plan.routes[1][0]).toMatchObject({ jobId: 1, start: 500 })
  })

  it('beats the first-come-first-served baseline', () => {
    const nodes = [19, 1, 18, 2, 17, 3, 16, 4]
    const jobs = [...nodes.map((n, i) => job(i + 1, n)), job(50, 10, { priority: 1 })] // emergency arrives last
    const opt = optimise(techs, jobs, travel)
    const base = baselinePlan(techs, jobs, travel)
    const start = (p: typeof opt) => Object.values(p.routes).flat().find((s) => s.jobId === 50)!.start
    expect(opt.unassigned.length).toBeLessThanOrEqual(base.unassigned.length)
    expect(start(opt)).toBeLessThan(start(base))
  })

  it('fits more jobs than the baseline when windows are tight', () => {
    // Arrival order makes the baseline waste the morning; windows force smart ordering.
    const one = [techs[0]]
    const jobs = [
      job(1, 12, { winStart: 480, winEnd: 1000 }),
      job(2, 1, { winStart: 480, winEnd: 520 }),
      job(3, 2, { winStart: 480, winEnd: 600 }),
      job(4, 3, { winStart: 480, winEnd: 700 }),
    ]
    const opt = optimise(one, jobs, travel)
    const base = baselinePlan(one, jobs, travel)
    expect(opt.unassigned.length).toBe(0)
    expect(base.unassigned.length).toBeGreaterThan(0)
  })
})
