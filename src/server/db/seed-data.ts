/** Fictional demo company: Northline Heating & Plumbing, Denver CO. All people and addresses are made up. */
import type { Skill } from './schema'

export const COMPANY = {
  name: 'Northline Heating & Plumbing',
  city: 'Denver, CO',
  phone: '(720) 555-0142',
  hq: { lat: 39.7392, lng: -104.9903 },
}

export const TECHS: Array<{
  name: string
  skills: Skill[]
  level: 'senior' | 'standard'
  color: string
  home: { lat: number; lng: number }
}> = [
  { name: 'Carlos Medina', skills: ['hvac_repair', 'hvac_install'], level: 'senior', color: '#2563eb', home: { lat: 39.676, lng: -105.03 } },
  { name: 'Priya Shah', skills: ['hvac_repair', 'water_heater'], level: 'standard', color: '#16a34a', home: { lat: 39.79, lng: -104.95 } },
  { name: 'Jake Thompson', skills: ['plumbing', 'drain', 'water_heater'], level: 'senior', color: '#d97706', home: { lat: 39.735, lng: -105.08 } },
  { name: 'Aisha Bello', skills: ['plumbing', 'drain'], level: 'standard', color: '#9333ea', home: { lat: 39.705, lng: -104.9 } },
  { name: 'Tom Nguyen', skills: ['hvac_repair', 'plumbing', 'water_heater'], level: 'standard', color: '#dc2626', home: { lat: 39.76, lng: -105.0 } },
]

export const PRICE_BOOK: Array<{ code: string; name: string; trade: string; cents: number; minutes: number }> = [
  { code: 'DIAG', name: 'Diagnostic visit', trade: 'any', cents: 8900, minutes: 45 },
  { code: 'EMERG', name: 'After-hours / emergency surcharge', trade: 'any', cents: 12500, minutes: 0 },
  { code: 'IGN', name: 'Furnace igniter replacement', trade: 'hvac', cents: 29500, minutes: 60 },
  { code: 'FLAME', name: 'Flame sensor clean / replace', trade: 'hvac', cents: 18500, minutes: 45 },
  { code: 'BLWR', name: 'Blower motor replacement', trade: 'hvac', cents: 78000, minutes: 120 },
  { code: 'CAP', name: 'AC capacitor replacement', trade: 'hvac', cents: 24500, minutes: 45 },
  { code: 'CONT', name: 'AC contactor replacement', trade: 'hvac', cents: 26500, minutes: 45 },
  { code: 'REFR', name: 'Refrigerant recharge (per lb)', trade: 'hvac', cents: 13500, minutes: 30 },
  { code: 'TUNE', name: 'Seasonal tune-up', trade: 'hvac', cents: 14900, minutes: 60 },
  { code: 'FURN-80', name: 'New 80% gas furnace, installed', trade: 'hvac', cents: 520000, minutes: 360 },
  { code: 'FURN-96', name: 'New 96% high-efficiency furnace, installed', trade: 'hvac', cents: 740000, minutes: 420 },
  { code: 'HP', name: 'Heat pump system, installed', trade: 'hvac', cents: 1290000, minutes: 480 },
  { code: 'AC-14', name: 'New 14 SEER AC, installed', trade: 'hvac', cents: 610000, minutes: 360 },
  { code: 'WH-ELEM', name: 'Water heater element / thermostat', trade: 'plumbing', cents: 24500, minutes: 60 },
  { code: 'WH-GASV', name: 'Water heater gas valve', trade: 'plumbing', cents: 42500, minutes: 75 },
  { code: 'WH-50', name: 'New 50-gal water heater, installed', trade: 'plumbing', cents: 215000, minutes: 180 },
  { code: 'WH-TL', name: 'Tankless water heater, installed', trade: 'plumbing', cents: 480000, minutes: 300 },
  { code: 'DRAIN', name: 'Drain clearing (snake)', trade: 'plumbing', cents: 22500, minutes: 60 },
  { code: 'JET', name: 'Hydro-jetting main line', trade: 'plumbing', cents: 59500, minutes: 120 },
  { code: 'PIPE', name: 'Burst pipe repair (per section)', trade: 'plumbing', cents: 38500, minutes: 90 },
  { code: 'FAUCET', name: 'Faucet repair / replace', trade: 'plumbing', cents: 19500, minutes: 60 },
  { code: 'PLAN', name: 'Comfort Club maintenance plan (1 yr)', trade: 'any', cents: 19900, minutes: 0 },
]

