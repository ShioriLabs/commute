// Arriving-now marker borrowed from KCI platform displays, which render an
// imminent departure as `MANGGARAI  >>  17:52`. Decorative only — the row's
// aria-label already states the departure, so this is hidden from assistive
// tech. Respects prefers-reduced-motion via motion-safe:.
export default function PidsChevrons({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-[1px] shrink-0" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="text-base font-black leading-none motion-safe:animate-pulse"
          style={{ color, animationDelay: `${i * 180}ms`, animationDuration: '1.2s' }}
        >
          ›
        </span>
      ))}
    </span>
  )
}
