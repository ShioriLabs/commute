/*
 * Parser for `mutool draw -F stext` XML and the pure logic that turns its
 * per-character stream into label runs for build-map-labels.ts.
 *
 * Everything here stays in PDF points and page coordinates (y-down from the
 * page's top-left, matching the tile SVG convention); the caller converts to
 * world units. Hand-rolled tag walker rather than an XML dependency: the stext
 * schema is flat, machine-generated, and attribute-quoted, and this must stay
 * testable against small string fixtures.
 *
 * Version tolerance: the char origin arrives as `x`/`y` attributes (older
 * mutool) or as `origin="x y"` (newer); fill color arrives as `color` on the
 * <char> or on the enclosing <font>, or not at all (the caller has a tile-SVG
 * fallback for that case).
 */

export interface StextChar {
  c: string
  x: number
  y: number
  font: string
  size: number
  /** #RRGGBB, or null when this mutool version doesn't emit color. */
  color: string | null
}

export interface StextLine {
  /** Baseline direction unit vector; [1, 0] for horizontal text. */
  dir: [number, number]
  chars: StextChar[]
}

export interface StextPage {
  width: number
  height: number
  lines: StextLine[]
}

/** One drawable label run: same font/size/color/halo, chars along one baseline. */
export interface LabelRun {
  font: string
  size: number
  color: string | null
  halo: boolean
  /** Baseline origin of the first char, PDF points. */
  x: number
  y: number
  dir: [number, number]
  text: string
  /** Per-code-point offsets along dir from the run origin, PDF points. */
  offsets: number[]
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\''
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (_, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) {
      return String.fromCodePoint(parseInt(body.slice(1), 10))
    }
    return ENTITIES[body] ?? `&${body};`
  })
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([\w:-]+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = m[2]
  }
  return attrs
}

function normalizeColor(value: string | undefined): string | null {
  if (!value) return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(value)
  if (!m) return null
  return `#${m[1].toUpperCase()}`
}

export function parseStext(xml: string): StextPage[] {
  const pages: StextPage[] = []
  let page: StextPage | null = null
  let line: StextLine | null = null
  let fontName = ''
  let fontSize = 0
  let fontColor: string | null = null

  const tagRe = /<(\/?)(\w+)((?:[^>"]|"[^"]*")*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml)) !== null) {
    const closing = m[1] === '/'
    const tag = m[2]
    if (closing) {
      if (tag === 'line') line = null
      if (tag === 'page') page = null
      if (tag === 'font') {
        fontName = ''
        fontSize = 0
        fontColor = null
      }
      continue
    }
    const attrs = parseAttrs(m[3])

    if (tag === 'page') {
      page = {
        width: parseFloat(attrs.width ?? '0'),
        height: parseFloat(attrs.height ?? '0'),
        lines: []
      }
      pages.push(page)
    } else if (tag === 'line' && page) {
      const dirParts = (attrs.dir ?? '1 0').trim().split(/\s+/).map(Number)
      const dx = Number.isFinite(dirParts[0]) ? dirParts[0] : 1
      const dy = Number.isFinite(dirParts[1]) ? dirParts[1] : 0
      const len = Math.hypot(dx, dy) || 1
      line = { dir: [dx / len, dy / len], chars: [] }
      page.lines.push(line)
    } else if (tag === 'font') {
      fontName = attrs.name ?? ''
      fontSize = parseFloat(attrs.size ?? '0')
      fontColor = normalizeColor(attrs.color)
    } else if (tag === 'char' && line) {
      let x: number
      let y: number
      if (attrs.origin !== undefined) {
        const parts = attrs.origin.trim().split(/\s+/).map(Number)
        x = parts[0]
        y = parts[1]
      } else {
        x = parseFloat(attrs.x ?? 'NaN')
        y = parseFloat(attrs.y ?? 'NaN')
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const c = decodeEntities(attrs.c ?? '')
      if (c.length === 0) continue
      line.chars.push({
        c,
        x,
        y,
        font: fontName,
        size: fontSize,
        color: normalizeColor(attrs.color) ?? fontColor
      })
    }
  }
  return pages
}

/**
 * Drops exact double-draws: the artwork paints a handful of labels twice with
 * identical glyph, color and origin (a manual "bold" or a leftover), which
 * renders as fuzzy doubled text and, when the duplicates interleave in one
 * line, splits runs mid-word.
 */
export function dedupChars(
  lines: StextLine[],
  tolerance = 0.3
): { lines: StextLine[], dropped: number } {
  const seen = new Map<string, StextChar[]>()
  const cell = (x: number, y: number) => `${Math.round(x / tolerance)},${Math.round(y / tolerance)}`
  let dropped = 0

  const outLines = lines.map(line => ({
    dir: line.dir,
    chars: line.chars.filter((ch) => {
      const cx = Math.round(ch.x / tolerance)
      const cy = Math.round(ch.y / tolerance)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const q of seen.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (q.c !== ch.c || q.color !== ch.color) continue
            if (Math.hypot(q.x - ch.x, q.y - ch.y) <= tolerance) {
              dropped++
              return false
            }
          }
        }
      }
      const key = cell(ch.x, ch.y)
      let bucket = seen.get(key)
      if (!bucket) {
        bucket = []
        seen.set(key, bucket)
      }
      bucket.push(ch)
      return true
    })
  })).filter(l => l.chars.length > 0)

  return { lines: outLines, dropped }
}