const STREETS = [
  'Larkspur Ave', 'Juniper St', 'Cedar Ridge Dr', 'Aspen Ct', 'Ponderosa Way', 'Bluebell Ln', 'Granite St', 'Willow Bend',
  'Columbine Pl', 'Pinecrest Rd', 'Elk Run', 'Sagebrush Dr', 'Foothill Ave', 'Riverbend St', 'Maple Hollow', 'Prairie Sky Dr',
]
const FIRST = ['Maria', 'James', 'Linda', 'Robert', 'Grace', 'Daniel', 'Olivia', 'Samuel', 'Hannah', 'Marcus', 'Elena', 'Victor', 'Nora', 'Owen', 'Ruth', 'Felix', 'Iris', 'Leo', 'Mia', 'Hugo']
const LAST = ['Alvarez', 'Bennett', 'Chen', 'Dawson', 'Ellis', 'Foster', 'Garcia', 'Hughes', 'Ibrahim', 'Jensen', 'Kowalski', 'Lopez', 'Moreau', 'Novak', 'Okafor', 'Park', 'Quinn', 'Rossi', 'Sato', 'Turner']
const BRANDS = ['Carrier', 'Lennox', 'Trane', 'Goodman', 'Rheem', 'Bryant', 'York', 'A.O. Smith']

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type SeedCustomer = {
  name: string
  email: string
  phone: string
  address: string
  lat: number
  lng: number
  zone: string
  homeYear: number
  hasPlan: boolean
  equipment: Array<{ kind: string; brand: string; installYear: number }>
}

export function makeCustomers(n: number, seed = 7): SeedCustomer[] {
  const r = rng(seed)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const out: SeedCustomer[] = []
  for (let i = 0; i < n; i++) {
    const first = FIRST[i % FIRST.length]
    const last = LAST[(i * 7) % LAST.length]
    const lat = COMPANY.hq.lat + (r() - 0.5) * 0.24
    const lng = COMPANY.hq.lng + (r() - 0.5) * 0.3
    const zone = `${lat > COMPANY.hq.lat ? 'North' : 'South'}-${lng > COMPANY.hq.lng ? 'East' : 'West'}`
    const homeYear = 1955 + Math.floor(r() * 65)
    const equipment = [
      { kind: 'furnace', brand: pick(BRANDS), installYear: Math.max(homeYear, 2026 - 4 - Math.floor(r() * 22)) },
      { kind: 'ac', brand: pick(BRANDS), installYear: Math.max(homeYear, 2026 - 2 - Math.floor(r() * 18)) },
      { kind: 'water_heater', brand: pick(BRANDS), installYear: Math.max(homeYear, 2026 - 1 - Math.floor(r() * 15)) },
    ]
    out.push({
      name: `${first} ${last}`,
      email: `${first}.${last}`.toLowerCase() + '@example.com',
      phone: `(720) 555-${String(1000 + i).padStart(4, '0')}`,
      address: `${100 + Math.floor(r() * 9800)} ${pick(STREETS)}, Denver, CO`,
      lat,
      lng,
      zone,
      homeYear,
      hasPlan: r() < 0.3,
      equipment,
    })
  }
  return out
}

/** Routine work already on the books (so the board is not empty). */
export const ROUTINE_JOBS: Array<{ title: string; skill: Skill; minutes: number; cents: number; priority: 2 | 3 | 4 }> = [
  { title: 'Seasonal furnace tune-up', skill: 'hvac_repair', minutes: 60, cents: 14900, priority: 4 },
  { title: 'Kitchen drain slow', skill: 'drain', minutes: 60, cents: 22500, priority: 3 },
  { title: 'Water heater making noise', skill: 'water_heater', minutes: 75, cents: 24500, priority: 3 },
  { title: 'Leaky bathroom faucet', skill: 'plumbing', minutes: 60, cents: 19500, priority: 4 },
  { title: 'Thermostat not responding', skill: 'hvac_repair', minutes: 45, cents: 18500, priority: 3 },
  { title: 'Heat pump quote visit', skill: 'hvac_install', minutes: 90, cents: 1290000 / 10, priority: 4 },
  { title: 'Furnace short-cycling', skill: 'hvac_repair', minutes: 75, cents: 29500, priority: 3 },
  { title: 'Main line backup', skill: 'drain', minutes: 120, cents: 59500, priority: 2 },
]
