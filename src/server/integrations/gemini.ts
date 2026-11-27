import { type Content, type FunctionDeclaration, GoogleGenAI, type Part } from '@google/genai'
import { z } from 'zod'
import type { Run } from '../agent/trace'
import { getSettings } from '../domain/settings'
import { env } from '../lib/env'

/** The owner's extra guidance for this agent (Agent team page), appended to its system prompt. */
export async function withNotes(system: string, agent: string | undefined) {
  if (!agent) return system
  const notes = (await getSettings()).agents[agent]?.instructions?.trim()
  return notes ? `${system}\n\nAdditional instructions from the owner (follow them unless they conflict with safety rules):\n${notes}` : system
}

/**
 * Thin, defensive wrapper around Gemini:
 * - a client-side rate limiter sized for the free tier
 * - JSON-schema constrained output validated with zod (one repair retry)
 * - a bounded function-calling loop for agents
 * - every call recorded on the agent trace with latency and token counts
 * Callers check `aiEnabled()` and fall back to rules when the key is missing or the call fails.
 */
const g = globalThis as unknown as { __genai?: { raw: string; clients: GoogleGenAI[] } }
/** GEMINI_API_KEY may hold several comma-separated keys; each one is its own client. */
export const geminiKeys = () =>
  (env.GEMINI_API_KEY ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
function clients(): GoogleGenAI[] {
  const raw = env.GEMINI_API_KEY ?? ''
  if (g.__genai?.raw !== raw) g.__genai = { raw, clients: geminiKeys().map((apiKey) => new GoogleGenAI({ apiKey, httpOptions: { timeout: 10_000 } })) }
  if (!g.__genai.clients.length) throw new Error('GEMINI_API_KEY not set')
  return g.__genai.clients
}
const client = () => clients()[0]!
export const aiEnabled = () => !!env.GEMINI_API_KEY
export const MODEL = () => env.GEMINI_MODEL

// --- rate limiting (free tier: keep well under the per-minute cap) ---
// free-tier quota is per Google Cloud project, so keys from separate projects each add their own share
const RPM = Number(process.env.GEMINI_RPM ?? 12)
let nextSlot = 0
async function slot() {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + Math.ceil(60_000 / (RPM * Math.max(1, geminiKeys().length)))
  if (at > now) await new Promise((r) => setTimeout(r, at - now))
}

/** Models tried in order when one is overloaded or slow (free tier sees frequent 503s on the newest model). */
const FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash']
const modelChain = () => [...new Set([MODEL(), ...(process.env.GEMINI_FALLBACK_MODELS?.split(',').map((x) => x.trim()) ?? FALLBACKS)])]
const g2 = globalThis as unknown as { __geminiDown?: Map<string, number> }
g2.__geminiDown ??= new Map()
const down = g2.__geminiDown

/**
 * Call fn with the first healthy model. A key out of quota (429) is parked for 10 minutes for that
 * model and the next key is tried; an overloaded model (503, timeout) is skipped for 2 minutes.
 */
async function withRetry<T>(fn: (model: string, ai: GoogleGenAI) => Promise<T>): Promise<T & { _model?: string }> {
  let last: unknown
  const ais = clients()
  const chain = modelChain()
  const now = Date.now()
  const ok = (k: string) => (down.get(k) ?? 0) < now
  const healthy = chain.filter((m) => ok(m) && ais.some((_, i) => ok(`${i}:${m}`)))
  for (const model of healthy.length ? healthy : chain) {
    const keys = ais.map((_, i) => i).filter((i) => ok(`${i}:${model}`))
    nextKey: for (const i of keys.length ? keys : ais.map((_, i) => i)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await slot()
          const out = (await fn(model, ais[i]!)) as T & { _model?: string }
          if (out && typeof out === 'object') out._model = model
          return out
        } catch (e) {
          last = e
          const msg = String((e as Error).message ?? e)
          if (/429|RESOURCE_EXHAUSTED/i.test(msg)) {
            down.set(`${i}:${model}`, Date.now() + 600_000)
            continue nextKey // same model, next key
          }
          // overloaded, slow or missing: waiting rarely helps, the next model usually answers at once
          if (/503|UNAVAILABLE|overloaded|high demand|timed? ?out|aborted|404|NOT_FOUND/i.test(msg)) {
            down.set(model, Date.now() + 120_000)
            break nextKey
          }
          if (!/500|fetch failed/i.test(msg)) throw e
          await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
        }
      }
    }
  }
  throw last
}

export type Media = { mimeType: string; data: string /* base64 */ }

