import { db, schema } from '../db'
import { rng, TECHS } from '../db/seed-data'
import { baselinePlan, type OptJob, type OptTech, optimise, type Plan } from '../domain/optimizer'
import { prioritise, ruleExtract } from '../domain/triage'
import { estimateMinutes, type LatLng } from '../integrations/routing'
import { publish } from '../lib/bus'

/**
 * Day simulator: replays one busy day of customer contacts through two operating models and
 * compares outcomes on the same demand, same fleet, same drive times.
 *
 *  AI front office — answers every contact in seconds (24/7), triages with safety + weather rules,
 *                    and re-plans the whole fleet every 15 minutes with the optimiser.
 *  Human baseline  — 1 CSR + 1 dispatcher, 08:00–17:00. Calls queue (≈6 min each); some callers hang up;
 *                    after-hours contacts go to voicemail and many never get a call back. Dispatcher
 *                    books first-come-first-served into the earliest-finishing qualified tech and
 *                    only escalates obvious emergencies (gas, CO, "flooding").
 *
 * Everything runs in memory (no messages, no DB writes except the result event), deterministic per seed.
 */
type Scenario = 'normal' | 'cold_snap' | 'heat_wave'

const TEMPLATES: Record<Scenario, Array<[weight: number, text: string]>> = {
  normal: [
    [3, 'Furnace is making a loud banging noise when it starts'],
    [2, 'Kitchen sink drain is clogged and draining very slowly'],
    [2, 'Water heater not producing hot water since this morning'],
    [2, 'Toilet keeps running constantly'],
    [2, 'Would like a quote to replace our 20 year old furnace'],
    [1, 'Annual AC tune-up please, sometime this week'],
    [1, 'Small leak under the bathroom sink, dripping into a bucket'],
    [1, 'I smell gas near the furnace in the basement'],
    [1, 'Burst pipe in the basement, water everywhere'],
    [1, 'Thermostat display is blank'],
  ],
  cold_snap: [
    [6, 'No heat at all, the furnace will not turn on and the house is freezing'],
    [2, 'No heat, my elderly mother lives with us and it is 55 degrees inside'],
    [2, 'Furnace keeps shutting off after a few minutes, house getting cold'],
    [2, 'Frozen pipe, no water to the kitchen'],
    [1, 'Burst pipe in the garage, water spraying'],
    [1, 'Carbon monoxide alarm going off in the hallway'],
    [1, 'I smell gas near the furnace in the basement'],
    [2, 'Water heater pilot keeps going out'],
    [1, 'Would like a quote to replace our 20 year old furnace'],
    [1, 'Kitchen sink drain is clogged and draining very slowly'],
  ],
  heat_wave: [
    [6, 'AC not cooling at all, blowing warm air, upstairs is 90 degrees'],
    [2, 'No cooling and we have a newborn baby at home'],
    [2, 'AC outdoor unit is humming but the fan is not spinning'],
    [2, 'AC is leaking water from the indoor unit onto the floor'],
    [1, 'Sparks and burning smell from the AC unit outside'],
    [1, 'Would like a quote to replace our 20 year old AC'],
    [2, 'Toilet keeps running constantly'],
    [1, 'Water heater not producing hot water since this morning'],
    [1, 'Kitchen sink drain is clogged and draining very slowly'],
  ],
}
const TEMP_C: Record<Scenario, number> = { normal: 8, cold_snap: -18, heat_wave: 36 }

type SimReq = {
  id: number
  arrival: number
  text: string
  loc: LatLng
  priority: 1 | 2 | 3 | 4
  trueP: 1 | 2 | 3 | 4
  skill: string
  minutes: number
  valueCents: number
  wantsSenior: boolean
}

export type ModelResult = {
  label: string
  answered: number
  lost: number
  medianResponseMin: number
  booked: number
  servedToday: number
  p1Total: number
  p1ServedToday: number
  p1AvgWaitMin: number | null
  revenueTodayCents: number
  driveMin: number
  driveMinPerJob: number
  techUtilisation: number
  /** for the chart: cumulative jobs served by hour */
  servedByHour: number[]
}

