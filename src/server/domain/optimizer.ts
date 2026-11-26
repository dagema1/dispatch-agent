/**
 * Fleet route optimiser: vehicle routing with time windows, skills, priorities and job value.
 *
 * Pure and deterministic (no I/O) so it is unit-testable and fast enough to run inside the
 * day simulator thousands of times. Times are minutes from the start of the planning day.
 *
 * Construction: regret-2 insertion (urgent / hard-to-place jobs first).
 * Improvement:  relocate + swap local search until no improving move is left.
 */

export type OptTech = {
  id: number
  skills: string[]
  senior: boolean
  /** index into the travel matrix */
  startNode: number
  startMin: number
  endMin: number
  /** Emergency reserve: only P1 visits may run into the last `reserveMin` minutes of the day. */
  reserveMin?: number
}

export type OptJob = {
  id: number
  node: number
  durationMin: number
  skill: string
  priority: 1 | 2 | 3 | 4
  /** earliest allowed start */
  winStart: number
  /** latest allowed start */
  winEnd: number
  valueCents: number
  wantsSenior?: boolean
  /** In-progress / pinned visits keep their technician and start time. */
  pinnedTechId?: number
  pinnedStart?: number
  /** Owner locked this job to a technician (start may move). */
  lockedTechId?: number
}

export type Stop = { jobId: number; start: number; end: number; travelMin: number }
export type Plan = {
  routes: Record<number, Stop[]>
  unassigned: number[]
  travelMin: number
  cost: number
}

export type Travel = (from: number, to: number) => number

const PRIORITY_WAIT_WEIGHT = { 1: 4, 2: 0.6, 3: 0.05, 4: 0.02 } as const
const UNASSIGNED_PENALTY = { 1: 1_000_000, 2: 100_000, 3: 20_000, 4: 8_000 } as const
/** P1 emergencies may run into overtime. */
const OVERTIME_ALLOWED = { 1: 120, 2: 30, 3: 0, 4: 0 } as const
const OVERTIME_WEIGHT = 3
const NOT_SENIOR_PENALTY = 90

type RouteEval = { ok: boolean; cost: number; stops: Stop[]; travel: number }

function canServe(tech: OptTech, job: OptJob): boolean {
  if (job.pinnedTechId !== undefined && job.pinnedTechId !== tech.id) return false
  if (job.lockedTechId !== undefined && job.lockedTechId !== tech.id) return false
  return tech.skills.includes(job.skill)
}

/** Simulate a route in order; returns feasibility, cost and the timed stops. */
export function evalRoute(tech: OptTech, seq: OptJob[], travel: Travel): RouteEval {
  let t = tech.startMin
  let node = tech.startNode
  let cost = 0
  let travelSum = 0
  let maxOvertimeAllowed = 0
  const stops: Stop[] = []
  for (const job of seq) {
    if (!canServe(tech, job)) return { ok: false, cost: Infinity, stops, travel: 0 }
    const drive = travel(node, job.node)
    let start: number
    if (job.pinnedStart !== undefined) {
      start = job.pinnedStart
    } else {
      start = Math.max(t + drive, job.winStart)
      if (start > job.winEnd) return { ok: false, cost: Infinity, stops, travel: 0 }
    }
    const end = start + job.durationMin
    if (tech.reserveMin && job.priority !== 1 && job.pinnedStart === undefined && end > tech.endMin - tech.reserveMin) return { ok: false, cost: Infinity, stops, travel: 0 }
    travelSum += drive
    cost += drive + PRIORITY_WAIT_WEIGHT[job.priority] * Math.max(0, start - Math.max(job.winStart, tech.startMin))
    if (job.wantsSenior && !tech.senior) cost += NOT_SENIOR_PENALTY
    maxOvertimeAllowed = Math.max(maxOvertimeAllowed, OVERTIME_ALLOWED[job.priority])
    stops.push({ jobId: job.id, start, end, travelMin: drive })
    t = end
    node = job.node
  }
  const overtime = Math.max(0, t - tech.endMin)
  if (overtime > maxOvertimeAllowed) return { ok: false, cost: Infinity, stops, travel: 0 }
  cost += overtime * OVERTIME_WEIGHT
  return { ok: true, cost, stops, travel: travelSum }
}

