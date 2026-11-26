/** The signed-out world: black with electric-blue curtain light falling from the top edge. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[820px] opacity-35 dark:opacity-100">
      <div className="absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_0%,oklch(0.5_0.25_270/0.5),transparent_70%)]" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_38px,oklch(0.6_0.22_272/0.07)_38px_40px)] [mask-image:radial-gradient(55%_65%_at_50%_0%,black,transparent_75%)]" />
    </div>
  )
}
