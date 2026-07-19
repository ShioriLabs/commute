interface Props {
  mode: 'OFFLINE' | 'NO_DATA' | 'ERROR' | 'NO_SCHEDULE'
  onRetry?: () => void
  // Override the mode's default copy (e.g. station-specific messages).
  title?: string
  message?: string
}

const COPY = {
  OFFLINE: {
    title: 'Jaringan Tidak Tersedia',
    message: 'Silakan coba lagi beberapa saat lagi saat jaringan Anda tersambung'
  },
  ERROR: {
    title: 'Gagal Memuat Jadwal',
    message: 'Terjadi kesalahan saat memuat data. Silakan coba lagi.'
  },
  NO_DATA: {
    title: 'Jadwal Tidak Tersedia',
    message: 'Silakan coba lagi beberapa saat lagi'
  },
  // Operators without a published timetable (e.g. TransJakarta) — not an error.
  NO_SCHEDULE: {
    title: 'Jadwal Tidak Tersedia',
    message: 'Lihat papan keberangkatan atau tanyakan pramusapa'
  }
} as const

// Per-mode illustration. NO_SCHEDULE shows a TJ officer beside an empty
// departure board (mirrors the "check the board / ask an officer" copy); the
// other states keep the station/magnifying-glass image.
const ILLUSTRATION = {
  NO_SCHEDULE: {
    src: 'no_schedule',
    alt: 'Gambar petugas TransJakarta membungkuk di depan papan keberangkatan yang kosong'
  },
  DEFAULT: {
    src: 'search_empty',
    alt: 'Gambar peron stasiun dengan jembatan di atasnya, dengan kaca pembesar bergambar tanda tanya di depannya'
  }
} as const

export default function EmptyState({ mode, onRetry, title: titleOverride, message: messageOverride }: Props) {
  const title = titleOverride ?? COPY[mode].title
  const message = messageOverride ?? COPY[mode].message
  const illustration = mode === 'NO_SCHEDULE' ? ILLUSTRATION.NO_SCHEDULE : ILLUSTRATION.DEFAULT

  return (
    <div className="w-full h-auto flex items-center justify-center mt-8 flex-col max-w-3xl mx-auto" aria-live="polite">
      <picture>
        <source srcSet={`/img/${illustration.src}.webp`} type="image/webp" />
        <img src={`/img/${illustration.src}.png`} alt={illustration.alt} className="w-48 h-48 aspect-square object-contain" />
      </picture>
      <span className="text-2xl text-center font-bold mt-0">{title}</span>
      <p className="text-center mt-2">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 bg-[#F55875] text-white font-bold px-6 py-2 rounded-xl cursor-pointer"
        >
          Coba Lagi
        </button>
      )}
    </div>
  )
}
