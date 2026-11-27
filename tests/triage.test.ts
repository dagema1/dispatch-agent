import { describe, expect, it } from 'vitest'
import { prioritise, ruleExtract } from '../src/server/domain/triage'

describe('leak priority', () => {
  const mild = { tempC: 10 }

  it('does not treat a dripping faucet as an emergency even if the model says leak', () => {
    const text = 'Kitchen faucet dripping constantly, would like someone this week'
    const t = prioritise({ ...ruleExtract(text), activeLeak: true, basePriority: 3 }, text, mild, true)
    expect(t.priority).toBe(3)
    expect(t.activeLeak).toBe(false)
  })

  it('still escalates water coming through the ceiling', () => {
    const text = 'Pipe dripping through the ceiling, water pooling on the floor'
    const t = prioritise({ ...ruleExtract(text), activeLeak: true, basePriority: 3 }, text, mild, true)
    expect(t.priority).toBe(1)
  })

  it('still escalates a burst pipe', () => {
    const text = 'Burst pipe in the basement, water everywhere'
    expect(prioritise(ruleExtract(text), text, mild).priority).toBe(1)
  })
})
