import { describe, expect, it } from 'vitest'
import { type BoardRow, boardFits, packBoard } from '../src/server/agent/board-widget'

describe('office live board widget', () => {
  it('fits Telegram’s widget HTML limits', () => {
    expect(boardFits()).toBe(true)
  })

  it('keeps chat_data within 1024 bytes, shortening titles before dropping technicians', () => {
    const rows: BoardRow[] = Array.from({ length: 12 }, (_, i) => [i + 1, `Technician${i}`, '2f5bd3', 2, 5, 'o', '10:30a', `#${100 + i} Furnace short-cycling and making a loud banging noise`])
    const s = packBoard({ d: 'Fri, Nov 27', at: '2:15p', u: 3, a: 1 }, rows)
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(1024)
    const d = JSON.parse(s)
    expect(d.u).toBe(3)
    expect(d.t.length).toBeGreaterThan(6)
  })

  it('keeps full titles when they fit', () => {
    const rows: BoardRow[] = [[1, 'Ana', '2f5bd3', 1, 3, 's', '1p', '#7 Basement leak']]
    expect(JSON.parse(packBoard({ d: 'Fri', at: '2p', u: 0, a: 0 }, rows)).t[0][7]).toBe('#7 Basement leak')
  })
})
