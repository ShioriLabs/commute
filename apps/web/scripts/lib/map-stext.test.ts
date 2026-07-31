import { describe, expect, it } from 'vitest'
import { collapseHalos, dedupChars, groupRuns, parseStext } from './map-stext'

// Hand-written stext XML in mutool's schema. Covers both origin conventions
// (x/y attributes and origin="x y"), color on <char> and on <font>, a rotated
// line, entities, and the halo double-draw.

const FIXTURE = `<?xml version="1.0"?>
<document name="test.pdf">
<page id="page1" width="2378.39" height="1681.72">
<block bbox="0 0 100 100">
<line bbox="0 0 100 20" wmode="0" dir="1 0">
<font name="ABCDEF+PTSans-Regular" size="10">
<char quad="0 0 0 0 0 0 0 0" x="10" y="50" color="#19181c" c="M"/>
<char quad="0 0 0 0 0 0 0 0" x="16" y="50" color="#19181c" c="a"/>
<char quad="0 0 0 0 0 0 0 0" x="21" y="50" color="#19181c" c="p"/>
</font>
</line>
<line bbox="0 0 100 20" wmode="0" dir="1 0">
<font name="ABCDEF+PTSansNarrow-Bold" size="8">
<char quad="0 0 0 0 0 0 0 0" origin="10 70" color="#ffffff" c="2"/>
<char quad="0 0 0 0 0 0 0 0" origin="15 70" color="#ffffff" c="A"/>
</font>
</line>
<line bbox="0 0 100 20" wmode="0" dir="0.707 -0.707">
<font name="GHIJKL+PTSans-Italic" size="9" color="#583716">
<char quad="0 0 0 0 0 0 0 0" x="100" y="100" c="K"/>
<char quad="0 0 0 0 0 0 0 0" x="104.24" y="95.76" c="&amp;"/>
</font>
</line>
</block>
</page>
</document>
`

// Halo pair: same glyph twice, white first then ink, origins within 0.3 pt.
const HALO_FIXTURE = `<?xml version="1.0"?>
<document name="halo.pdf">
<page id="page1" width="100" height="100">
<block bbox="0 0 100 100">
<line bbox="0 0 100 20" wmode="0" dir="1 0">
<font name="PTSans-Regular" size="10">
<char x="10" y="50" color="#ffffff" c="C"/>
<char x="16.1" y="50" color="#ffffff" c="i"/>
</font>
</line>
<line bbox="0 0 100 20" wmode="0" dir="1 0">
<font name="PTSans-Regular" size="10">
<char x="10.1" y="50.1" color="#19181c" c="C"/>
<char x="16" y="50.05" color="#19181c" c="i"/>
</font>
</line>
<line bbox="0 0 100 20" wmode="0" dir="1 0">
<font name="PTSansNarrow-Bold" size="8">
<char x="60" y="80" color="#ffffff" c="7"/>
</font>
</line>
</block>
</page>
</document>
`

describe('parseStext', () => {
  it('parses pages, lines, fonts and both origin conventions', () => {
    const pages = parseStext(FIXTURE)
    expect(pages).toHaveLength(1)
    expect(pages[0].width).toBeCloseTo(2378.39)
    expect(pages[0].height).toBeCloseTo(1681.72)
    expect(pages[0].lines).toHaveLength(3)

    const [first, second, third] = pages[0].lines
    expect(first.chars.map(c => c.c).join('')).toBe('Map')
    expect(first.chars[0]).toMatchObject({ x: 10, y: 50, font: 'ABCDEF+PTSans-Regular', size: 10, color: '#19181C' })

    // origin="x y" convention
    expect(second.chars[0]).toMatchObject({ x: 10, y: 70, color: '#FFFFFF' })

    // color inherited from <font>, entity decoded, rotated dir normalized
    expect(third.chars[1].c).toBe('&')
    expect(third.chars[0].color).toBe('#583716')
    expect(third.dir[0]).toBeCloseTo(Math.SQRT1_2, 3)
    expect(third.dir[1]).toBeCloseTo(-Math.SQRT1_2, 3)
  })

  it('returns null color when neither char nor font carries one', () => {
    const xml = FIXTURE.replace(/ color="#19181c"/g, '')
    const pages = parseStext(xml)
    expect(pages[0].lines[0].chars[0].color).toBeNull()
  })
})

