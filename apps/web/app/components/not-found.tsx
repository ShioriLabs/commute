import { Link } from 'react-router'

/**
 * The 404 screen, rendered from root.tsx's ErrorBoundary.
 *
 * Deliberately not routed through the shared <EmptyState>, for the same reason
 * the map's error screens aren't: that component is an in-page block built
 * around a max-w-3xl column and a single retry button, and this is a
 * full-screen takeover with a primary and a secondary action.
 *
 * The ErrorBoundary replaces App and both layouts, so nothing else on this
 * screen navigates — the two links below are the only way out.
 *
 * "Ente nyasar?" is Betawi rather than the "kamu" the rest of the app uses. A
 * one-off on purpose: a dead link is the one moment where the app can afford a
 * joke, and the Jakarta register is the point. Do not propagate it elsewhere.
 */
export default function NotFound() {
  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center p-6 bg-[#FFF8F8] text-center"
      aria-live="polite"
    >
      {/* max-h caps the art on short viewports (landscape phones) so the
          primary action stays above the fold instead of scrolling off. */}
      <picture>
        <source srcSet="/img/not_found.webp" type="image/webp" />
        <img
          src="/img/not_found.png"
          alt="Gambar orang kebingungan menggaruk kepala di depan gedung-gedung kota"
          className="w-48 h-48 max-h-[30dvh] object-contain"
        />
      </picture>
      <h1 className="text-2xl font-bold">Ente nyasar?</h1>
      <p className="mt-2 max-w-sm text-balance">
        Tenang, kita semua pernah salah turun. Bedanya halaman ini emang kagak pernah ada
      </p>
      <Link
        to="/"
        className="mt-6 bg-[#F55875] text-white font-bold px-6 py-2 rounded-xl"
      >
        Balik ke Beranda
      </Link>
      <Link to="/search" className="mt-3 px-4 py-2 text-sm text-slate-500">
        Cari Stasiun
      </Link>
    </main>
  )
}
