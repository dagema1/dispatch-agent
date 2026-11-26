import { describe, expect, it } from 'vitest'
import { logLine } from '../src/server/agent/office-log'

const job = { id: 12, title: 'Furnace <noisy>', technicianId: 3 } as Parameters<typeof logLine>[1] extends Map<number, infer J> ? J : never
const jobs = new Map([[12, job]])
const techs = new Map([[3, 'Ana Ortiz']])
const line = (type: string, payload: Record<string, unknown>) => logLine({ type, payload }, jobs, techs)

describe('office group log', () => {
  it('names the visit and escapes HTML', () => {
    expect(line('job.cancelled', { jobId: 12 })).toBe('🚫 <b>#12</b> Furnace &lt;noisy&gt; cancelled')
  })

  it('logs assignments and moves with the technician', () => {
    expect(line('job.planned', { jobId: 12, tech: 'Ana Ortiz', from: null, to: '2026-11-27T16:00:00Z' })).toMatch(/^🗓 <b>#12<\/b> .* → Ana Ortiz, /)
    expect(line('job.planned', { jobId: 12, tech: 'Ana Ortiz', from: '2026-11-27T15:00:00Z', to: '2026-11-27T16:00:00Z' })).toMatch(/^🔁 .*\(was /)
    expect(line('job.planned', { jobId: 12, tech: 'Ana Ortiz', from: '2026-11-27T15:00:00Z', to: null })).toMatch(/has no slot now \(was Ana Ortiz\)/)
  })

  it('logs technician actions under the assigned technician', () => {
    expect(line('job.status', { jobId: 12, status: 'on_site' })).toBe('📍 Ana Ortiz on site at <b>#12</b> Furnace &lt;noisy&gt;')
    expect(line('tech.late', { technicianId: 3, minutes: 20, jobId: 12 })).toMatch(/^⏱ Ana Ortiz running 20 min late at/)
  })

  it('logs what a technician was sent as plain text', () => {
    expect(line('message.tech', { name: 'Ana Ortiz', delivered: true, preview: '🆕 <b>P1 added to your route</b>\n#12 Leak' })).toBe('📨 To Ana Ortiz: 🆕 P1 added to your route #12 Leak')
  })

  it('ignores events it does not log', () => {
    expect(line('tech.location', { technicianId: 3 })).toBeNull()
  })
})
