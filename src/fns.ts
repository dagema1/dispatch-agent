import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { JsonObject } from './server/db/schema'

/**
 * Typed RPC between the UI and the server. Server modules are imported lazily inside each
 * handler so nothing server-only (pg, API keys) can leak into the client bundle.
 */
const boot = async () => (await import('./server/bootstrap')).ensureBooted()
const media = z.object({ mimeType: z.string().regex(/^image\//), data: z.string().max(8_000_000) })

// ---------- owner sign-in ----------

/** Every owner-dashboard function runs behind this: no valid session cookie, no data. */
const owner = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  ;(await import('./server/auth')).assertOwner()
  return next()
})

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const a = await import('./server/auth')
  const owner = a.isOwner()
  // only a signed-in owner learns whether setup is done
  const setupDone = owner ? (await (await import('./server/domain/settings')).getSettings()).setup.done : true
  return { owner, demoPassword: a.usingDemoPassword(), setupDone }
})

export const login = createServerFn({ method: 'POST' })
  .validator(z.object({ password: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const ok = (await import('./server/auth')).signIn(data.password)
    if (!ok) await new Promise((r) => setTimeout(r, 400))
    return { ok }
  })

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  ;(await import('./server/auth')).signOut()
  return { ok: true }
})

// ---------- owner dashboard ----------

export const getSnapshot = createServerFn({ method: 'GET' })
  .middleware([owner])
  .handler(async () => {
    await boot()
    return (await import('./server/api/views')).snapshot()
  })

export const getTrace = createServerFn({ method: 'GET' })
  .middleware([owner])
  .validator(z.object({ runId: z.string().uuid() }))
  .handler(async ({ data }) => (await import('./server/api/views')).trace(data.runId))

export const decide = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ id: z.number().int(), decision: z.enum(['approved', 'rejected']), edits: z.record(z.string(), z.unknown()).optional() }))
  .handler(async ({ data }) => {
    await boot()
    const r = await (await import('./server/agent/policy')).decideApproval(data.id, data.decision, data.edits)
    return JSON.parse(JSON.stringify(r ?? null))
  })

export const replanNow = createServerFn({ method: 'POST' })
  .middleware([owner])
  .handler(async () => {
    await boot()
    return (await import('./server/domain/dispatch')).replan({ reason: 'owner clicked re-plan' })
  })

export const runCronNow = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ name: z.enum(['tick', 'morning', 'weather']) }))
  .handler(async ({ data }) => JSON.parse(JSON.stringify(await (await import('./server/bootstrap')).runCron(data.name))))

export const setWeather = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ mode: z.enum(['cold_snap', 'heat_wave', 'off']) }))
  .handler(async ({ data }) => {
    const { setWeatherOverride } = await import('./server/integrations/weather')
    setWeatherOverride(data.mode === 'cold_snap' ? { tempC: -18, minC: -23, maxC: -12 } : data.mode === 'heat_wave' ? { tempC: 36, minC: 22, maxC: 38 } : null)
    return { ok: true }
  })

export const setPolicy = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ key: z.string(), value: z.enum(['auto', 'approve', 'never']) }))
  .handler(async ({ data }) => {
    const { getSettings, saveSetting } = await import('./server/domain/settings')
    const s = await getSettings()
    await saveSetting('policies', { ...s.policies, [data.key]: data.value })
    return { ok: true }
  })

export const setPersona = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(
    z.object({
      agentName: z.string().trim().min(1).max(40),
      voice: z.enum(['Aoede', 'Kore', 'Puck', 'Charon', 'Leda', 'Orus', 'Zephyr', 'Fenrir']),
      tone: z.enum(['warm', 'brief', 'formal']),
      address: z.enum(['first', 'full', 'neutral']),
      greeting: z.string().trim().max(200),
      signOff: z.string().trim().max(120),
    }),
  )
  .handler(async ({ data }) => {
    const { saveSetting } = await import('./server/domain/settings')
    await saveSetting('persona', data)
    return { ok: true }
  })

