import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { ArrowRight, Eye, EyeOff, Wrench } from 'lucide-react'
import { useState } from 'react'
import { getSession, login } from '#/fns'
import { Backdrop } from '#/ui/Backdrop'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const s = await getSession()
    if (s.owner) throw redirect({ to: '/app' })
    return { demoPassword: s.demoPassword }
  },
  component: SignIn,
  head: () => ({ meta: [{ title: 'Sign in · Northline' }] }),
})

/** Owner sign-in. Customers never come here: they book at /book or follow links we send them. */
function SignIn() {
  const { demoPassword } = Route.useRouteContext()
  const router = useRouter()
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await login({ data: { password: pw } })
      if (r.ok) await router.navigate({ to: '/app' })
      else setError('That password is not right.')
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dark relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <Backdrop />
      <main className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="tile tile-solid size-11 rounded-full">
            <Wrench className="size-5" />
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">
            Welcome <span className="font-display text-[1.15em] text-primary">back</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to the Northline front office.</p>
        </div>

        <form onSubmit={submit} className="slab space-y-4 rounded-3xl border p-6">
          <div className="space-y-1.5">
            <Label htmlFor="pw">Owner password</Label>
            <div className="relative">
              <Input
                id="pw"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus
                required
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'pw-error' : demoPassword ? 'pw-hint' : undefined}
                className="h-11 rounded-full pr-11 pl-4"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {error ? (
              <p id="pw-error" role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : (
              demoPassword && (
                <p id="pw-hint" className="text-xs text-muted-foreground">
                  Demo install: the password is <span className="font-mono text-foreground">demo</span>. Set OWNER_PASSWORD in .env to change it.
                </p>
              )
            )}
          </div>
          <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={busy || !pw}>
            {busy ? 'Signing in…' : 'Sign in'} {!busy && <ArrowRight />}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Need a repair?{' '}
          <Link to="/book" className="font-medium text-foreground underline-offset-4 hover:underline">
            Book a visit
          </Link>
        </p>
      </main>
    </div>
  )
}