export async function generateJson<T>(opts: {
  run?: Run | null
  name: string
  system: string
  prompt: string
  schema: z.ZodType<T>
  media?: Media[]
  temperature?: number
}): Promise<T> {
  const system = await withNotes(opts.system, opts.run?.agent)
  const jsonSchema = z.toJSONSchema(opts.schema, { target: 'draft-7' })
  const parts: Part[] = [...(opts.media ?? []).map((m) => ({ inlineData: m })), { text: opts.prompt }]
  const contents: Content[] = [{ role: 'user', parts }]
  const call = async () => {
    const t0 = Date.now()
    const res = await withRetry((model, ai) =>
      ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema,
          temperature: opts.temperature ?? 0.2,
        },
      }),
    )
    const usage = res.usageMetadata
    await opts.run?.tokens(res._model ?? MODEL(), usage?.promptTokenCount ?? 0, usage?.candidatesTokenCount ?? 0)
    return { text: res.text ?? '', ms: Date.now() - t0 }
  }
  let out = await call()
  let parsed = safeParse(opts.schema, out.text)
  if (!parsed.ok) {
    contents.push({ role: 'model', parts: [{ text: out.text }] }, { role: 'user', parts: [{ text: `Your JSON was invalid: ${parsed.error}. Return corrected JSON only.` }] })
    out = await call()
    parsed = safeParse(opts.schema, out.text)
  }
  await opts.run?.step('llm', opts.name, { prompt: opts.prompt.slice(0, 2000), media: opts.media?.length ?? 0 }, parsed.ok ? parsed.value : { error: parsed.error }, out.ms)
  if (!parsed.ok) throw new Error(`model returned invalid JSON: ${parsed.error}`)
  return parsed.value
}

function safeParse<T>(schema: z.ZodType<T>, text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    const r = schema.safeParse(JSON.parse(text))
    return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.message.slice(0, 500) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function generateText(opts: { run?: Run | null; name: string; system: string; prompt: string; media?: Media[] }): Promise<string> {
  const system = await withNotes(opts.system, opts.run?.agent)
  const t0 = Date.now()
  const res = await withRetry((model, ai) =>
    ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [...(opts.media ?? []).map((m) => ({ inlineData: m })), { text: opts.prompt }] }],
      config: { systemInstruction: system, temperature: 0.4 },
    }),
  )
  await opts.run?.tokens(res._model ?? MODEL(), res.usageMetadata?.promptTokenCount ?? 0, res.usageMetadata?.candidatesTokenCount ?? 0)
  const text = res.text ?? ''
  await opts.run?.step('llm', opts.name, { prompt: opts.prompt.slice(0, 2000) }, { text }, Date.now() - t0)
  return text
}

// --- tool-using agent loop ---
export type Tool = {
  name: string
  description: string
  params: z.ZodObject
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

export function toDeclarations(tools: Tool[]): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: z.toJSONSchema(t.params, { target: 'draft-7' }),
  }))
}

export async function runTools(opts: { run: Run; system: string; history: Content[]; tools: Tool[]; maxSteps?: number }): Promise<{ text: string; history: Content[] }> {
  const history = [...opts.history]
  const system = await withNotes(opts.system, opts.run.agent)
  const byName = new Map(opts.tools.map((t) => [t.name, t]))
  for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
    const t0 = Date.now()
    const res = await withRetry((model, ai) =>
      ai.models.generateContent({
        model,
        contents: history,
        config: { systemInstruction: system, tools: [{ functionDeclarations: toDeclarations(opts.tools) }], temperature: 0.2 },
      }),
    )
    await opts.run.tokens(res._model ?? MODEL(), res.usageMetadata?.promptTokenCount ?? 0, res.usageMetadata?.candidatesTokenCount ?? 0)
    const content = res.candidates?.[0]?.content
    if (content) history.push(content)
    const calls = res.functionCalls ?? []
    await opts.run.step('llm', `turn ${step + 1}`, null, { text: res.text ?? null, calls: calls.map((c) => ({ name: c.name, args: c.args })) }, Date.now() - t0)
    if (!calls.length) return { text: res.text ?? '', history }
    const responses: Part[] = []
    for (const c of calls) {
      const tool = byName.get(c.name ?? '')
      let output: unknown
      if (!tool) output = { error: `unknown tool ${c.name}` }
      else {
        const parsed = tool.params.safeParse(c.args ?? {})
        if (!parsed.success) output = { error: `invalid arguments: ${parsed.error.message.slice(0, 300)}` }
        else {
          try {
            output = await opts.run.timed('tool', tool.name, parsed.data, () => tool.handler(parsed.data as Record<string, unknown>))
          } catch (e) {
            output = { error: (e as Error).message }
          }
        }
      }
      responses.push({ functionResponse: { id: c.id, name: c.name, response: { output } } })
    }
    history.push({ role: 'user', parts: responses })
  }
  return { text: 'I stopped after too many steps. Please check the activity log.', history }
}

/** Live API: short-lived token so the browser can stream audio directly to Gemini without our key. */
export async function createLiveToken(): Promise<{ token: string; model: string }> {
  const model = await liveModel()
  const t = await client().authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
      httpOptions: { apiVersion: 'v1alpha' },
    },
  })
  if (!t.name) throw new Error('no token returned')
  return { token: t.name, model }
}

let cachedLive: string | undefined
/** Pick a Live (bidi) model this key can use: newest general-purpose live model, else native-audio flash. */
export async function liveModel(): Promise<string> {
  if (env.GEMINI_LIVE_MODEL) return env.GEMINI_LIVE_MODEL
  if (cachedLive) return cachedLive
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=500', {
    headers: { 'x-goog-api-key': geminiKeys()[0] ?? '' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`models.list ${res.status}`)
  const d = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> }
  const candidates = (d.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('bidiGenerateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /live|native-audio/.test(n) && !/transcribe|translate|robotics|thinking|genie/.test(n))
  candidates.sort((a, b) => score(b) - score(a))
  cachedLive = candidates[0] ?? 'gemini-2.5-flash-native-audio-latest'
  return cachedLive
}
const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0)
const score = (n: string) => version(n) * 10 + (n.includes('preview') ? 0 : 2)
