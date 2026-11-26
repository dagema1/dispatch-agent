import { RouteMotif } from './RouteMotif'

/** The signed-out world: black with electric-blue light from the top edge and a dispatcher's route drawn in it. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[820px] opacity-35 dark:opacity-100">
      <div className="absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_0%,oklch(0.5_0.25_270/0.5),transparent_70%)]" />
      <RouteMotif className="absolute inset-x-0 top-0 h-[340px] w-full" />
    </div>
  )
}
