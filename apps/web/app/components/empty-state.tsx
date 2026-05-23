interface Props {
  mode: 'OFFLINE' | 'NO_DATA'
}

export default function EmptyState({ mode }: Props) {
  const title = mode === 'OFFLINE' ? 'Jaringan Tidak Tersedia' : 'Jadwal Tidak Tersedia'
  const message = mode === 'OFFLINE'
    ? 'Silakan coba lagi beberapa saat lagi saat jaringan Anda tersambung'
    : 'Silakan coba lagi beberapa saat lagi'

  return (
    <div className="w-full h-auto flex items-center justify-center mt-8 flex-col max-w-3xl mx-auto">
      <picture>
        <source srcSet="/img/search_empty.webp" type="image/webp" />
        <img src="/img/search_empty.png" alt="Gambar peron stasiun dengan jembatan di atasnya, dengan kaca pembesar bergambar tanda tanya di depannya" className="w-48 h-48 aspect-square object-contain" />
      </picture>
      <span className="text-2xl text-center font-bold mt-0">{title}</span>
      <p className="text-center mt-2">
        {message}
      </p>
    </div>
  )
}