export async function simulateDay(opts: { scenario: Scenario; requests: number; seed?: number }) {
  const t0 = Date.now()
  const r = rng(opts.seed ?? 2026)
  const reqs = makeDemand(opts.scenario, opts.requests, r)
  const nodes: LatLng[] = [...TECHS.map((t) => t.home), ...reqs.map((q) => q.loc)]
  const matrix = nodes.map((a) => nodes.map((b) => (a === b ? 0 : estimateMinutes(a, b))))
  const travel = (a: number, b: number) => matrix[a][b]
  const techs: OptTech[] = TECHS.map((t, i) => ({ id: i + 1, skills: t.skills, senior: t.level === 'senior', startNode: i, startMin: 7 * 60, endMin: 19 * 60 }))
  const node = (q: SimReq) => TECHS.length + q.id

  // ---- AI front office ----
  const ai = { answeredAt: new Map<number, number>() }
  for (const q of reqs) ai.answeredAt.set(q.id, q.arrival + 0.2)
  let aiPlan: Plan = { routes: {}, unassigned: [], travelMin: 0, cost: 0 }
  for (let now = 6 * 60; now <= 19 * 60; now += 15) {
    const known = reqs.filter((q) => ai.answeredAt.get(q.id)! <= now)
    const started = new Map<number, { tech: number; start: number }>()
    for (const [tid, stops] of Object.entries(aiPlan.routes)) for (const s of stops) if (s.start <= now) started.set(s.jobId, { tech: Number(tid), start: s.start })
    const jobs: OptJob[] = known.map((q) => ({
      id: q.id,
      node: node(q),
      durationMin: q.minutes,
      skill: q.skill,
      priority: q.priority,
      winStart: Math.max(now, ai.answeredAt.get(q.id)!),
      winEnd: 19 * 60,
      valueCents: q.valueCents,
      wantsSenior: q.wantsSenior,
      ...(started.has(q.id) ? { pinnedTechId: started.get(q.id)!.tech, pinnedStart: started.get(q.id)!.start, winStart: started.get(q.id)!.start } : {}),
    }))
    aiPlan = optimise(techs, jobs, travel, { maxMs: 120 })
  }

  // ---- Human baseline ----
  const human = { answeredAt: new Map<number, number>(), lost: 0 }
  let csrFreeAt = 8 * 60
  const ordered = [...reqs].sort((a, b) => a.arrival - b.arrival)
  for (const q of ordered) {
    if (q.arrival < 8 * 60 || q.arrival >= 17 * 60) {
      // voicemail: ~45% never call back / book elsewhere; the rest are called back next business window
      if (r() < 0.45) {
        human.lost++
        continue
      }
      const at = q.arrival < 8 * 60 ? 8 * 60 + r() * 90 : null
      if (at === null) {
        human.lost++ // evening voicemail → called back tomorrow, not served today
        continue
      }
      human.answeredAt.set(q.id, Math.max(at, csrFreeAt))
      csrFreeAt = Math.max(at, csrFreeAt) + 6
      continue
    }
    const wait = Math.max(0, csrFreeAt - q.arrival)
    // callers abandon after ~4 min on hold; ~60% of them leave a voicemail that gets returned later
    if (wait > 4 && r() < Math.min(0.9, wait / 30)) {
      if (r() < 0.4) {
        human.lost++
        continue
      }
      human.answeredAt.set(q.id, q.arrival + wait + 45)
      continue
    }
    human.answeredAt.set(q.id, q.arrival + wait)
    csrFreeAt = q.arrival + wait + 6
  }
  const humanJobs: OptJob[] = [...human.answeredAt.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id, at]) => {
      const q = reqs[id]
      // human dispatch: only explicit emergencies jump the line; everything else is "next available"
      const explicit = /gas|carbon monoxide|burst|spraying|sparks/i.test(q.text)
      return { id, node: node(q), durationMin: q.minutes, skill: q.skill, priority: explicit ? 1 : 3, winStart: at + 10, winEnd: 19 * 60, valueCents: q.valueCents }
    })
  const humanPlan = baselinePlan(techs, humanJobs, travel)

  const result = {
    scenario: opts.scenario,
    requests: reqs.length,
    outdoorTempF: Math.round((TEMP_C[opts.scenario] * 9) / 5 + 32),
    ai: score('AI front office', reqs, ai.answeredAt, 0, aiPlan, techs),
    human: score('Human office (baseline)', reqs, human.answeredAt, human.lost, humanPlan, techs),
    ms: Date.now() - t0,
  }
  await db
    .insert(schema.settings)
    .values({ key: `sim_last`, value: result })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: result } })
  await publish('sim.finished', { scenario: opts.scenario, requests: reqs.length, aiServed: result.ai.servedToday, humanServed: result.human.servedToday })
  return result
}

