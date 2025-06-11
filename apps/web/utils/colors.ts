export function getForegroundColor(backgroundColor: string): 'LIGHT' | 'DARK' {
  if (backgroundColor.startsWith('#')) {
    backgroundColor = backgroundColor.slice(1)
  }

  if (backgroundColor.length === 3) {
    backgroundColor = backgroundColor.split('').map(c => c + c).join('')
  }

  const r = parseInt(backgroundColor.substring(0, 2), 16)
  const g = parseInt(backgroundColor.substring(2, 4), 16)
  const b = parseInt(backgroundColor.substring(4, 6), 16)

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b)

  return luminance > 186 ? 'DARK' : 'LIGHT'
}

export function getTintFromColor(color: string, tintFactor = 0.2, towards: 'light' | 'dark' = 'light') {
  color = color.replace(/^#/, '')

  let r = parseInt(color.substring(0, 2), 16)
  let g = parseInt(color.substring(2, 4), 16)
  let b = parseInt(color.substring(4, 6), 16)

  const target = towards === 'light' ? 255 : 128

  r = Math.round(r * tintFactor + target * (1 - tintFactor))
  g = Math.round(g * tintFactor + target * (1 - tintFactor))
  b = Math.round(b * tintFactor + target * (1 - tintFactor))

  return '#' + [r, g, b].map(x =>
    x.toString(16).padStart(2, '0')
  ).join('')
}
