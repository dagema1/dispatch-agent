import { describe, expect, it } from 'vitest'
import { outsideHours } from '../src/server/agent/front-desk'

describe('opening hours', () => {
  const hours = { open: '08:00', close: '17:00' }
  it('treats evenings and early mornings as after hours (company time zone)', () => {
    // Denver is UTC-7 in late November
    expect(outsideHours(new Date('2026-11-27T04:40:00Z'), hours)).toBe(true) // 21:40
    expect(outsideHours(new Date('2026-11-27T14:30:00Z'), hours)).toBe(true) // 07:30
    expect(outsideHours(new Date('2026-11-27T16:00:00Z'), hours)).toBe(false) // 09:00
    expect(outsideHours(new Date('2026-11-28T00:00:00Z'), hours)).toBe(true) // 17:00 closes
  })
})