export const setAgentConfig = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(
    z.object({
      agent: z.enum(['front_desk', 'diagnosis', 'dispatch', 'revenue', 'ops']),
      supervised: z.boolean(),
      instructions: z.string().trim().max(1000),
    }),
  )
  .handler(async ({ data }) => {
    const { getSettings, saveSetting } = await import('./server/domain/settings')
    const s = await getSettings()
    await saveSetting('agents', { ...s.agents, [data.agent]: { supervised: data.supervised, instructions: data.instructions } })
    return { ok: true }
  })

export const setTechActive = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ id: z.number().int(), active: z.boolean() }))
  .handler(async ({ data }) => {
    const { db, schema } = await import('./server/db')
    const { eq, and } = await import('drizzle-orm')
    await db.update(schema.technicians).set({ active: data.active }).where(eq(schema.technicians.id, data.id))
    if (!data.active)
      await db
        .update(schema.jobs)
        .set({ technicianId: null, lockedTech: false })
        .where(and(eq(schema.jobs.technicianId, data.id), eq(schema.jobs.status, 'scheduled')))
    return (await import('./server/domain/dispatch')).replan({ reason: `technician ${data.active ? 'back' : 'out'}` })
  })

export const resetDemo = createServerFn({ method: 'POST' })
  .middleware([owner])
  .handler(async () => {
    await boot()
    await (await import('./server/db/seed')).seed({ quiet: true, quote: true })
    return { ok: true }
  })

export const getRequestStory = createServerFn({ method: 'GET' })
  .middleware([owner])
  .validator(z.object({ requestId: z.number().int() }))
  .handler(async ({ data }) => (await import('./server/api/story')).requestStory(data.requestId))

export const getConversation = createServerFn({ method: 'GET' })
  .middleware([owner])
  .validator(z.object({ customerId: z.number().int().optional(), technicianId: z.number().int().optional() }))
  .handler(async ({ data }) => (await import('./server/api/story')).conversation(data))

/* ---------- Needs you: the owner resolving things by hand ---------- */

export const resolveRequest = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ requestId: z.number().int(), note: z.string().max(500).optional() }))
  .handler(async ({ data }) => (await import('./server/domain/attention')).resolveRequest(data.requestId, data.note))

export const fixAndBook = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(
    z.object({
      requestId: z.number().int(),
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40).optional(),
      email: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
      address: z.string().trim().min(5).max(300),
    }),
  )
  .handler(async ({ data }) => {
    const { requestId, ...details } = data
    return (await import('./server/agent/front-desk')).fixAndBook(requestId, details)
  })

export const cancelVisit = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ jobId: z.number().int() }))
  .handler(async ({ data }) => (await import('./server/domain/attention')).cancelVisit(data.jobId))

export const retryMessages = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ ids: z.array(z.number().int()).min(1).max(100) }))
  .handler(async ({ data }) => {
    const { retryMessage } = await import('./server/domain/messaging')
    let delivered = 0
    for (const id of data.ids) if ((await retryMessage(id)).delivered) delivered++
    return { delivered, total: data.ids.length }
  })

export const markMessagesHandled = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ ids: z.array(z.number().int()).min(1).max(100) }))
  .handler(async ({ data }) => (await import('./server/domain/messaging')).markToldManually(data.ids))

/** The owner writes to a customer directly; goes out like any agent message (persona, channel, test inbox). */
export const sendCustomerMessage = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(
    z.object({
      customerId: z.number().int(),
      requestId: z.number().int().optional(),
      jobId: z.number().int().optional(),
      subject: z.string().max(200),
      body: z.string().min(2).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    await boot()
    return (await import('./server/domain/messaging')).messageCustomer(data)
  })

/** Demo: add one sample photo quote without touching anything else. */
export const addDemoQuote = createServerFn({ method: 'POST' })
  .middleware([owner])
  .handler(async () => {
    await boot()
    const { quote } = await (await import('./server/db/demo-quote')).seedDemoQuote()
    return { id: quote.id }
  })

/** Demo inbox: drop a customer email into the pipeline exactly as the Gmail poller would. */
export const simulateEmail = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ name: z.string(), email: z.string().email(), subject: z.string(), body: z.string().min(3).max(4000) }))
  .handler(async ({ data }) => {
    await boot()
    const { handleInbound } = await import('./server/agent/front-desk')
    const { db, schema } = await import('./server/db')
    const res = await handleInbound({
      channel: 'email',
      text: `${data.subject}\n\n${data.body}`,
      externalId: `demo:${Date.now()}`,
      customer: { name: data.name, email: data.email },
    })
    await db
      .insert(schema.messages)
      .values({ direction: 'in', channel: 'email', customerId: res.customerId || null, requestId: res.requestId, subject: data.subject, body: data.body, delivered: true })
    return res
  })

