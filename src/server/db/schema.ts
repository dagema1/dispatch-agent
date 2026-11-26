import { bigserial, boolean, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { withTimezone: true })
const createdAt = () => ts('created_at').notNull().defaultNow()

/** Skills a technician can have and a job can require. */
// biome-ignore lint/suspicious/noExplicitAny: JSON columns hold arbitrary serialisable data
export type JsonObject = Record<string, any>

export const SKILLS = ['hvac_repair', 'hvac_install', 'plumbing', 'water_heater', 'drain'] as const
export type Skill = (typeof SKILLS)[number]

export const technicians = pgTable('technicians', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  skills: text('skills').array().notNull().$type<Skill[]>(),
  level: text('level').notNull().$type<'senior' | 'standard'>(),
  color: text('color').notNull(),
  homeLat: doublePrecision('home_lat').notNull(),
  homeLng: doublePrecision('home_lng').notNull(),
  workStart: text('work_start').notNull().default('08:00'),
  workEnd: text('work_end').notNull().default('17:00'),
  active: boolean('active').notNull().default(true),
  telegramChatId: text('telegram_chat_id'),
  calendarId: text('calendar_id'),
  liveLat: doublePrecision('live_lat'),
  liveLng: doublePrecision('live_lng'),
  liveAt: ts('live_at'),
})

export const customers = pgTable(
  'customers',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    zone: text('zone'),
    homeYear: integer('home_year'),
    hasPlan: boolean('has_plan').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('customers_email_idx').on(t.email)],
)

export const equipment = pgTable('equipment', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  kind: text('kind').notNull(),
  brand: text('brand'),
  model: text('model'),
  serial: text('serial'),
  installYear: integer('install_year'),
  notes: text('notes'),
})

export type Priority = 1 | 2 | 3 | 4

export const requests = pgTable(
  'requests',
  {
    id: serial('id').primaryKey(),
    channel: text('channel').notNull().$type<'voice' | 'email' | 'web' | 'telegram' | 'sim'>(),
    externalId: text('external_id'),
    customerId: integer('customer_id').references(() => customers.id),
    rawText: text('raw_text').notNull(),
    summary: text('summary'),
    extracted: jsonb('extracted').$type<JsonObject>(),
    priority: integer('priority').$type<Priority>(),
    trade: text('trade'),
    skill: text('skill').$type<Skill>(),
    safetyFlag: text('safety_flag'),
    estMinutes: integer('est_minutes'),
    estValueCents: integer('est_value_cents'),
    photos: jsonb('photos').$type<string[]>().default([]),
    status: text('status').notNull().default('new').$type<'new' | 'triaged' | 'awaiting_customer' | 'booked' | 'escalated' | 'closed'>(),
    firstResponseAt: ts('first_response_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('requests_external_idx').on(t.externalId)],
)

export type JobStatus = 'unassigned' | 'scheduled' | 'en_route' | 'on_site' | 'done' | 'cancelled'

export const jobs = pgTable(
  'jobs',
  {
    id: serial('id').primaryKey(),
    requestId: integer('request_id').references(() => requests.id),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    technicianId: integer('technician_id').references(() => technicians.id),
    title: text('title').notNull(),
    status: text('status').notNull().default('unassigned').$type<JobStatus>(),
    priority: integer('priority').notNull().$type<Priority>(),
    skill: text('skill').notNull().$type<Skill>(),
    durationMin: integer('duration_min').notNull(),
    estValueCents: integer('est_value_cents').notNull().default(0),
    /** Customer's acceptable window. */
    windowStart: ts('window_start').notNull(),
    windowEnd: ts('window_end').notNull(),
    /** Planned visit (set by the optimiser). */
    scheduledStart: ts('scheduled_start'),
    scheduledEnd: ts('scheduled_end'),
    sequence: integer('sequence'),
    etaAt: ts('eta_at'),
    calendarEventId: text('calendar_event_id'),
    lockedTech: boolean('locked_tech').notNull().default(false),
    report: jsonb('report').$type<JsonObject>(),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('jobs_tech_idx').on(t.technicianId, t.scheduledStart)],
)

export const quotes = pgTable('quotes', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').references(() => requests.id),
  jobId: integer('job_id').references(() => jobs.id),
  customerId: integer('customer_id').references(() => customers.id),
  diagnosis: jsonb('diagnosis').$type<JsonObject>().notNull(),
  options: jsonb('options')
    .$type<Array<{ tier: 'good' | 'better' | 'best'; title: string; lines: Array<{ code: string; name: string; cents: number }>; totalCents: number }>>()
    .notNull(),
  replacementLead: boolean('replacement_lead').notNull().default(false),
  status: text('status').notNull().default('sent').$type<'draft' | 'sent' | 'accepted' | 'declined'>(),
  chosenTier: text('chosen_tier'),
  createdAt: createdAt(),
})

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id')
    .notNull()
    .references(() => jobs.id),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  lines: jsonb('lines').$type<Array<{ code: string; name: string; qty: number; cents: number }>>().notNull(),
  totalCents: integer('total_cents').notNull(),
  status: text('status').notNull().default('draft').$type<'draft' | 'sent' | 'paid' | 'void'>(),
  stripeSessionId: text('stripe_session_id'),
  payUrl: text('pay_url'),
  remindersSent: integer('reminders_sent').notNull().default(0),
  sentAt: ts('sent_at'),
  paidAt: ts('paid_at'),
  createdAt: createdAt(),
})

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').references(() => requests.id),
  jobId: integer('job_id').references(() => jobs.id),
  customerId: integer('customer_id').references(() => customers.id),
  technicianId: integer('technician_id').references(() => technicians.id),
  direction: text('direction').notNull().$type<'in' | 'out'>(),
  channel: text('channel').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  delivered: boolean('delivered').notNull().default(false),
  createdAt: createdAt(),
})

