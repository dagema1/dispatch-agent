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
  return { owner: a.isOwner(), demoPassword: a.usingDemoPassword() }
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
    setWeatherOverride(data.mode === 'cold_snap' ? { tempC: -14, minC: -20, maxC: -8 } : data.mode === 'heat_wave' ? { tempC: 36, minC: 22, maxC: 38 } : null)
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
    await (await import('./server/db/seed')).seed({ quiet: true })
    return { ok: true }
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

export const startVoice = createServerFn({ method: 'POST' }).handler(async () => {
  await boot()
  return (await import('./server/api/customer')).voiceSession()
})

export const voiceToolCall = createServerFn({ method: 'POST' })
  .validator(z.object({ callId: z.number().int(), name: z.string(), args: z.record(z.string(), z.unknown()) }))
  .handler(async ({ data }) => JSON.parse(JSON.stringify(await (await import('./server/api/customer')).voiceTool(data.callId, data.name, data.args))))

export const endVoice = createServerFn({ method: 'POST' })
  .validator(z.object({ callId: z.number().int(), transcript: z.array(z.object({ role: z.enum(['caller', 'agent']), text: z.string() })).max(400) }))
  .handler(async ({ data }) => (await import('./server/api/customer')).endCall(data.callId, data.transcript))