export const ownerChat = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ history: z.array(z.any()).max(60), message: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => {
    await boot()
    const res = await (await import('./server/agent/owner')).ownerChat(data.history, data.message)
    return JSON.parse(JSON.stringify(res)) as { text: string; history: JsonObject[]; used: string[]; runId?: string }
  })

export const completeJob = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ jobId: z.number().int(), note: z.string().min(3).max(2000) }))
  .handler(async ({ data }) => {
    await boot()
    const res = await (await import('./server/agent/revenue')).completeJobFromVoiceNote(data.jobId, null, data.note)
    await (await import('./server/domain/dispatch')).replan({ reason: `job #${data.jobId} completed` })
    return JSON.parse(JSON.stringify(res))
  })

export const markPaidTest = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ invoiceId: z.number().int() }))
  .handler(async ({ data }) => ({ paid: await (await import('./server/agent/revenue')).checkPaid(data.invoiceId) }))

export const runSimulation = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ scenario: z.enum(['normal', 'cold_snap', 'heat_wave']), requests: z.number().int().min(10).max(300) }))
  .handler(async ({ data }) => {
    await boot()
    return (await import('./server/sim/simulator')).simulateDay(data)
  })

export const runEvals = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ useModel: z.boolean() }))
  .handler(async ({ data }) => {
    await boot()
    return (await import('./server/sim/evals')).runEvals(data)
  })

// ---------- customer pages ----------

export const bookOnline = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(2).max(100),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().max(30).optional(),
      address: z.string().min(5).max(200),
      issue: z.string().min(5).max(3000),
      photos: z.array(media).max(4).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await boot()
    const r = await (await import('./server/api/customer')).webBooking({ ...data, email: data.email || undefined })
    return { status: r.status, priority: r.priority, safety: r.safety, booking: r.booking ?? null, replyText: r.replyText }
  })

export const getTrack = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string().max(80) }))
  .handler(async ({ data }) => (await import('./server/api/views')).trackView(data.token))

export const getQuote = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string().max(80) }))
  .handler(async ({ data }) => (await import('./server/api/views')).quoteView(data.token))

export const chooseQuote = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().max(80), tier: z.enum(['good', 'better', 'best']) }))
  .handler(async ({ data }) => (await import('./server/api/customer')).acceptQuote(data.token, data.tier))

export const getPhotos = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string().max(80) }))
  .handler(async ({ data }) => (await import('./server/api/views')).photosView(data.token))

export const sendPhotos = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().max(80), photos: z.array(media).min(1).max(4) }))
  .handler(async ({ data }) => {
    await boot()
    return JSON.parse(JSON.stringify(await (await import('./server/api/customer')).uploadPhotos(data.token, data.photos)))
  })

export const getPaid = createServerFn({ method: 'GET' })
  .validator(z.object({ invoice: z.number().int() }))
  .handler(async ({ data }) => (await import('./server/api/views')).paidView(data.invoice))

// ---------- voice ----------

export const startVoice = createServerFn({ method: 'POST' })
  .validator(z.object({ phone: z.string().trim().max(30).optional() }).optional())
  .handler(async ({ data }) => {
    await boot()
    return (await import('./server/api/customer')).voiceSession({ phone: data?.phone || undefined })
  })

export const voiceToolCall = createServerFn({ method: 'POST' })
  .validator(z.object({ callId: z.number().int(), name: z.string(), args: z.record(z.string(), z.unknown()) }))
  .handler(async ({ data }) => JSON.parse(JSON.stringify(await (await import('./server/api/customer')).voiceTool(data.callId, data.name, data.args))))

export const endVoice = createServerFn({ method: 'POST' })
  .validator(z.object({ callId: z.number().int(), transcript: z.array(z.object({ role: z.enum(['caller', 'agent']), text: z.string() })).max(400) }))
  .handler(async ({ data }) => (await import('./server/api/customer')).endCall(data.callId, data.transcript))

