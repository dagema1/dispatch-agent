import { Building2, Clock, Mail, MapPin, Phone } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type CompanyValues = {
  company: { name: string; phone: string; email: string; address: string; serviceRadiusKm: number }
  hours: { open: string; close: string }
}

/** The company profile: what customers see in every message, where the trucks start, when the office is open. */
export function CompanyFields({ value, onChange }: { value: CompanyValues; onChange: (v: CompanyValues) => void }) {
  const c = value.company
  const setC = (k: keyof CompanyValues['company'], v: string | number) => onChange({ ...value, company: { ...c, [k]: v } })
  const setH = (k: 'open' | 'close', v: string) => onChange({ ...value, hours: { ...value.hours, [k]: v } })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="co-name" label="Company name" icon={Building2} className="sm:col-span-2">
        <Input id="co-name" required value={c.name} onChange={(e) => setC('name', e.target.value)} autoComplete="organization" />
      </Field>
      <Field id="co-phone" label="Office phone" icon={Phone} hint="Shown on every customer page and message.">
        <Input id="co-phone" required type="tel" value={c.phone} onChange={(e) => setC('phone', e.target.value)} autoComplete="tel" />
      </Field>
      <Field id="co-email" label="Office email" icon={Mail} hint="Optional. Where customers can write back.">
        <Input id="co-email" type="email" value={c.email} onChange={(e) => setC('email', e.target.value)} autoComplete="email" />
      </Field>
      <Field id="co-addr" label="Shop address" icon={MapPin} hint="Centre of your service area." className="sm:col-span-2">
        <Input id="co-addr" required value={c.address} onChange={(e) => setC('address', e.target.value)} autoComplete="street-address" />
      </Field>
      <Field id="co-radius" label="Service radius (km)" hint="Requests farther out get a polite referral.">
        <Input
          id="co-radius"
          type="number"
          inputMode="numeric"
          min={5}
          max={200}
          value={c.serviceRadiusKm}
          onChange={(e) => setC('serviceRadiusKm', Math.max(0, Math.round(Number(e.target.value) || 0)))}
        />
      </Field>
      <Field id="co-open" label="Office hours" icon={Clock} hint="Outside these, dispatch asks you first.">
        <div className="flex items-center gap-2">
          <Input id="co-open" type="time" aria-label="Opens" value={value.hours.open} onChange={(e) => setH('open', e.target.value)} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="time" aria-label="Closes" value={value.hours.close} onChange={(e) => setH('close', e.target.value)} />
        </div>
      </Field>
    </div>
  )
}

function Field({
  id,
  label,
  hint,
  icon: Icon,
  className,
  children,
}: {
  id: string
  label: string
  hint?: string
  icon?: React.ComponentType<{ className?: string }>
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        {label}
      </Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
