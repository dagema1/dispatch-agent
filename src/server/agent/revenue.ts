import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db'
import { firstName, messageCustomer } from '../domain/messaging'
import { getSettings } from '../domain/settings'
import { aiEnabled, generateJson, type Media } from '../integrations/gemini'
import { createPaymentLink, isPaid, stripeEnabled } from '../integrations/stripe'
import { publish } from '../lib/bus'
import { enqueue, registerHandler } from '../lib/queue'
import { act, registerExecutor } from './policy'
import { Run } from './trace'

/**
 * Revenue agent: job-to-cash.
 * Technician voice note → structured job report → invoice priced from the price book
 * → Stripe payment link → reminders until paid → maintenance-plan offer.
 */
const ReportSchema = z.object({
  workDone: z.string().describe('what the technician did, customer-friendly, 1-3 sentences'),
  partCodes: z.array(z.object({ code: z.string(), qty: z.number().int().min(1) })).describe('only codes from the price book'),
  followUp: z.string().nullable().describe('recommended next step for the customer, if any'),
  customerDeclinedSomething: z.string().nullable(),
  safetyIssueFound: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

export async function completeJobFromVoiceNote(jobId: number, audio: Media | null, transcriptHint?: string) {
  const run = await Run.start('revenue', 'tech_voice_note', `job #${jobId}`)
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId))
  if (!job) throw new Error('job not found')
  const prices = await db.select().from(schema.priceItems)
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.jobId, jobId))

  let report: z.infer<typeof ReportSchema>
  if (aiEnabled() && (audio || transcriptHint)) {
    report = await generateJson({
      run,
      name: 'report.from_voice',
      system: `You turn a field technician's voice note into a job report and invoice lines. Use ONLY these price-book codes:
${prices.map((p) => `${p.code}: ${p.name}`).join('\n')}
Always include DIAG. Never invent prices.`,
      prompt: `Job: ${job.title}.${quote ? ` Quoted options: ${JSON.stringify(quote.options.map((o) => ({ tier: o.tier, codes: o.lines.map((l) => l.code) })))}` : ''}${transcriptHint ? `\nTechnician note: """${transcriptHint}"""` : ''}`,
      schema: ReportSchema,
      media: audio ? [audio] : undefined,
    })
  } else {
    report = { workDone: transcriptHint ?? `Completed: ${job.title}.`, partCodes: [{ code: 'DIAG', qty: 1 }], followUp: null, customerDeclinedSomething: null, safetyIssueFound: null, confidence: 0.5 }
  }

  const byCode = new Map(prices.map((p) => [p.code, p]))
  const lines = report.partCodes.filter((p) => byCode.has(p.code)).map((p) => ({ code: p.code, name: byCode.get(p.code)!.name, qty: p.qty, cents: byCode.get(p.code)!.cents }))
  if (!lines.some((l) => l.code === 'DIAG')) lines.unshift({ code: 'DIAG', name: byCode.get('DIAG')!.name, qty: 1, cents: byCode.get('DIAG')!.cents })
  if (job.priority === 1) lines.push({ code: 'EMERG', name: byCode.get('EMERG')!.name, qty: 1, cents: byCode.get('EMERG')!.cents })
  const total = lines.reduce((a, l) => a + l.cents * l.qty, 0)
  await run.step('tool', 'invoice.price', { codes: report.partCodes }, { lines, total })

  await db.update(schema.jobs).set({ status: 'done', completedAt: new Date(), report }).where(eq(schema.jobs.id, jobId))
  const [inv] = await db.insert(schema.invoices).values({ jobId, customerId: job.customerId, lines, totalCents: total }).returning()
  await publish('job.completed', { jobId, invoiceId: inv.id, totalCents: total })

  const out = await act(run, {
    policy: 'send_invoice',
    tool: 'send_invoice',
    args: { invoiceId: inv.id },
    summary: `Send invoice #${inv.id} ($${(total / 100).toFixed(2)}) for job #${jobId}`,
    confidence: report.confidence,
  })
  await run.end(out.status === 'done' ? 'done' : 'waiting_approval', `invoice #${inv.id} $${(total / 100).toFixed(2)} → ${out.status}`)
  return { invoiceId: inv.id, totalCents: total, report, status: out.status }
}