export const calls = pgTable('calls', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').references(() => requests.id),
  customerId: integer('customer_id').references(() => customers.id),
  transcript: jsonb('transcript').$type<Array<{ role: 'caller' | 'agent'; text: string }>>().notNull().default([]),
  summary: text('summary'),
  startedAt: createdAt(),
  endedAt: ts('ended_at'),
})

export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  trigger: text('trigger').notNull(),
  title: text('title').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  customerIds: jsonb('customer_ids').$type<number[]>().notNull(),
  status: text('status').notNull().default('draft').$type<'draft' | 'sent' | 'rejected'>(),
  sentAt: ts('sent_at'),
  createdAt: createdAt(),
})

/** Append-only domain event log (also fanned out to live UI). */
export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<JsonObject>().notNull(),
  createdAt: createdAt(),
})

/** Durable job queue (SELECT ... FOR UPDATE SKIP LOCKED). */
export const queue = pgTable(
  'queue',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'done' | 'failed'>(),
    runAt: ts('run_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    lockedAt: ts('locked_at'),
    doneAt: ts('done_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('queue_dedupe_idx').on(t.dedupeKey), index('queue_pick_idx').on(t.status, t.runAt)],
)

/** One agent invocation (a trace). */
export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent: text('agent').notNull(),
  trigger: text('trigger').notNull(),
  subject: text('subject'),
  status: text('status').notNull().default('running').$type<'running' | 'done' | 'failed' | 'waiting_approval'>(),
  outcome: text('outcome'),
  model: text('model'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  latencyMs: integer('latency_ms'),
  startedAt: createdAt(),
  endedAt: ts('ended_at'),
})

export const agentSteps = pgTable(
  'agent_steps',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id),
    kind: text('kind').notNull().$type<'llm' | 'tool' | 'policy' | 'note' | 'error'>(),
    name: text('name').notNull(),
    input: jsonb('input').$type<JsonObject | null>(),
    output: jsonb('output').$type<JsonObject | null>(),
    ms: integer('ms'),
    createdAt: createdAt(),
  },
  (t) => [index('agent_steps_run_idx').on(t.runId)],
)

export const approvals = pgTable('approvals', {
  id: serial('id').primaryKey(),
  runId: uuid('run_id').references(() => agentRuns.id),
  agent: text('agent').notNull(),
  tool: text('tool').notNull(),
  args: jsonb('args').$type<JsonObject>().notNull(),
  summary: text('summary').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('pending').$type<'pending' | 'approved' | 'rejected'>(),
  result: jsonb('result').$type<JsonObject | null>(),
  decidedAt: ts('decided_at'),
  createdAt: createdAt(),
})

export const priceItems = pgTable('price_items', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  trade: text('trade').notNull(),
  cents: integer('cents').notNull(),
  minutes: integer('minutes').notNull().default(60),
})

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
})
