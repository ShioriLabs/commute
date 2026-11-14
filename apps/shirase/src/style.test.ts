import { describe, expect, it } from 'vitest'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { buildStyle, OVERLAY_LAYER_ID, remapFonts, THEMES, type Theme } from './style'

const ORIGIN = 'https://shirase.example'
const TILESET = 'jabodetabek-20261114'
const styleFor = (theme: Theme) => buildStyle({ origin: ORIGIN, tileset: TILESET, theme })

/** Every font name a style's text-font values can ask for, expressions included. */
function fontsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string' && /^(PT|Noto) Sans/.test(value)) out.add(value)
  else if (Array.isArray(value)) value.forEach(v => fontsIn(v, out))
  return out
}

describe('buildStyle', () => {
  it.each(Object.keys(THEMES) as Theme[])('produces a valid MapLibre style for %s', (theme) => {
    // The style spec's own validator: what GL JS and Native both build on.
    expect(validateStyleMin(styleFor(theme))).toEqual([])
  })

  it('points every URL back at shirase, absolutely', () => {
    const style = styleFor('dark')
    expect(style.glyphs).toBe(`${ORIGIN}/fonts/{fontstack}/{range}.pbf`)
    expect(style.sprite).toBe(`${ORIGIN}/sprites/dark`)
    expect(style.sources.protomaps).toEqual({ type: 'vector', url: `${ORIGIN}/${TILESET}.json` })
    expect(style.metadata).toMatchObject({ 'shirase:tileset': TILESET, 'shirase:theme': 'dark' })
  })

  it('asks only for the PT Sans stacks shirase serves', () => {
    const served = new Set(['PT Sans Regular', 'PT Sans Bold', 'PT Sans Italic', 'PT Sans Narrow Regular', 'PT Sans Narrow Bold'])
    for (const theme of Object.keys(THEMES) as Theme[]) {
      const fonts = new Set<string>()
      for (const layer of styleFor(theme).layers) {
        if (layer.type === 'symbol') fontsIn(layer.layout?.['text-font'], fonts)
      }
      expect(fonts.size).toBeGreaterThan(0)
      for (const font of fonts) expect(served, `${theme}: ${font}`).toContain(font)
    }
  })

  it('sets street names in PT Sans Narrow', () => {
    const roads = styleFor('light').layers.find(l => l.id === 'roads_labels_major')
    expect(roads?.type).toBe('symbol')
    const fonts = fontsIn(roads?.type === 'symbol' ? roads.layout?.['text-font'] : undefined)
    expect([...fonts].every(f => f.startsWith('PT Sans Narrow'))).toBe(true)
  })

  it('labels in Indonesian', () => {
    const json = JSON.stringify(styleFor('light').layers)
    expect(json).toContain('name:id')
  })

  it('leaves an empty overlay slot directly below the first label layer', () => {
    const { layers } = styleFor('light')
    const slot = layers.findIndex(l => l.id === OVERLAY_LAYER_ID)
    expect(slot).toBeGreaterThan(0)
    expect(layers[slot]).toMatchObject({ type: 'background', layout: { visibility: 'none' } })
    expect(layers.slice(0, slot).some(l => l.type === 'symbol')).toBe(false)
    expect(layers[slot + 1]?.type).toBe('symbol')
  })
})

describe('remapFonts', () => {
  it('maps Noto faces to PT Sans, Narrow on request, inside expressions too', () => {
    expect(remapFonts(['Noto Sans Medium'], false)).toEqual(['PT Sans Bold'])
    expect(remapFonts(['Noto Sans Italic'], true)).toEqual(['PT Sans Narrow Regular'])
    expect(remapFonts(['case', ['==', 'x', 1], ['literal', ['Noto Sans Devanagari Regular v1']], ['literal', ['Noto Sans Regular']]], false))
      .toEqual(['case', ['==', 'x', 1], ['literal', ['PT Sans Regular']], ['literal', ['PT Sans Regular']]])
  })
})
