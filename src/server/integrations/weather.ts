import type { LatLng } from './routing'

/** Open-Meteo: free, no key. Cached per ~5 km cell for 20 minutes. */
export type Weather = {
  tempC: number
  feelsC: number
  code: number
  daily: Array<{ date: string; minC: number; maxC: number }>
}

const cache = new Map<string, { at: number; w: Weather }>()
let override: { tempC: number; minC: number; maxC: number } | null = null

/** Demo control: simulate a cold snap or heat wave without waiting for real weather. */
export function setWeatherOverride(v: typeof override) {
  override = v
  cache.clear()
}
export const getWeatherOverride = () => override

export async function getWeather(p: LatLng): Promise<Weather | null> {
  const k = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`
  const hit = cache.get(k)
  if (hit && Date.now() - hit.at < 20 * 60_000) return applyOverride(hit.w)
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lng}&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_min,temperature_2m_max&forecast_days=4&timezone=auto`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`open-meteo ${res.status}`)
    const d = (await res.json()) as {
      current: { temperature_2m: number; apparent_temperature: number; weather_code: number }
      daily: { time: string[]; temperature_2m_min: number[]; temperature_2m_max: number[] }
    }
    const w: Weather = {
      tempC: d.current.temperature_2m,
      feelsC: d.current.apparent_temperature,
      code: d.current.weather_code,
      daily: d.daily.time.map((date, i) => ({ date, minC: d.daily.temperature_2m_min[i], maxC: d.daily.temperature_2m_max[i] })),
    }
    cache.set(k, { at: Date.now(), w })
    return applyOverride(w)
  } catch (e) {
    console.warn('[weather]', (e as Error).message)
    return override ? applyOverride({ tempC: 0, feelsC: 0, code: 0, daily: [] }) : null
  }
}

function applyOverride(w: Weather): Weather {
  if (!override) return w
  return {
    ...w,
    tempC: override.tempC,
    feelsC: override.tempC - 3,
    daily: (w.daily.length ? w.daily : [0, 1, 2].map((i) => ({ date: `+${i}`, minC: 0, maxC: 0 }))).map((d) => ({ ...d, minC: override!.minC, maxC: override!.maxC })),
  }
}

export const cToF = (c: number) => Math.round((c * 9) / 5 + 32)
