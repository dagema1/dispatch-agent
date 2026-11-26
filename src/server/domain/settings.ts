import { db, schema } from '../db'

export type Policy = 'auto' | 'approve' | 'never'

export const DEFAULT_SETTINGS = {
  company: { name: 'Northline Heating & Plumbing', phone: '(720) 555-0142', serviceRadiusKm: 35, hq: { lat: 39.7392, lng: -104.9903 } },
  /** What the agents may do on their own. */
  policies: {
    send_customer_message: 'auto',
    book_job: 'auto',
    replan_day: 'auto',
    move_booked_job: 'approve',
    after_hours_dispatch: 'approve',
    send_quote: 'auto',
    send_invoice: 'auto',
    send_payment_reminder: 'auto',
    send_campaign: 'approve',
    apply_discount: 'approve',
    refund: 'never',
    price_outside_book: 'never',
  } as Record<string, Policy>,
  thresholds: {
    /** Below this model confidence the decision goes to the approval queue. */
    minConfidence: 0.7,
    freezeC: -6,
    heatC: 33,
    slaP1Minutes: 5,
    slaOtherMinutes: 30,
    replacementAgeYears: 15,
    paymentReminderDays: [1, 3, 7],
  },
  hours: { open: '08:00', close: '17:00' },
} as const

export type Settings = {
  company: (typeof DEFAULT_SETTINGS)['company']
  policies: Record<string, Policy>
  thresholds: (typeof DEFAULT_SETTINGS)['thresholds']
  hours: { open: string; close: string }
}

let cache: { at: number; value: Settings } | undefined

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 5000) return cache.value
  const rows = await db.select().from(schema.settings)
  const merged = structuredClone(DEFAULT_SETTINGS) as unknown as Settings
  for (const r of rows) {
    const k = r.key as keyof Settings
    if (k in merged) (merged as Record<string, unknown>)[k] = { ...(merged[k] as object), ...(r.value as object) }
  }
  cache = { at: Date.now(), value: merged }
  return merged
}

export async function saveSetting(key: keyof Settings, value: unknown) {
  await db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } })
  cache = undefined
}
