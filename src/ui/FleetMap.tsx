import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { useEffect } from 'react'

export type MapJob = {
  id: number
  lat: number
  lng: number
  color: string
  label: string
  priority: number
  seq?: number | null
}
export type MapTech = {
  id: number
  name: string
  color: string
  lat: number
  lng: number
  live: boolean
}

const techIcon = (color: string, initials: string, live: boolean) =>
  L.divIcon({
    className: '',
    html: `<div style="background:${color};color:#fff;width:30px;height:30px;border-radius:9999px;display:grid;place-items:center;font:600 11px Inter,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)${live ? ';outline:3px solid rgba(16,185,129,.45)' : ''}">${initials}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })

function Fit({ points }: { points: Array<[number, number]> }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit only when the set of points changes
  useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 13 })
  }, [key])
  return null
}

export default function FleetMap({
  techs,
  jobs,
  routes,
  height = 360,
}: {
  techs: MapTech[]
  jobs: MapJob[]
  routes: Array<{ color: string; points: Array<[number, number]> }>
  height?: number
}) {
  const pts: Array<[number, number]> = [...techs.map((t) => [t.lat, t.lng] as [number, number]), ...jobs.map((j) => [j.lat, j.lng] as [number, number])]
  return (
    <MapContainer center={[39.74, -104.99]} zoom={11} style={{ height, width: '100%', borderRadius: 12 }} scrollWheelZoom={false}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit points={pts} />
      {routes.map((r, i) => (
        <Polyline
          key={i}
          positions={r.points}
          pathOptions={{
            color: r.color,
            weight: 3,
            opacity: 0.7,
            dashArray: '6 6',
          }}
        />
      ))}
      {jobs.map((j) => (
        <CircleMarker
          key={j.id}
          center={[j.lat, j.lng]}
          radius={j.priority === 1 ? 9 : 7}
          pathOptions={{
            color: j.priority === 1 ? '#dc2626' : '#fff',
            weight: j.priority === 1 ? 3 : 2,
            fillColor: j.color,
            fillOpacity: 0.95,
          }}
        >
          <Tooltip>{j.label}</Tooltip>
        </CircleMarker>
      ))}
      {techs.map((t) => (
        <Marker
          key={t.id}
          position={[t.lat, t.lng]}
          icon={techIcon(
            t.color,
            t.name
              .split(' ')
              .map((s) => s[0])
              .join(''),
            t.live,
          )}
        >
          <Tooltip>
            {t.name}
            {t.live ? ' · live location' : ''}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  )
}