// ---------- setup & company ----------

const company = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(120).or(z.literal('')),
  address: z.string().trim().min(5).max(200),
  serviceRadiusKm: z.number().int().min(5).max(200),
})
const hours = z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) })
const keyPatch = z
  .object({
    GEMINI_API_KEY: z.string().max(200),
    TELEGRAM_BOT_TOKEN: z.string().max(200),
    TELEGRAM_OWNER_CHAT_ID: z.string().max(40),
    ORS_API_KEY: z.string().max(400),
    // payments stay in Stripe test mode: live keys are refused here
    STRIPE_SECRET_KEY: z
      .string()
      .max(300)
      .refine((v) => v === '' || v.startsWith('sk_test_'), 'Use a Stripe test key (sk_test_…)'),
    GOOGLE_CLIENT_ID: z.string().max(300),
    GOOGLE_CLIENT_SECRET: z.string().max(300),
  })
  .partial()

export const getSetup = createServerFn({ method: 'GET' })
  .middleware([owner])
  .handler(async () => {
    await boot()
    const { getSettings } = await import('./server/domain/settings')
    const { keyStatus } = await import('./server/lib/keys')
    const { integrations } = await import('./server/lib/env')
    const st = await getSettings()
    return { company: st.company, hours: st.hours, setup: st.setup, sandbox: st.sandbox, keys: await keyStatus(), integrations: integrations() }
  })

/** Save the company profile; the address is geocoded so the service area and HQ follow it. */
async function storeCompany(c: z.infer<typeof company>) {
  const { getSettings, saveSetting } = await import('./server/domain/settings')
  const prev = (await getSettings()).company
  let hq = prev.hq
  if (c.address !== prev.address) {
    const loc = await (await import('./server/integrations/routing')).geocode(c.address).catch(() => null)
    if (loc) hq = { lat: loc.lat, lng: loc.lng }
  }
  await saveSetting('company', { ...c, hq })
  return hq !== prev.hq || c.address === prev.address
}

export const saveCompany = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ company, hours }))
  .handler(async ({ data }) => {
    const located = await storeCompany(data.company)
    await (await import('./server/domain/settings')).saveSetting('hours', data.hours)
    return { ok: true, located }
  })

export const saveApiKeys = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(keyPatch)
  .handler(async ({ data }) => {
    await (await import('./server/lib/keys')).saveKeys(data)
    return { ok: true }
  })

/** Finish first-run setup: load demo or empty data, then company, hours and keys. */
export const completeSetup = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ mode: z.enum(['demo', 'own']), loadData: z.boolean(), sampleQuote: z.boolean().default(false), company, hours, keys: keyPatch.optional() }))
  .handler(async ({ data }) => {
    await boot()
    // seeding clears settings, so it runs first
    if (data.loadData) await (await import('./server/db/seed')).seed({ quiet: true, empty: data.mode === 'own', quote: data.sampleQuote })
    else if (data.sampleQuote) await (await import('./server/db/demo-quote')).seedDemoQuote()
    const { saveSetting } = await import('./server/domain/settings')
    await storeCompany(data.company)
    await saveSetting('hours', data.hours)
    await (await import('./server/lib/keys')).saveKeys(data.keys ?? {}, { demo: data.mode === 'demo' })
    await saveSetting('setup', { done: true, mode: data.mode })
    return { ok: true }
  })

export const setSandbox = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ testInbox: z.boolean() }))
  .handler(async ({ data }) => {
    await (await import('./server/domain/settings')).saveSetting('sandbox', data)
    return { ok: true }
  })

export const setOfficeLog = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ telegram: z.boolean() }))
  .handler(async ({ data }) => {
    await (await import('./server/domain/settings')).saveSetting('officeLog', data)
    return { ok: true }
  })

// ---------- price book ----------

export const getPriceBook = createServerFn({ method: 'GET' })
  .middleware([owner])
  .handler(async () => {
    const { db, schema } = await import('./server/db')
    return db.select().from(schema.priceItems).orderBy(schema.priceItems.trade, schema.priceItems.cents)
  })

