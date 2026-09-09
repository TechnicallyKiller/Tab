import type { Metadata } from 'next'
import { Bricolage_Grotesque, IBM_Plex_Mono, Public_Sans } from 'next/font/google'
import './globals.css'

/* Three faces, three jobs. Display carries character, body carries explanation,
   mono carries every digit. No script face and no pixel face. */
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-bricolage',
  display: 'swap',
})
const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-public-sans',
  display: 'swap',
})
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Tab — a credit rail for autonomous agents',
  description:
    'Tab is a running balance for autonomous agents. It goes negative when the agent spends, positive when it earns, and settles once per window in a single transfer.',
}

/**
 * Applies a stored theme choice before first paint. Without this the page
 * renders in the system theme and then snaps, which on a ledger reads as a bug.
 */
const NO_FLASH = `try{var t=localStorage.getItem('tab-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${publicSans.variable} ${plexMono.variable}`}>
      <head>
        {/*
         * The no-flash theme script, which MUST run before first paint —
         * otherwise a dark-mode reader gets a white flash on every navigation.
         * There is no other way to inject a synchronous inline script in Next's
         * app router.
         *
         * `NO_FLASH` is a module-level constant in this repo. No user input
         * reaches it, which is the property the rule is actually protecting.
         */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a static,
            module-local script that must run before paint; no user input. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
