import clsx from 'clsx'

/**
 * A station exit as MRTJ and KAI sign it, in the Jak Lingko colour roles: the
 * code in signage navy on exit yellow, set in the roundel face.
 *
 * The ref is shown as stored, which is the signed text ('D', 'Utara'), so a long
 * ref stretches the square into a pill rather than being cut down to one letter.
 */
export default function ExitBadge({ code, className }: { code: string, className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center min-w-5.5 h-5.5 px-1 rounded-md bg-exit text-signage font-roundel text-sm font-bold leading-none',
        className
      )}
    >
      {code}
    </span>
  )
}
