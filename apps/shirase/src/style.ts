import { layers as basemapLayers, namedFlavor } from '@protomaps/basemaps'
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec'

/*
 * The finished MapLibre styles shirase hands out at /styles/{theme}.json, so
 * the web app (MapLibre GL JS) and Android (MapLibre Native) both just load a
 * URL and know nothing about Protomaps layers, fonts or tilesets.
 *
 * Built from Protomaps' own basemap layers (`@protomaps/basemaps`, pinned to
 * the version that matches the v4 tile schema), with:
 *   - labels in Indonesian (`name:id`, falling back through the package's own
 *     chain to `name`),
 *   - every font remapped to the PT Sans stacks shirase serves (JakLingko's
 *     guideline): Narrow for road and address labels, PT Sans elsewhere,
 *   - an empty `commute-overlay` layer below the first label layer, which the
 *     apps insert their own layers before (bus lines, haltes, rail dots), so
 *     street and place names always draw over them.
 *
 * Theme names are the apps' (light, dark), not Protomaps' flavor names, so
 * what a theme looks like can be tuned here without any app changing its URL.
 */

export const THEMES = {
  light: { flavor: 'light', sprite: 'light' },
  dark: { flavor: 'dark', sprite: 'dark' }
} as const

export type Theme = keyof typeof THEMES

export const isTheme = (value: string): value is Theme => Object.hasOwn(THEMES, value)

/** The id apps pass as `beforeId` when adding their own layers. */
export const OVERLAY_LAYER_ID = 'commute-overlay'

const SOURCE = 'protomaps'

const FONTS: Record<string, string> = {
  'Noto Sans Regular': 'PT Sans Regular',
  'Noto Sans Medium': 'PT Sans Bold',
  'Noto Sans Italic': 'PT Sans Italic'
}
const NARROW: Record<string, string> = {
  'PT Sans Regular': 'PT Sans Narrow Regular',
  'PT Sans Bold': 'PT Sans Narrow Bold',
  // No Narrow Italic exists; upright Narrow reads better than a wide italic
  // squeezed along a street.
  'PT Sans Italic': 'PT Sans Narrow Regular'
}
const NARROW_LAYERS = /^(roads_labels|roads_shields|address_label)/

/*
 * Swap every Noto face for its PT Sans stack, wherever it sits in a text-font
 * value (a plain array, or inside an expression for non-Latin scripts). A Noto
 * face with no PT Sans counterpart (Devanagari and friends) becomes PT Sans
 * Regular rather than a stack shirase would 404 on.
 */
export function remapFonts(value: unknown, narrow: boolean): unknown {
  if (typeof value === 'string') {
    if (!value.startsWith('Noto')) return value
    const font = FONTS[value] ?? 'PT Sans Regular'
    return narrow ? NARROW[font] : font
  }
  if (Array.isArray(value)) return value.map(v => remapFonts(v, narrow))
  return value
}

export interface StyleOptions {
  /** Absolute origin shirase is served from; every URL in the style is absolute. */
  origin: string
  tileset: string
  theme: Theme
}

export function buildStyle({ origin, tileset, theme }: StyleOptions): StyleSpecification {
  const { flavor, sprite } = THEMES[theme]
  const layers = (basemapLayers(SOURCE, namedFlavor(flavor), { lang: 'id' }) as LayerSpecification[]).map((layer) => {
    if (layer.type !== 'symbol' || !layer.layout?.['text-font']) return layer
    return {
      ...layer,
      layout: {
        ...layer.layout,
        'text-font': remapFonts(layer.layout['text-font'], NARROW_LAYERS.test(layer.id))
      }
    } as LayerSpecification
  })

  // Below the first label, above every fill and line: where transit lines go.
  const firstLabel = layers.findIndex(layer => layer.type === 'symbol')
  const overlay: LayerSpecification = {
    id: OVERLAY_LAYER_ID,
    type: 'background',
    layout: { visibility: 'none' }
  }
  layers.splice(firstLabel === -1 ? layers.length : firstLabel, 0, overlay)

  return {
    version: 8,
    name: `Commute ${theme}`,
    metadata: { 'shirase:tileset': tileset, 'shirase:theme': theme },
    glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/sprites/${sprite}`,
    sources: {
      [SOURCE]: { type: 'vector', url: `${origin}/${tileset}.json` }
    },
    layers
  }
}
