import { eq } from 'drizzle-orm'
import { diagnoseAndQuote } from '../agent/diagnosis'
import { db, schema } from './index'

const DESCRIPTION = 'Furnace clicks on but never lights, then shuts off. Photos of the rating label and the blinking status light attached.'

/**
 * A realistic photo quote for demos, built by the real quote pipeline from a fixed diagnosis (no AI
 * call): a 17-year-old Carrier furnace with error 33, so it lands as a replacement lead with
 * good / better / best options from the price book. Uses a customer with a furnace on file, or adds one.
 */
export async function seedDemoQuote() {
  const [onFile] = await db
    .select({ customer: schema.customers, brand: schema.equipment.brand })
    .from(schema.equipment)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.equipment.customerId))
    .where(eq(schema.equipment.kind, 'furnace'))
    .limit(1)
  const customer =
    onFile?.customer ??
    (
      await db
        .insert(schema.customers)
        .values({ name: 'Sam Rivera', email: 'sam.rivera@example.com', phone: '(720) 555-0142', address: '2150 S Clarkson St, Denver, CO 80210', lat: 39.677, lng: -104.979 })
        .returning()
    )[0]
  const [req] = await db
    .insert(schema.requests)
    .values({ channel: 'web', customerId: customer.id, rawText: DESCRIPTION, summary: 'Furnace will not light (photo quote)', priority: 3, trade: 'hvac', status: 'triaged' })
    .returning()
  const year = new Date().getFullYear() - 17
  return diagnoseAndQuote({
    requestId: req.id,
    customerId: customer.id,
    description: DESCRIPTION,
    photos: [],
    preset: {
      equipmentKind: 'furnace',
      brand: onFile?.brand ?? 'Carrier',
      model: '58STA090',
      serial: `${String(year).slice(2)}09A12345`,
      manufactureYear: year,
      errorCode: '33',
      observations: ['Status light blinking 3-3 (limit circuit)', 'Igniter shows a hairline crack', 'Light rust on the burner tray'],
      likelyFaults: [
        { fault: 'Failed hot-surface igniter', probability: 0.62, partCodes: ['IGN'] },
        { fault: 'Dirty flame sensor', probability: 0.24, partCodes: ['FLAME'] },
      ],
      confidence: 0.78,
    },
  })
}
