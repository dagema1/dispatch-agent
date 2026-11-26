import { describe, expect, it } from 'vitest'
import { personalize, salutation } from '../src/server/domain/persona'
import type { Persona } from '../src/server/domain/settings'

const base: Persona = { agentName: 'Riley', voice: 'Aoede', tone: 'warm', address: 'first', greeting: '', signOff: '' }

describe('persona', () => {
  it('builds salutations from tone and address style', () => {
    expect(salutation('Linda Okafor', base)).toBe('Hi Linda,')
    expect(salutation('Linda Okafor', { ...base, address: 'full', tone: 'formal' })).toBe('Dear Linda Okafor,')
    expect(salutation('Linda Okafor', { ...base, address: 'neutral' })).toBe('Hi there,')
    expect(salutation(null, { ...base, tone: 'formal' })).toBe('Hello,')
  })

  it('rewrites the stock opening and appends the sign-off once', () => {
    const p = { ...base, address: 'full' as const, signOff: 'Riley at Northline' }
    const once = personalize("Hi Linda, you're booked.", 'Linda Okafor', p)
    expect(once).toBe("Hi Linda Okafor, you're booked.\n\nRiley at Northline")
    expect(personalize(once, 'Linda Okafor', p)).toBe(once)
  })

  it('leaves messages without the stock opening alone', () => {
    expect(personalize('Thanks for reaching out.', 'Linda Okafor', base)).toBe('Thanks for reaching out.')
  })
})
