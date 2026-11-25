import Stripe from 'stripe'
import { env } from '../lib/env'

/** Stripe in TEST mode only: Checkout Sessions as payment links; status polled by the watchdog (no public webhook needed). */
const g = globalThis as unknown as { __stripe?: Stripe }
export const stripeEnabled = () => !!env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
function client() {
  if (!stripeEnabled()) throw new Error('Stripe test key not configured')
  return (g.__stripe ??= new Stripe(env.STRIPE_SECRET_KEY!))
}

export async function createPaymentLink(opts: { invoiceId: number; customerEmail?: string | null; lines: Array<{ name: string; cents: number; qty: number }> }) {
  const session = await client().checkout.sessions.create({
    mode: 'payment',
    customer_email: opts.customerEmail ?? undefined,
    line_items: opts.lines.map((l) => ({ quantity: l.qty, price_data: { currency: 'usd', unit_amount: l.cents, product_data: { name: l.name } } })),
    metadata: { invoiceId: String(opts.invoiceId) },
    success_url: `${env.APP_URL}/c/paid?invoice=${opts.invoiceId}`,
    cancel_url: `${env.APP_URL}/c/paid?invoice=${opts.invoiceId}&cancelled=1`,
    expires_at: Math.floor(Date.now() / 1000) + 23 * 3600,
  })
  return { sessionId: session.id, url: session.url! }
}

export async function isPaid(sessionId: string): Promise<boolean> {
  const s = await client().checkout.sessions.retrieve(sessionId)
  return s.payment_status === 'paid'
}
