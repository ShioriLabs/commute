// Highlights the first case-insensitive substring hit of `query` inside
// `text` (pure-fuzzy matches render plain).
export default function HighlightMatch({ text, query }: { text: string, query?: string }) {
  if (!query) return <>{text}</>
  const matchIndex = text.toLowerCase().indexOf(query.toLowerCase())
  if (matchIndex === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, matchIndex)}
      <span className="text-[#F55875]">{text.slice(matchIndex, matchIndex + query.length)}</span>
      {text.slice(matchIndex + query.length)}
    </>
  )
}
