import type { Viewport } from 'next';
import { Fraunces, Crimson_Pro, Caveat, IBM_Plex_Mono } from 'next/font/google';
import DiaryBackground from './_components/DiaryBackground';
import '@/styles/diary.css';
import './_styles/diary-auth.css';
import './_styles/diary-views.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  // weight: 'variable' gives us the full variable font so CSS can use
  // `font-variation-settings: "opsz" 144, "SOFT" 100` on .auth-title.
  // Cannot combine `axes` with explicit weights — Next.js rejects that.
  weight: 'variable',
  style: ['normal', 'italic'],
  display: 'swap',
});

const crimson = Crimson_Pro({
  subsets: ['latin'],
  variable: '--font-crimson',
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-caveat',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-plex-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

/**
 * Hint browser UA (autofill chrome, native form controls, scrollbars)
 * that this route works in both color schemes. Without this, Chrome
 * paints autofilled inputs with its yellow box even when our CSS
 * compensates with `-webkit-text-fill-color`.
 *
 * In App Router 16, colorScheme lives on the viewport export
 * (not metadata) — Next.js logs a deprecation warning otherwise.
 */
export const viewport: Viewport = {
  colorScheme: 'dark light',
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`auth-scope ${fraunces.variable} ${crimson.variable} ${caveat.variable} ${plexMono.variable}`}
    >
      <DiaryBackground />
      {children}
    </div>
  );
}