type State = { techs: OptTech[]; seqs: OptJob[][]; costs: number[]; unassigned: OptJob[] }

function bestInsertion(state: State, job: OptJob, travel: Travel) {
  let best: { r: number; pos: number; delta: number } | null = null
  let second = Infinity
  state.techs.forEach((tech, r) => {
    if (!canServe(tech, job)) return
    let routeBest = Infinity
    let routeBestPos = -1
    const seq = state.seqs[r]
    // pinned jobs stay at the front of the route
    const firstPos = seq.filter((j) => j.pinnedStart !== undefined).length
    for (let pos = firstPos; pos <= seq.length; pos++) {
      const trial = [...seq.slice(0, pos), job, ...seq.slice(pos)]
      const ev = evalRoute(tech, trial, travel)
      if (!ev.ok) continue
      const delta = ev.cost - state.costs[r]
      if (delta < routeBest) {
        routeBest = delta
        routeBestPos = pos
      }
    }
    if (routeBestPos < 0) return
    if (!best || routeBest < best.delta) {
      second = best ? best.delta : second
      best = { r, pos: routeBestPos, delta: routeBest }
    } else if (routeBest < second) {
      second = routeBest
    }
  })
  return { best: best as { r: number; pos: number; delta: number } | null, regret: second - (best ? (best as { delta: number }).delta : 0) }
}

function insertAt(state: State, r: number, pos: number, job: OptJob, travel: Travel) {
  state.seqs[r] = [...state.seqs[r].slice(0, pos), job, ...state.seqs[r].slice(pos)]
  state.costs[r] = evalRoute(state.techs[r], state.seqs[r], travel).cost
}

function totalCost(state: State): number {
  return state.costs.reduce((a, b) => a + b, 0) + state.unassigned.reduce((a, j) => a + UNASSIGNED_PENALTY[j.priority] + j.valueCents / 100, 0)
}

