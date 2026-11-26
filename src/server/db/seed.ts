import { sql } from 'drizzle-orm'
import { replan } from '../domain/dispatch'
import { addDays, dayOf, zoned } from '../lib/time'
import { db, getPool, schema } from './index'
import { runMigrations } from './migrate'
import { makeCustomers, PRICE_BOOK, ROUTINE_JOBS, rng, TECHS } from './seed-data'

/** Reset the demo company to a clean, realistic state: 5 technicians, 40 customers, a partly booked week. */
export async function seed({ quiet = false } = {}) {
  await runMigrations()
  const links = new Map((await db.select().from(schema.technicians)).map((t) => [t.name, t.telegramChatId]))
  await db.execute(
    sql`TRUNCATE agent_steps, agent_runs, approvals, events, queue, messages, calls, invoices, quotes, jobs, requests, equipment, customers, technicians, price_items, campaigns RESTART IDENTITY CASCADE`,
  )
  await db.execute(sql`DELETE FROM settings WHERE key NOT IN ('google_oauth', 'telegram_owner')`)

  // keep Telegram links across resets
  const techRows = await db
    .insert(schema.technicians)
    .values(
      TECHS.map((t) => ({ name: t.name, skills: t.skills, level: t.level, color: t.color, homeLat: t.home.lat, homeLng: t.home.lng, telegramChatId: links.get(t.name) ?? null })),
    )
    .returning()

  await db.insert(schema.priceItems).values(PRICE_BOOK)

  const customers = makeCustomers(40)
  const custRows = await db
    .insert(schema.customers)
    .values(customers.map(({ equipment: _e, ...c }) => c))
    .returning()
  await db
    .insert(schema.equipment)
    .values(custRows.flatMap((c, i) => customers[i].equipment.map((e) => ({ customerId: c.id, kind: e.kind, brand: e.brand, installYear: e.installYear }))))

  // A partly booked schedule: routine jobs across today and the next two days.
  const r = rng(42)
  const now = new Date()
  const today = dayOf(now)
  const jobs = []
  for (let i = 0; i < 22; i++) {
    const tpl = ROUTINE_JOBS[i % ROUTINE_JOBS.length]
    const cust = custRows[(i * 3 + 1) % custRows.length]
    const day = addDays(today, i % 3)
    const morning = r() < 0.5
    const win =
      r() < 0.6 ? { start: zoned(day, morning ? '08:00' : '12:00'), end: zoned(day, morning ? '12:00' : '17:00') } : { start: zoned(day, '08:00'), end: zoned(day, '17:00') }
    const past = win.end.getTime() < now.getTime()
    jobs.push({
      ...(past ? { status: 'done' as const, technicianId: techRows[i % techRows.length].id, completedAt: new Date(win.start.getTime() + tpl.minutes * 60_000) } : {}),
      customerId: cust.id,
      title: tpl.title,
      priority: tpl.priority,
      skill: tpl.skill,
      durationMin: tpl.minutes,
      estValueCents: tpl.cents,
      windowStart: win.start,
      windowEnd: win.end,
    })
  }
  await db.insert(schema.jobs).values(jobs)
  const plan = await replan({ reason: 'seed', now })
  if (!quiet)
    console.log(
      `seeded ${techRows.length} techs, ${custRows.length} customers, ${jobs.length} jobs; scheduled ${plan.scheduled}, unassigned ${plan.unassigned.length} (matrix: ${plan.source})`,
    )
  return plan
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => getPool().end())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