export const savePriceItem = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(
    z.object({
      originalCode: z.string().max(20).optional(),
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9-]{2,20}$/, 'Code: 2–20 letters, digits or dashes'),
      name: z.string().trim().min(2).max(120),
      trade: z.enum(['hvac', 'plumbing', 'any']),
      cents: z.number().int().min(0).max(10_000_000),
      minutes: z.number().int().min(0).max(1440),
    }),
  )
  .handler(async ({ data }) => {
    const { db, schema } = await import('./server/db')
    const { eq } = await import('drizzle-orm')
    const { originalCode, ...item } = data
    if (originalCode && originalCode !== item.code) {
      const [clash] = await db.select().from(schema.priceItems).where(eq(schema.priceItems.code, item.code))
      if (clash) throw new Error(`Code ${item.code} is already used`)
      await db.update(schema.priceItems).set(item).where(eq(schema.priceItems.code, originalCode))
    } else await db.insert(schema.priceItems).values(item).onConflictDoUpdate({ target: schema.priceItems.code, set: item })
    return { ok: true }
  })

export const deletePriceItem = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ code: z.string().max(20) }))
  .handler(async ({ data }) => {
    const { db, schema } = await import('./server/db')
    const { eq } = await import('drizzle-orm')
    if (data.code === 'DIAG' || data.code === 'EMERG') throw new Error('Every invoice relies on this item. Change its price instead of deleting it.')
    await db.delete(schema.priceItems).where(eq(schema.priceItems.code, data.code))
    return { ok: true }
  })

// ---------- simulators ----------

export const getField = createServerFn({ method: 'GET' })
  .middleware([owner])
  .handler(async () => {
    await boot()
    return (await import('./server/sim/field')).fieldView()
  })

export const fieldAct = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(
    z.object({
      techId: z.number().int(),
      act: z.discriminatedUnion('action', [
        z.object({ action: z.literal('accept'), jobId: z.number().int() }),
        z.object({ action: z.literal('take'), jobId: z.number().int() }),
        z.object({ action: z.literal('omw'), jobId: z.number().int() }),
        z.object({ action: z.literal('arrive'), jobId: z.number().int() }),
        z.object({ action: z.literal('late'), minutes: z.number().int().min(5).max(120) }),
        z.object({ action: z.literal('note'), jobId: z.number().int(), text: z.string().trim().min(2).max(1000) }),
        z.object({ action: z.literal('done'), jobId: z.number().int(), text: z.string().trim().min(3).max(2000) }),
        z.object({ action: z.literal('drive'), jobId: z.number().int().optional() }),
        z.object({ action: z.literal('locate'), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
        z.object({ action: z.literal('duty'), active: z.boolean() }),
      ]),
    }),
  )
  .handler(async ({ data }) => {
    await boot()
    return (await import('./server/sim/field')).fieldAction(data.techId, data.act)
  })

export const getTestThreads = createServerFn({ method: 'GET' })
  .middleware([owner])
  .handler(async () => (await import('./server/sim/inbox')).inboxThreads())

export const getTestThread = createServerFn({ method: 'GET' })
  .middleware([owner])
  .validator(z.object({ customerId: z.number().int() }))
  .handler(async ({ data }) => (await import('./server/sim/inbox')).inboxThread(data.customerId))

export const sendAsCustomer = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(
    z.object({
      customerId: z.number().int().optional(),
      newCustomer: z.object({ name: z.string().trim().min(2).max(100), email: z.string().email().optional(), phone: z.string().max(30).optional() }).optional(),
      channel: z.enum(['email', 'sms']),
      subject: z.string().max(200).optional(),
      body: z.string().trim().min(1).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    await boot()
    return (await import('./server/sim/inbox')).customerSends(data)
  })

export const startVoicePreview = createServerFn({ method: 'POST' })
  .middleware([owner])
  .validator(z.object({ voice: z.enum(['Aoede', 'Kore', 'Puck', 'Charon', 'Leda', 'Orus', 'Zephyr', 'Fenrir']), line: z.string().trim().min(2).max(240) }))
  .handler(async ({ data }) => (await import('./server/api/customer')).voicePreview(data.voice, data.line))
