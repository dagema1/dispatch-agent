import { createFileRoute } from '@tanstack/react-router'
import { Camera, CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { getPhotos, sendPhotos } from '#/fns'
import { CustomerShell, NotFound } from '#/ui/CustomerShell'
import { fileToMedia } from '#/ui/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const Route = createFileRoute('/c/photos/$token')({
  loader: ({ params }) => getPhotos({ data: { token: params.token } }),
  component: Photos,
  head: () => ({ meta: [{ title: 'Send photos' }] }),
})

function Photos() {
  const d = Route.useLoaderData()
  const { token } = Route.useParams()
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!d) return <NotFound />
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await sendPhotos({
        data: {
          token,
          photos: await Promise.all(files.slice(0, 4).map(fileToMedia)),
        },
      })
      window.location.href = r.quoteUrl
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <CustomerShell company={d.company}>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">Send us a few photos</h1>
      <p className="mt-1 text-sm text-pretty text-muted-foreground">
        A photo of the unit's label (model and serial) and any error light helps us bring the right parts and price your options upfront.
      </p>
      <blockquote className="mt-3 rounded-2xl border border-(--edge) bg-(--glass) px-4 py-3 text-sm">
        <span className="block text-xs text-muted-foreground">You told us</span>“{d.request.words}
        {d.request.words.length >= 160 ? '…' : ''}”
      </blockquote>
      <Card className="mt-4">
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground transition-colors hover:bg-foreground/5">
            <Camera className="size-6" /> {files.length ? `${files.length} photo(s) selected` : 'Tap to take or choose photos'}
            <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </label>
          {err && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
          <Button size="lg" className="h-11 w-full text-base" disabled={!files.length || busy} onClick={submit}>
            {busy ? 'Reading your photos…' : 'Send photos'}
          </Button>
        </CardContent>
      </Card>
    </CustomerShell>
  )
}