export function optimise(techs: OptTech[], jobs: OptJob[], travel: Travel, opts: { maxMs?: number } = {}): Plan {
  const deadline = Date.now() + (opts.maxMs ?? 400)
  const state: State = { techs, seqs: techs.map(() => []), costs: techs.map(() => 0), unassigned: [] }

  // Pinned (in-progress) visits first, in start order.
  const pinned = jobs.filter((j) => j.pinnedTechId !== undefined).sort((a, b) => (a.pinnedStart ?? 0) - (b.pinnedStart ?? 0))
  for (const j of pinned) {
    const r = techs.findIndex((t) => t.id === j.pinnedTechId)
    if (r < 0) {
      state.unassigned.push(j)
      continue
    }
    state.seqs[r].push(j)
  }
  state.costs = techs.map((t, r) => evalRoute(t, state.seqs[r], travel).cost)

  // Regret insertion: always place the job we would regret most not placing now.
  let pool = jobs.filter((j) => j.pinnedTechId === undefined)
  while (pool.length) {
    let pick: { job: OptJob; r: number; pos: number; score: number } | null = null
    const impossible: OptJob[] = []
    for (const job of pool) {
      const { best, regret } = bestInsertion(state, job, travel)
      if (!best) {
        impossible.push(job)
        continue
      }
      // urgency dominates, then regret, then value
      const score = (5 - job.priority) * 1e6 + Math.min(regret, 1e5) + job.valueCents / 1e4
      if (!pick || score > pick.score) pick = { job, r: best.r, pos: best.pos, score }
    }
    for (const j of impossible) state.unassigned.push(j)
    pool = pool.filter((j) => !impossible.includes(j))
    if (!pick) break
    insertAt(state, pick.r, pick.pos, pick.job, travel)
    pool = pool.filter((j) => j !== pick.job)
  }

  // Local search: relocate each job to its best position anywhere; swap jobs between routes.
  let improved = true
  while (improved && Date.now() < deadline) {
    improved = false
    for (let r = 0; r < techs.length && Date.now() < deadline; r++) {
      for (let i = 0; i < state.seqs[r].length; i++) {
        const job = state.seqs[r][i]
        if (job.pinnedStart !== undefined) continue
        const before = totalCost(state)
        const saved = { seqs: state.seqs.map((s) => s), costs: [...state.costs] }
        state.seqs[r] = state.seqs[r].filter((_, k) => k !== i)
        state.costs[r] = evalRoute(techs[r], state.seqs[r], travel).cost
        const { best } = bestInsertion(state, job, travel)
        if (best) insertAt(state, best.r, best.pos, job, travel)
        if (!best || totalCost(state) >= before - 0.5) {
          state.seqs = saved.seqs
          state.costs = saved.costs
        } else {
          improved = true
        }
      }
    }
    // try to place previously-unassigned jobs again (space may have opened up)
    for (const job of [...state.unassigned]) {
      const { best } = bestInsertion(state, job, travel)
      if (best) {
        insertAt(state, best.r, best.pos, job, travel)
        state.unassigned = state.unassigned.filter((j) => j !== job)
        improved = true
      }
    }
    // inter-route swaps
    for (let a = 0; a < techs.length && Date.now() < deadline; a++)
      for (let b = a + 1; b < techs.length; b++)
        for (let i = 0; i < state.seqs[a].length; i++)
          for (let k = 0; k < state.seqs[b].length; k++) {
            const ja = state.seqs[a][i]
            const jb = state.seqs[b][k]
            if (ja.pinnedStart !== undefined || jb.pinnedStart !== undefined) continue
            const sa = [...state.seqs[a]]
            const sb = [...state.seqs[b]]
            sa[i] = jb
            sb[k] = ja
            const ea = evalRoute(techs[a], sa, travel)
            const eb = evalRoute(techs[b], sb, travel)
            if (ea.ok && eb.ok && ea.cost + eb.cost < state.costs[a] + state.costs[b] - 0.5) {
              state.seqs[a] = sa
              state.seqs[b] = sb
              state.costs[a] = ea.cost
              state.costs[b] = eb.cost
              improved = true
            }
          }
  }

  return toPlan(state, travel)
}

function toPlan(state: State, travel: Travel): Plan {
  const routes: Record<number, Stop[]> = {}
  let travelMin = 0
  state.techs.forEach((t, r) => {
    const ev = evalRoute(t, state.seqs[r], travel)
    routes[t.id] = ev.stops
    travelMin += ev.travel
  })
  return { routes, unassigned: state.unassigned.map((j) => j.id), travelMin, cost: totalCost(state) }
}

/**
 * Baseline used by the simulator: how a busy human dispatcher typically works.
 * First come, first served; each job goes to the qualified technician who is free earliest,
 * appended to the end of their day; no re-ordering and no look-ahead.
 */
export function baselinePlan(techs: OptTech[], jobsInArrivalOrder: OptJob[], travel: Travel): Plan {
  const state: State = { techs, seqs: techs.map(() => []), costs: techs.map(() => 0), unassigned: [] }
  for (const job of jobsInArrivalOrder) {
    let best: { r: number; end: number } | null = null
    techs.forEach((tech, r) => {
      if (!canServe(tech, job)) return
      const ev = evalRoute(tech, [...state.seqs[r], job], travel)
      if (!ev.ok) return
      const end = ev.stops[ev.stops.length - 1].end
      if (!best || end < best.end) best = { r, end }
    })
    if (!best) {
      state.unassigned.push(job)
      continue
    }
    const r = (best as { r: number }).r
    state.seqs[r] = [...state.seqs[r], job]
    state.costs[r] = evalRoute(techs[r], state.seqs[r], travel).cost
  }
  return toPlan(state, travel)
}
