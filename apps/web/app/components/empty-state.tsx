interface Props {
  mode: 'OFFLINE' | 'NO_DATA' | 'ERROR'
  onRetry?: () => void
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
  }
} as const

export default function EmptyState({ mode, onRetry }: Props) {
  const { title, message } = COPY[mode]

  return (
    <div className="w-full h-auto flex items-center justify-center mt-8 flex-col max-w-3xl mx-auto" aria-live="polite">
      <picture>
        <source srcSet="/img/search_empty.webp" type="image/webp" />
        <img src="/img/search_empty.png" alt="Gambar peron stasiun dengan jembatan di atasnya, dengan kaca pembesar bergambar tanda tanya di depannya" className="w-48 h-48 aspect-square object-contain" />
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