async function sendInvoice(invoiceId: number) {
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId))
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, inv.customerId))
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, inv.jobId))
  const settings = await getSettings()
  let payUrl = inv.payUrl
  if (!payUrl && stripeEnabled()) {
    const link = await createPaymentLink({ invoiceId, customerEmail: c.email, lines: inv.lines })
    payUrl = link.url
    await db.update(schema.invoices).set({ stripeSessionId: link.sessionId, payUrl }).where(eq(schema.invoices.id, invoiceId))
  }
  const report = (job.report ?? {}) as { workDone?: string; followUp?: string | null }
  const body = [
    `Hi ${firstName(c.name)}, thanks for choosing ${settings.company.name}.`,
    report.workDone ? `Today's visit: ${report.workDone}` : '',
    `Invoice #${invoiceId}:\n${inv.lines.map((l) => `• ${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}: $${((l.cents * l.qty) / 100).toFixed(2)}`).join('\n')}\nTotal: $${(inv.totalCents / 100).toFixed(2)}`,
    payUrl ? `Pay securely online: ${payUrl}` : 'Our office will send payment details shortly.',
    report.followUp ? `Technician's recommendation: ${report.followUp}` : '',
    !c.hasPlan ? `Tip: our Comfort Club plan ($199/yr) includes two tune-ups, priority scheduling and no emergency surcharge. Reply "JOIN" to add it.` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  await messageCustomer({ customerId: c.id, jobId: job.id, subject: `Invoice #${invoiceId} from ${settings.company.name}`, body })
  await db.update(schema.invoices).set({ status: 'sent', sentAt: new Date() }).where(eq(schema.invoices.id, invoiceId))
  for (const d of settings.thresholds.paymentReminderDays) {
    await enqueue('invoice.reminder', { invoiceId, day: d }, { runAt: new Date(Date.now() + d * 86_400_000), dedupeKey: `remind:${invoiceId}:${d}` })
  }
  await publish('invoice.sent', { invoiceId, totalCents: inv.totalCents, payUrl })
  return { payUrl }
}
registerExecutor('send_invoice', async (a) => sendInvoice(Number(a.invoiceId)))

registerHandler('invoice.reminder', async (p) => {
  const id = Number(p.invoiceId)
  if (await checkPaid(id)) return
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id))
  if (inv.status !== 'sent') return
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, inv.customerId))
  await act(null, {
    policy: 'send_payment_reminder',
    tool: 'send_customer_message',
    args: { customerId: c.id, jobId: inv.jobId, subject: `Reminder: invoice #${id}`, body: `Hi ${firstName(c.name)}, a friendly reminder that invoice #${id} ($${(inv.totalCents / 100).toFixed(2)}) is still open.${inv.payUrl ? ` You can pay here: ${inv.payUrl}` : ''} Thank you!` },
    summary: `Payment reminder for invoice #${id}`,
  })
  await db.update(schema.invoices).set({ remindersSent: inv.remindersSent + 1 }).where(eq(schema.invoices.id, id))
})

export async function checkPaid(invoiceId: number): Promise<boolean> {
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId))
  if (!inv) return false
  if (inv.status === 'paid') return true
  if (!inv.stripeSessionId || !stripeEnabled()) return false
  if (await isPaid(inv.stripeSessionId)) {
    await db.update(schema.invoices).set({ status: 'paid', paidAt: new Date() }).where(eq(schema.invoices.id, invoiceId))
    await publish('invoice.paid', { invoiceId, totalCents: inv.totalCents })
    return true
  }
  return false
}

/** Watchdog sweep: refresh payment status of open invoices. */
export async function sweepPayments() {
  const open = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(and(inArray(schema.invoices.status, ['sent']), isNotNull(schema.invoices.stripeSessionId)))
  for (const i of open) await checkPaid(i.id).catch(() => {})
}