describe('dedupChars', () => {
  it('drops exact same-color double-draws but keeps distinct chars', () => {
    const lines = [
      {
        dir: [1, 0] as [number, number],
        chars: [
          { c: 'M', x: 10, y: 50, font: 'F', size: 10, color: '#19181C' },
          { c: 'M', x: 10.1, y: 50, font: 'F', size: 10, color: '#19181C' },
          { c: 'a', x: 18, y: 50, font: 'F', size: 10, color: '#19181C' }
        ]
      },
      {
        dir: [1, 0] as [number, number],
        chars: [
          // Same glyph and spot but different color: a halo pair, not a dup.
          { c: 'a', x: 18, y: 50, font: 'F', size: 10, color: '#FFFFFF' }
        ]
      }
    ]
    const { lines: out, dropped } = dedupChars(lines)
    expect(dropped).toBe(1)
    expect(out.flatMap(l => l.chars).map(c => c.c + c.color)).toEqual(['M#19181C', 'a#19181C', 'a#FFFFFF'])
  })
})

describe('collapseHalos', () => {
  it('drops white twins and flags their ink chars, keeping standalone white text', () => {
    const pages = parseStext(HALO_FIXTURE)
    const { lines, collapsed } = collapseHalos(pages[0].lines)
    expect(collapsed).toBe(2)

    const all = lines.flatMap(l => l.chars)
    const inked = all.filter(c => c.color === '#19181C')
    expect(inked).toHaveLength(2)
    expect(inked.every(c => c.halo)).toBe(true)

    // The lone white "7" (badge number) survives, unflagged.
    const white = all.filter(c => c.color === '#FFFFFF')
    expect(white).toHaveLength(1)
    expect(white[0]).toMatchObject({ c: '7', halo: false })
  })
})

describe('groupRuns', () => {
  function haloed(lines: ReturnType<typeof parseStext>[0]['lines']) {
    return lines.map(l => ({ dir: l.dir, chars: l.chars.map(c => ({ ...c, halo: false })) }))
  }

  it('groups same-style chars into one run with per-char offsets', () => {
    const pages = parseStext(FIXTURE)
    const runs = groupRuns(haloed(pages[0].lines))
    const map = runs.find(r => r.text === 'Map')!
    expect(map).toMatchObject({ font: 'ABCDEF+PTSans-Regular', size: 10, color: '#19181C', x: 10, y: 50 })
    expect(map.offsets).toEqual([0, 6, 11])
  })

  it('projects offsets along a rotated baseline', () => {
    const pages = parseStext(FIXTURE)
    const runs = groupRuns(haloed(pages[0].lines))
    const rotated = runs.find(r => r.text === 'K&')!
    // Second char sits 4.24,-4.24 from the origin -> ~6 along dir (0.707,-0.707).
    expect(rotated.offsets[1]).toBeCloseTo(6, 1)
  })

  it('splits runs on font change, gaps, and baseline deviation', () => {
    const lines = [{
      dir: [1, 0] as [number, number],
      chars: [
        { c: 'A', x: 0, y: 0, font: 'F', size: 10, color: '#19181C', halo: false },
        { c: 'B', x: 6, y: 0, font: 'F', size: 10, color: '#19181C', halo: false },
        // gap > 1.5 x size -> new run
        { c: 'C', x: 40, y: 0, font: 'F', size: 10, color: '#19181C', halo: false },
        // off-baseline -> new run
        { c: 'D', x: 46, y: 2, font: 'F', size: 10, color: '#19181C', halo: false },
        // font change -> new run
        { c: 'E', x: 52, y: 2, font: 'G', size: 10, color: '#19181C', halo: false }
      ]
    }]
    const runs = groupRuns(lines)
    expect(runs.map(r => r.text)).toEqual(['AB', 'C', 'D', 'E'])
  })

  it('keeps offsets aligned with code points for ligature chars', () => {
    const lines = [{
      dir: [1, 0] as [number, number],
      chars: [
        { c: 'f', x: 0, y: 0, font: 'F', size: 10, color: '#19181C', halo: false },
        { c: 'fi', x: 5, y: 0, font: 'F', size: 10, color: '#19181C', halo: false }
      ]
    }]
    const runs = groupRuns(lines)
    expect(runs).toHaveLength(1)
    expect([...runs[0].text].length).toBe(runs[0].offsets.length)
  })
})
