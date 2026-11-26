import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { THEME_BOOT } from '#/ui/theme'
import { TooltipProvider } from '@/components/ui/tooltip'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Northline · AI front office' },
      {
        name: 'description',
        content: 'AI front office for home-service trades: voice receptionist, photo quotes, fleet dispatch, job-to-cash.',
      },
    ],
    // theme bootstrap runs before paint; rendered through HeadContent so server and client trees match
    scripts: [{ children: THEME_BOOT }],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'icon',
        href: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%233b3be8%22/><path d=%22M20.5 7.5a5 5 0 0 0-6.3 6.3l-6.4 6.4a2 2 0 0 0 2.8 2.8l6.4-6.4a5 5 0 0 0 6.3-6.3l-2.9 2.9-2.4-.4-.4-2.4z%22 fill=%22white%22/></svg>',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Scripts />
      </body>
    </html>
  )
}
