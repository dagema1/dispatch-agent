import { describe, expect, it } from 'vitest'
import { splitAgentText } from '../src/ui/transcript'

describe('splitAgentText', () => {
  it('marks the notes the voice model spoke aloud and keeps the speech', () => {
    const said = `It's usually best to be careful. To get started, may I have your full name?
    *   No vulnerable occupants mentioned.
    *   Next step: Ask for the name to start the collection process.

4.  **Formulate Response**:
    *   Acknowledge the caution.
    *   Maintain the persona (Riley, warm and reassuring).It's always best to be careful. To get started with scheduling, may I please have your full name?`
    const parts = splitAgentText(said)
    expect(parts.map((p) => p.kind)).toEqual(['speech', 'note', 'speech'])
    expect(parts[0].text).toContain('may I have your full name?')
    expect(parts[1].text).toContain('Next step: Ask for the name')
    expect(parts[1].text).toContain('Formulate Response:')
    expect(parts[1].text).not.toContain('**')
    expect(parts[2].text).toBe("It's always best to be careful. To get started with scheduling, may I please have your full name?")
  })

  it('leaves normal speech alone', () => {
    expect(splitAgentText('Thank you, John. And what is the address?')).toEqual([{ kind: 'speech', text: 'Thank you, John. And what is the address?' }])
  })
})
