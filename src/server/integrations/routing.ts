import { env } from '../lib/env'

export type LatLng = { lat: number; lng: number }

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Offline estimate: road distance ≈ 1.35 × straight line at ~42 km/h urban average, plus parking. */
export function estimateMinutes(a: LatLng, b: LatLng): number {
  const km = haversineKm(a, b)
  if (km < 0.05) return 0
  return Math.round((km * 1.35 * 60) / 42 + 4)
}

const key = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
const cache = new Map<string, number>()
let orsDisabledUntil = 0

/**
 * Drive-time matrix in minutes. Uses OpenRouteService when a key is configured (cached per pair),
 * otherwise (or on quota errors) falls back to the offline estimate so planning never blocks.
 */
export async function travelMatrix(points: LatLng[]): Promise<{ minutes: number[][]; source: 'ors' | 'estimate' }> {
  const n = points.length
  const minutes = points.map((a) => points.map((b) => estimateMinutes(a, b)))
  if (!env.ORS_API_KEY || n < 2 || Date.now() < orsDisabledUntil) return { minutes, source: 'estimate' }

  const missing = new Set<number>()
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const c = cache.get(`${key(points[i])}>${key(points[j])}`)
      if (c === undefined) missing.add(i)
      else minutes[i][j] = c
    }
  if (missing.size === 0) return { minutes, source: 'ors' }

  // ORS limit: 3,500 matrix elements per request -> chunk sources.
  const allLocs = points.map((p) => [p.lng, p.lat])
  const src = [...missing]
  const chunk = Math.max(1, Math.floor(3500 / n))
  try {
    for (let s = 0; s < src.length; s += chunk) {
      const sources = src.slice(s, s + chunk)
      const req = () =>
        fetch('https://api.heigit.org/openrouteservice/v2/matrix/driving-car', {
          method: 'POST',
          headers: { Authorization: env.ORS_API_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ locations: allLocs, sources, metrics: ['duration'] }),
          signal: AbortSignal.timeout(12_000),
        })
      const res = await req().catch(() => req()) // one retry: the hosted API is occasionally slow to accept
      if (!res.ok) throw new Error(`ORS matrix ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = (await res.json()) as { durations: (number | null)[][] }
      data.durations.forEach((row, r) => {
        const i = sources[r]
        row.forEach((sec, j) => {
          if (i === j || sec == null) return
          const m = Math.round(sec / 60) + 3
          minutes[i][j] = m
          cache.set(`${key(points[i])}>${key(points[j])}`, m)
        })
      })
    }
    return { minutes, source: 'ors' }
  } catch (e) {
    console.warn('[routing] falling back to estimates:', (e as Error).message)
    orsDisabledUntil = Date.now() + 5 * 60_000
    return { minutes, source: 'estimate' }
  }
}

/**
 * Geocode a US address. Nominatim (OSM) first, politely (1 req/s, identifying User-Agent), with one
 * retry when it is busy; the US Census geocoder as a fallback, which is strong on street addresses.
 * Only definite answers are cached, so a rate-limited moment never turns into a "bad address".
 */
const geoCache = new Map<string, LatLng | null>()
let lastGeo = 0
type Lookup = LatLng | null | 'error'

async function nominatim(address: string): Promise<Lookup> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastGeo + (attempt ? 2500 : 1100) - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastGeo = Date.now()
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(address)}`
      const res = await fetch(url, { headers: { 'User-Agent': 'dispatch-agent-demo/1.0 (portfolio project)' }, signal: AbortSignal.timeout(8000) })
      if (res.status === 429 || res.status >= 500) continue
      if (!res.ok) return 'error'
      const data = (await res.json()) as Array<{ lat: string; lon: string }>
      return data[0] ? { lat: Number(data[0].lat), lng: Number(data[0].lon) } : null
    } catch {
      // timeout or a non-JSON busy page: try once more
    }
  }
  return 'error'
}

async function census(address: string): Promise<Lookup> {
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return 'error'
    const data = (await res.json()) as { result?: { addressMatches?: Array<{ coordinates: { x: number; y: number } }> } }
    const m = data.result?.addressMatches?.[0]
    return m ? { lat: m.coordinates.y, lng: m.coordinates.x } : null
  } catch {
    return 'error'
  }
}

export async function geocode(address: string): Promise<LatLng | null> {
  const k = address.trim().toLowerCase()
  if (!k) return null
  if (geoCache.has(k)) return geoCache.get(k) ?? null
  const first = await nominatim(address)
  if (first && first !== 'error') {
    geoCache.set(k, first)
    return first
  }
  const second = await census(address)
  if (second && second !== 'error') {
    geoCache.set(k, second)
    return second
  }
  // both answered "no such address": remember it; otherwise a lookup failed and we may try again later
  if (first === null && second === null) geoCache.set(k, null)
  else console.warn('[geocode] lookup failed, not cached:', first, second)
  return null
}
