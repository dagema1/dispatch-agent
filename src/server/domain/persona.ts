import type { Persona } from './settings'

const first = (n: string) => n.trim().split(/\s+/)[0] ?? ''

/** The opening of a customer message, per the persona's address style and tone. */
export function salutation(name: string | null | undefined, p: Persona) {
  const n = name?.trim()
  if (!n || p.address === 'neutral') return p.tone === 'formal' ? 'Hello,' : 'Hi there,'
  const who = p.address === 'full' ? n : first(n)
  return p.tone === 'formal' ? `${p.address === 'full' ? 'Dear' : 'Hello'} ${who},` : `Hi ${who},`
}

/**
 * Applies the persona to a templated customer message: swaps the stock "Hi <first name>," opening
 * for the configured salutation and appends the sign-off. Safe to call twice.
 */
export function personalize(body: string, name: string | null | undefined, p: Persona) {
  let out = body
  const f = name ? first(name) : ''
  if (f && out.startsWith(`Hi ${f},`)) out = `${salutation(name, p)}${out.slice(`Hi ${f},`.length)}`
  const sign = p.signOff.trim()
  if (sign && !out.trimEnd().endsWith(sign)) out = `${out.trimEnd()}\n\n${sign}`
  return out
}

export const TONE_GUIDE: Record<Persona['tone'], string> = {
  warm: 'Warm, calm and reassuring, like a friendly neighbour who knows the trade. Short sentences.',
  brief: 'Efficient and to the point. No small talk; confirm facts and move on.',
  formal: 'Polite and professional. Full sentences, no slang, no jokes.',
}

export const ADDRESS_GUIDE: Record<Persona['address'], string> = {
  first: 'Address the caller by first name once you know it.',
  full: 'Address the caller by their full name once you know it.',
  neutral: 'Do not use the caller’s name; keep the address neutral.',
}

/** Persona block prepended to customer-facing model prompts. */
export function personaPrompt(p: Persona, company: string) {
  return [
    `Your name is ${p.agentName || 'the receptionist'}; you answer for ${company}. Introduce yourself by that name.`,
    `Tone: ${TONE_GUIDE[p.tone]}`,
    ADDRESS_GUIDE[p.address],
    p.greeting.trim() ? `Open the call with this line, then continue naturally: "${p.greeting.trim()}"` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