function isWhitish(color: string | null): boolean {
  if (!color) return false
  return parseInt(color.slice(1, 3), 16) >= 247
    && parseInt(color.slice(3, 5), 16) >= 247
    && parseInt(color.slice(5, 7), 16) >= 247
}

/**
 * Collapses the artwork's halo double-draw: the PDF paints haloed text twice
 * (a white pass then the ink pass), so a white char with a same-glyph twin at
 * the same origin is a halo, not text. Standalone white chars (route numbers
 * on badges) are real text and survive untouched.
 *
 * Returns lines with halo chars removed and their ink twins flagged.
 */
export function collapseHalos(
  lines: StextLine[],
  tolerance = 0.3
): { lines: { dir: [number, number], chars: (StextChar & { halo: boolean })[] }[], collapsed: number } {
  interface Placed {
    char: StextChar
    lineIdx: number
    charIdx: number
    halo: boolean
    dropped: boolean
  }
  const placed: Placed[] = []
  const byCell = new Map<string, Placed[]>()
  const cell = (x: number, y: number) => `${Math.round(x / tolerance)},${Math.round(y / tolerance)}`

  for (let li = 0; li < lines.length; li++) {
    for (let ci = 0; ci < lines[li].chars.length; ci++) {
      const p: Placed = { char: lines[li].chars[ci], lineIdx: li, charIdx: ci, halo: false, dropped: false }
      placed.push(p)
      const key = cell(p.char.x, p.char.y)
      let bucket = byCell.get(key)
      if (!bucket) {
        bucket = []
        byCell.set(key, bucket)
      }
      bucket.push(p)
    }
  }

  let collapsed = 0
  for (const p of placed) {
    if (p.dropped || !isWhitish(p.char.color)) continue
    // Search the 3x3 cell neighbourhood for an ink twin of the same glyph.
    const cx = Math.round(p.char.x / tolerance)
    const cy = Math.round(p.char.y / tolerance)
    let twin: Placed | null = null
    for (let dx = -1; dx <= 1 && !twin; dx++) {
      for (let dy = -1; dy <= 1 && !twin; dy++) {
        for (const q of byCell.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (q === p || q.dropped || q.char.c !== p.char.c) continue
          if (isWhitish(q.char.color)) continue
          if (Math.hypot(q.char.x - p.char.x, q.char.y - p.char.y) <= tolerance) {
            twin = q
            break
          }
        }
      }
    }
    if (twin) {
      twin.halo = true
      p.dropped = true
      collapsed++
    }
  }

  const outLines = lines.map((l, li) => ({
    dir: l.dir,
    chars: placed
      .filter(p => p.lineIdx === li && !p.dropped)
      .sort((a, b) => a.charIdx - b.charIdx)
      .map(p => ({ ...p.char, halo: p.halo }))
  })).filter(l => l.chars.length > 0)

  return { lines: outLines, collapsed }
}

/**
 * Groups a line's chars into runs: same font, size, color and halo flag, each
 * char sitting on the shared baseline within `baselineTolerance`, and advancing
 * along the line direction with gaps no larger than `gapFactor` x font size.
 */
export function groupRuns(
  lines: { dir: [number, number], chars: (StextChar & { halo: boolean })[] }[],
  opts: { gapFactor?: number, baselineTolerance?: number, sizeTolerance?: number } = {}
): LabelRun[] {
  const gapFactor = opts.gapFactor ?? 1.5
  const baselineTolerance = opts.baselineTolerance ?? 0.5
  const sizeTolerance = opts.sizeTolerance ?? 0.05

  const runs: LabelRun[] = []
  for (const line of lines) {
    const [dx, dy] = line.dir
    let run: LabelRun | null = null
    let prev: (StextChar & { halo: boolean }) | null = null

    for (const ch of line.chars) {
      const startNew = !run || !prev
        || ch.font !== prev.font
        || Math.abs(ch.size - prev.size) > sizeTolerance
        || ch.color !== prev.color
        || ch.halo !== (run.halo)
        || (() => {
          const along = (ch.x - run!.x) * dx + (ch.y - run!.y) * dy
          const across = (ch.x - run!.x) * -dy + (ch.y - run!.y) * dx
          if (Math.abs(across) > baselineTolerance) return true
          const prevAlong = run!.offsets[run!.offsets.length - 1]
          return along - prevAlong > ch.size * gapFactor || along < prevAlong
        })()

      // The invariant consumers rely on: offsets.length === [...text].length.
      // A <char> whose c holds several code points (a ligature mutool didn't
      // decompose) contributes the same offset for each of them.
      const codePoints = [...ch.c]
      if (startNew) {
        run = {
          font: ch.font,
          size: ch.size,
          color: ch.color,
          halo: ch.halo,
          x: ch.x,
          y: ch.y,
          dir: [dx, dy],
          text: ch.c,
          offsets: codePoints.map(() => 0)
        }
        runs.push(run)
      } else {
        const along = (ch.x - run!.x) * dx + (ch.y - run!.y) * dy
        run!.text += ch.c
        for (let i = 0; i < codePoints.length; i++) run!.offsets.push(along)
      }
      prev = ch
    }
  }
  return runs
}