function score(label: string, reqs: SimReq[], answered: Map<number, number>, lost: number, plan: Plan, techs: OptTech[]): ModelResult {
  const stops = Object.values(plan.routes).flat()
  const byId = new Map(stops.map((s) => [s.jobId, s]))
  const resp = [...answered.entries()].map(([id, at]) => at - reqs[id].arrival).sort((a, b) => a - b)
  const p1 = reqs.filter((q) => q.trueP === 1)
  const p1Served = p1.filter((q) => byId.has(q.id))
  const p1Waits = p1Served.map((q) => byId.get(q.id)!.start - q.arrival)
  const work = stops.reduce((a, s) => a + (s.end - s.start), 0)
  const shift = techs.reduce((a, t) => a + (t.endMin - t.startMin), 0)
  const servedByHour = Array.from({ length: 13 }, (_, h) => stops.filter((s) => s.end <= (7 + h + 1) * 60).length)
  return {
    label,
    answered: answered.size,
    lost,
    medianResponseMin: resp.length ? Math.round(resp[Math.floor(resp.length / 2)] * 10) / 10 : 0,
    booked: answered.size,
    servedToday: stops.length,
    p1Total: p1.length,
    p1ServedToday: p1Served.length,
    p1AvgWaitMin: p1Waits.length ? Math.round(p1Waits.reduce((a, b) => a + b, 0) / p1Waits.length) : null,
    revenueTodayCents: stops.reduce((a, s) => a + reqs[s.jobId].valueCents, 0),
    driveMin: Math.round(plan.travelMin),
    driveMinPerJob: stops.length ? Math.round(plan.travelMin / stops.length) : 0,
    techUtilisation: Math.round((work / shift) * 100) / 100,
    servedByHour,
  }
}

function makeDemand(sc: Scenario, n: number, r: () => number): SimReq[] {
  const tpl = TEMPLATES[sc]
  const total = tpl.reduce((a, [w]) => a + w, 0)
  const pick = () => {
    let x = r() * total
    for (const [w, t] of tpl) {
      x -= w
      if (x < 0) return t
    }
    return tpl[0][1]
  }
  const out: SimReq[] = []
  for (let i = 0; i < n; i++) {
    // arrivals: 15% overnight/early, peak 7–10am, steady through the day, some evening
    const u = r()
    const arrival = u < 0.12 ? r() * 7 * 60 : u < 0.45 ? 7 * 60 + r() * 180 : u < 0.9 ? 10 * 60 + r() * 420 : 17 * 60 + r() * 300
    const text = pick()
    const ex = ruleExtract(text)
    const t = prioritise(ex, text, { tempC: TEMP_C[sc] })
    const loc = { lat: 39.74 + (r() - 0.5) * 0.36, lng: -104.99 + (r() - 0.5) * 0.46 }
    out.push({
      id: i,
      arrival: Math.round(arrival),
      text,
      loc,
      priority: t.priority,
      trueP: t.priority,
      skill: t.skill,
      minutes: Math.min(t.estMinutes, 120),
      valueCents: t.estValueCents,
      wantsSenior: t.wantsSenior,
    })
  }
  return out
}

export async function lastSimulation() {
  const { eq } = await import('drizzle-orm')
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'sim_last'))
  return row?.value ?? null
}
