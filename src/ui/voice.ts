import { GoogleGenAI, type LiveServerMessage, Modality, type Session } from '@google/genai'
import { endVoice, startVoice, voiceToolCall } from '#/fns'

/**
 * Browser voice receptionist. The server mints a single-use ephemeral token (our API key never
 * reaches the browser); audio streams directly between the browser and Gemini Live. Tool calls
 * (book_service) come back to our server, which runs the same front-desk pipeline as email/web.
 */
export type Turn = { role: 'caller' | 'agent'; text: string }
export type VoiceState = 'idle' | 'connecting' | 'live' | 'ending' | 'error'

const WORKLET = `
class Mic extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.len = 0 }
  process(inputs) {
    const ch = inputs[0][0]
    if (ch) { this.buf.push(new Float32Array(ch)); this.len += ch.length }
    if (this.len >= 1600) { // 100 ms at 16 kHz
      const out = new Int16Array(this.len); let o = 0
      for (const b of this.buf) for (let i = 0; i < b.length; i++) { const s = Math.max(-1, Math.min(1, b[i])); out[o++] = s < 0 ? s * 0x8000 : s * 0x7fff }
      this.port.postMessage(out.buffer, [out.buffer]); this.buf = []; this.len = 0
    }
    return true
  }
}
registerProcessor('mic', Mic)`

const b64 = (buf: ArrayBuffer) => {
  let s = ''
  const u = new Uint8Array(buf)
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export class VoiceCall {
  private session: Session | null = null
  private micCtx: AudioContext | null = null
  private outCtx: AudioContext | null = null
  private stream: MediaStream | null = null
  private playAt = 0
  private sources = new Set<AudioBufferSourceNode>()
  private callId = 0
  private transcript: Turn[] = []
  private closed = false
  /** Taps on the caller's mic and the receptionist's voice, for the on-screen waveform. */
  micAnalyser: AnalyserNode | null = null
  outAnalyser: AnalyserNode | null = null

  constructor(
    private on: {
      state: (s: VoiceState, detail?: string) => void
      transcript: (t: Turn[]) => void
      level: (speaking: 'caller' | 'agent' | null) => void
      booked: (r: Record<string, unknown>) => void
    },
  ) {}

  async start() {
    this.on.state('connecting')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      const cfg = await startVoice()
      this.callId = cfg.callId
      const ai = new GoogleGenAI({
        apiKey: cfg.token,
        httpOptions: { apiVersion: 'v1alpha' },
      })
      this.outCtx = new AudioContext({ sampleRate: 24000 })
      this.outAnalyser = this.outCtx.createAnalyser()
      this.outAnalyser.fftSize = 512
      this.outAnalyser.connect(this.outCtx.destination)
      this.session = await ai.live.connect({
        model: cfg.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: cfg.system,
          tools: [{ functionDeclarations: cfg.tools as never }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
          },
        },
        callbacks: {
          onopen: () => {},
          onmessage: (m) => this.onMessage(m),
          onerror: (e) => this.fail((e as ErrorEvent).message || 'connection error'),
          onclose: (e) => {
            if (!this.closed) this.fail(e.reason || 'call ended by server')
          },
        },
      })
      await this.startMic()
      this.on.state('live')
      // let the agent greet first
      this.session.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [
              {
                text: '(The caller has just connected. Greet them briefly and ask how you can help.)',
              },
            ],
          },
        ],
        turnComplete: true,
      })
    } catch (e) {
      this.fail((e as Error).message)
    }
  }

  private async startMic() {
    this.micCtx = new AudioContext({ sampleRate: 16000 })
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await this.micCtx.audioWorklet.addModule(url)
    const src = this.micCtx.createMediaStreamSource(this.stream!)
    const node = new AudioWorkletNode(this.micCtx, 'mic')
    node.port.onmessage = (e) => {
      if (!this.session || this.closed) return
      this.session.sendRealtimeInput({
        audio: {
          data: b64(e.data as ArrayBuffer),
          mimeType: 'audio/pcm;rate=16000',
        },
      })
    }
    src.connect(node)
    this.micAnalyser = this.micCtx.createAnalyser()
    this.micAnalyser.fftSize = 512
    src.connect(this.micAnalyser)
  }

  private add(role: Turn['role'], text: string) {
    const last = this.transcript[this.transcript.length - 1]
    if (last && last.role === role) last.text += text
    else this.transcript.push({ role, text: text.trimStart() })
    this.on.transcript([...this.transcript])
  }

  private async onMessage(m: LiveServerMessage) {
    const sc = m.serverContent
    if (sc?.interrupted) {
      for (const s of this.sources) s.stop()
      this.sources.clear()
      this.playAt = 0
    }
    if (sc?.inputTranscription?.text) {
      this.add('caller', sc.inputTranscription.text)
      this.on.level('caller')
    }
    if (sc?.outputTranscription?.text) this.add('agent', sc.outputTranscription.text)
    for (const p of sc?.modelTurn?.parts ?? []) if (p.inlineData?.data) this.play(p.inlineData.data)
    if (m.toolCall?.functionCalls?.length) {
      const responses = []
      for (const c of m.toolCall.functionCalls) {
        const output = await voiceToolCall({
          data: {
            callId: this.callId,
            name: c.name ?? '',
            args: (c.args ?? {}) as Record<string, unknown>,
          },
        }).catch((e) => ({ error: (e as Error).message }))
        if (c.name === 'book_service') this.on.booked(output as Record<string, unknown>)
        responses.push({ id: c.id, name: c.name, response: { output } })
      }
      this.session?.sendToolResponse({ functionResponses: responses })
    }
  }

  private play(data: string) {
    const ctx = this.outCtx!
    const bytes = fromB64(data)
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
    const buf = ctx.createBuffer(1, pcm.length, 24000)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.outAnalyser ?? ctx.destination)
    const at = Math.max(ctx.currentTime + 0.03, this.playAt)
    src.start(at)
    this.playAt = at + buf.duration
    this.sources.add(src)
    this.on.level('agent')
    src.onended = () => {
      this.sources.delete(src)
      if (!this.sources.size) this.on.level(null)
    }
  }

  private fail(msg: string) {
    this.on.state('error', msg)
    this.cleanup()
  }

  async hangUp() {
    this.on.state('ending')
    await this.cleanup()
    this.on.state('idle')
  }

  private async cleanup() {
    if (this.closed) return
    this.closed = true
    try {
      this.session?.close()
    } catch {}
    for (const t of this.stream?.getTracks() ?? []) t.stop()
    await this.micCtx?.close().catch(() => {})
    await this.outCtx?.close().catch(() => {})
    if (this.callId)
      await endVoice({
        data: {
          callId: this.callId,
          transcript: this.transcript.filter((t) => t.text.trim()),
        },
      }).catch(() => {})
  }
}
