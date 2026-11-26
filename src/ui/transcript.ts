/**
 * Lines that are the model's own notes rather than speech: markdown bullets, numbered steps,
 * bold headings ("4. **Formulate Response**:"). Some calls have them because the voice model spoke
 * its plan aloud. The transcript keeps everything; the view marks these as internal notes.
 */
const NOTE = /^\s*(?:[*\-•]\s+|\d+\.\s+\*\*|\*\*[^*]+\*\*:?)/

export type Segment = { kind: 'speech' | 'note'; text: string }

/** Split an agent turn into what it said to the caller and the notes it voiced by mistake. */
export function splitAgentText(text: string): Segment[] {
  const out: Segment[] = []
  const push = (kind: Segment['kind'], line: string) => {
    const last = out.at(-1)
    if (last && last.kind === kind) last.text += `\n${line}`
    else out.push({ kind, text: line })
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    if (!NOTE.test(line)) {
      push('speech', line.trim())
      continue
    }
    // a note can run straight into the next spoken sentence: "...(Riley, warm).It's always best"
    const glued = line.match(/^(.*?[.)])([A-Z][^]*)$/)
    if (glued && /[.?!]$/.test(glued[2].trim())) {
      push('note', clean(glued[1]))
      push('speech', glued[2].trim())
    } else push('note', clean(line))
  }
  return out.map((s) => ({ ...s, text: s.text.trim() }))
}

const clean = (l: string) =>
  l
    .replace(/^\s*(?:[*\-•]\s+)/, '• ')
    .replace(/\*\*/g, '')
    .trim()
