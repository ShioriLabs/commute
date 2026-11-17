import { layers as basemapLayers, namedFlavor, type Flavor } from '@protomaps/basemaps'
import { convertFilter, type ExpressionSpecification, type FilterSpecification, type LayerSpecification, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { APPLE_DARK, APPLE_LIGHT, FOOTBRIDGE_OPACITY, NEAR_FROM_ZOOM, type Palette } from './flavors'
import { JP_ROADS, jpLayers, jpLeftOut, metresWide, ROADS_SOURCE } from './jp-roads'
import POIS from './pois.json'
import { appleRoadLayers, restyleAppleRoad } from './roads'

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
 *
 * Every theme draws real road surfaces from z17, baked by
 * scripts/build-jp-roads.mjs. light and dark are Apple Maps-like
 * (src/flavors.ts palettes; src/roads.ts: surfaces and a kerb hairline). `jp`
 * is Protomaps' light with Japanese road markings (src/jp-roads.ts, from
 * values in Japan's road markings ordinance).
 */

type BakedRoads = { kind: 'apple', palette: Palette } | { kind: 'jp' }

export const THEMES: Record<'light' | 'dark' | 'jp', { flavor: Flavor, sprite: string, bakedRoads: BakedRoads }> = {
  light: { flavor: APPLE_LIGHT.flavor, sprite: POIS.themes.light.sprite, bakedRoads: { kind: 'apple', palette: APPLE_LIGHT } },
  dark: { flavor: APPLE_DARK.flavor, sprite: POIS.themes.dark.sprite, bakedRoads: { kind: 'apple', palette: APPLE_DARK } },
  jp: { flavor: namedFlavor('light'), sprite: 'light', bakedRoads: { kind: 'jp' } }
}

export type Theme = keyof typeof THEMES

export const isTheme = (value: string): value is Theme => Object.hasOwn(THEMES, value)

/** The id apps pass as `beforeId` when adding their own layers. */
export const OVERLAY_LAYER_ID = 'commute-overlay'

const SOURCE = 'protomaps'

/* Footbridges: a deck this wide (a JPO's is ~2.5-3 m), from this zoom (thin, then true to scale). */
export const FOOTBRIDGE_M = 3
export const FOOTBRIDGE_FROM_ZOOM = 15
function footbridgeWidth(): ExpressionSpecification {
  const [, , , z0, px0, z1, px1] = metresWide(FOOTBRIDGE_M, 16) as [string, unknown, unknown, number, number, number, number]
  // At least a pixel and a half until it is wider than that to scale.
  return ['interpolate', ['exponential', 2], ['zoom'], FOOTBRIDGE_FROM_ZOOM, 1.5, z0, Math.max(1.5, px0), z1, px1]
}

/** Basemap road layers the baked surfaces replace from their minzoom, in every theme. */
const BASE_ROADS_UNDER_SURFACE = /^roads_(bridges_)?(minor|minor_service|major|highway|link)(_casing(_early|_late)?)?$/

/*
 * Light and dark label only the places people navigate by, as Apple's map
 * stays readable: transit, landmarks, campuses, parks, malls, hospitals. The
 * long tail (cafés, warungs, minimarkets, couriers, schools, benches) is left
 * out, and bus stops too, since Peta Bus draws its own haltes. Each kind has
 * its own icon in our sprite (src/pois.json, scripts/build-sprites.mjs).
 */
export const LANDMARK_POIS = Object.keys(POIS.kinds)

/* The kinds labelled only for the places pois.json names (places of worship: Istiqlal, Katedral). */
const NAMED_ONLY: Record<string, string[]> = POIS.named

/* A named landmark: one of the places pois.json lists by name. */
const NAMED_LANDMARK: ExpressionSpecification = ['any', ...Object.entries(NAMED_ONLY).map(([kind, names]): ExpressionSpecification =>
  ['all', ['==', ['get', 'kind'], kind], ['in', ['get', 'name'], ['literal', names]]])]

/* Which landmarks a POI is: any of its kind, or for a named-only kind, one of the names listed. */
const LANDMARK_FILTER: ExpressionSpecification = ['any',
  ['in', ['get', 'kind'], ['literal', LANDMARK_POIS.filter(kind => !(kind in NAMED_ONLY))]],
  NAMED_LANDMARK]

/** Basemap road symbols that follow which roads the jp theme draws. */
const BASE_ROAD_SYMBOLS_FOLLOWING_SURFACE = ['roads_oneway', 'roads_labels_minor']

/*
 * A layer filter as an expression, so it can be combined with one. Protomaps
 * still writes some in the legacy form (`["in", "kind", ...]`), and the two
 * forms cannot be mixed inside one `all`.
 */
function asExpression(filter: unknown): ExpressionSpecification {
  if (filter === undefined) return ['literal', true] as unknown as ExpressionSpecification
  return (isLegacyFilter(filter) ? convertFilter(filter as FilterSpecification) : filter) as ExpressionSpecification
}

/*
 * Legacy filters name a property as a bare string (`["==", "kind", "x"]`,
 * `["!has", "is_bridge"]`), or use ops expressions lack (`none`, `!in`,
 * `!has`). `has` with a bare string is valid in both forms.
 */
function isLegacyFilter(filter: unknown): boolean {
  if (!Array.isArray(filter)) return false
  const [op, first] = filter
  if (op === 'all' || op === 'any') return filter.slice(1).some(isLegacyFilter)
  if (op === 'none' || op === '!in' || op === '!has') return true
  return ['==', '!=', '<', '>', '<=', '>=', 'in'].includes(op) && typeof first === 'string'
}

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
  const { flavor, sprite, bakedRoads } = THEMES[theme]
  const layers = (basemapLayers(SOURCE, flavor, { lang: 'id' }) as LayerSpecification[]).map((layer) => {
    if (layer.type !== 'symbol' || !layer.layout?.['text-font']) return layer
    return {
      ...layer,
      layout: {
        ...layer.layout,
        'text-font': remapFonts(layer.layout['text-font'], NARROW_LAYERS.test(layer.id))
      }
    } as LayerSpecification
  })

  /*
   * From where the baked surfaces take over, the basemap's own lines for
   * the same roads would peek out past them as lighter outlines: they stop
   * there. Paths, tunnels and rail keep theirs.
   */
  for (const layer of layers) {
    if (layer.type === 'line' && BASE_ROADS_UNDER_SURFACE.test(layer.id)) {
      layer.maxzoom = Math.min(layer.maxzoom ?? 24, JP_ROADS.minzoom)
      // The roads the bake leaves out (lobby loops, parking aisles, private
      // service roads) stay out at every zoom, not only once it takes over.
      layer.filter = ['all', asExpression(layer.filter), ['!', jpLeftOut()]]
      if (bakedRoads.kind === 'apple') restyleAppleRoad(layer, bakedRoads.palette, flavor)
    }
  }
  // Light and dark: no casings across the city (restyleAppleRoad).
  if (bakedRoads.kind === 'apple') {
    for (let i = layers.length - 1; i >= 0; i--) {
      if (/_casing_early$/.test(layers[i]!.id)) layers.splice(i, 1)
    }
  }
  /*
   * Roads the bake leaves out lose their basemap arrows and names from the
   * same zoom, or those float over empty ground.
   */
  const drawn: ExpressionSpecification = ['any', ['<', ['zoom'], JP_ROADS.minzoom], ['!', jpLeftOut()]]
  for (const layer of layers) {
    if (layer.type === 'symbol' && BASE_ROAD_SYMBOLS_FOLLOWING_SURFACE.includes(layer.id)) {
      layer.filter = ['all', asExpression(layer.filter), drawn]
    }
  }
  // Light and dark pave mapped sidewalks and pedestrian streets from minzoom; their lines stop there.
  if (bakedRoads.kind === 'apple') {
    const paths = layers.find(l => l.id === 'roads_other')
    if (paths?.type === 'line') {
      paths.filter = ['all', asExpression(paths.filter), ['any', ['<', ['zoom'], JP_ROADS.minzoom], ['!', ['in', ['get', 'kind_detail'], ['literal', ['sidewalk', 'pedestrian']]]]]]
    }
  }
  /*
   * Light and dark: footbridges (JPO, halte skywalks) as Apple draws them, a
   * translucent deck FOOTBRIDGE_M wide over the roads below, with a thin rim.
   * Their stairs too: OSM tags the flights up to a JPO highway=steps, not
   * bridge (Matraman: 18 m legs, a 59 m flight down to the halte), and in
   * Jakarta steps are nearly all JPO and halte stairs.
   * The rim is the casing's line beside a gap the deck's width, so the two
   * never overlap and darken each other.
   */
  if (bakedRoads.kind === 'apple') {
    const { footbridge } = bakedRoads.palette
    const deck = footbridgeWidth()
    const isPath: ExpressionSpecification = ['==', ['get', 'kind'], 'path']
    const isSteps: ExpressionSpecification = ['all', isPath, ['==', ['get', 'kind_detail'], 'steps'], ['!', ['has', 'is_tunnel']]]
    for (const id of ['roads_bridges_other_casing', 'roads_bridges_other']) {
      const index = layers.findIndex(l => l.id === id)
      const layer = layers[index]
      if (layer?.type !== 'line') continue
      const rim = id.endsWith('_casing')
      // Protomaps' `other` bridges are busways too (Koridor 13's flyover): those keep their look.
      const footbridges: LayerSpecification = {
        ...layer,
        id: id.replace('other', 'foot'),
        filter: ['any', ['all', asExpression(layer.filter), isPath], isSteps],
        minzoom: FOOTBRIDGE_FROM_ZOOM,
        // Up close the bake draws them, deck and stairs as one shape (roads-footbridge).
        maxzoom: JP_ROADS.minzoom,
        paint: {
          'line-color': rim ? footbridge.rim : footbridge.deck,
          'line-opacity': FOOTBRIDGE_OPACITY,
          ...(rim ? { 'line-gap-width': deck, 'line-width': 1 } : { 'line-width': deck })
        }
      }
      layer.filter = ['all', asExpression(layer.filter), ['!', isPath]]
      layers.splice(index + 1, 0, footbridges)
    }
    // Steps leave the ground paths where the footbridge layers take them.
    const paths = layers.find(l => l.id === 'roads_other')
    if (paths?.type === 'line') paths.filter = ['all', asExpression(paths.filter), ['any', ['<', ['zoom'], FOOTBRIDGE_FROM_ZOOM], ['!', isSteps]]]
  }
  // Light and dark bake their tunnels from minzoom; the basemap's lines stop there.
  if (bakedRoads.kind === 'apple') {
    for (const layer of layers) {
      if (layer.type === 'line' && /^roads_tunnels_(minor|minor_service|major|highway|link)(_casing)?$/.test(layer.id)) {
        layer.maxzoom = Math.min(layer.maxzoom ?? 24, JP_ROADS.minzoom)
      }
    }
  }
  // Light and dark: street names in Narrow Bold, as place names are bold,
  // tracked out a touch: the bold narrow cut sets its letters tight.
  if (bakedRoads.kind === 'apple') {
    for (const layer of layers) {
      if (layer.type === 'symbol' && /^roads_labels_(minor|major)$/.test(layer.id) && layer.layout) {
        layer.layout['text-font'] = ['PT Sans Narrow Bold']
        // Main roads in capitals, tracked wider, as Apple names its avenues
        // (Ginza's KOJUNSHA-DORI AVENUE); small streets stay in normal case.
        const major = layer.id === 'roads_labels_major'
        layer.layout['text-letter-spacing'] = major ? 0.12 : 0.05
        if (major) layer.layout['text-transform'] = 'uppercase'
      }
    }
  }
  /*
   * Light and dark: a merged divided road carries one name on its centre
   * line (the bake's label layer) from minzoom, where the basemap named each
   * carriageway; the basemap's names give way inside the merged stretches.
   */
  if (bakedRoads.kind === 'apple' && JP_ROADS.merge) {
    const major = layers.find(l => l.id === 'roads_labels_major')
    const insertAt = layers.findIndex(l => l.id === 'roads_labels_minor')
    if (major?.type === 'symbol' && insertAt >= 0) {
      const merged = JP_ROADS.merge.stretches
      const area: ExpressionSpecification = ['within', {
        type: 'MultiPolygon',
        coordinates: merged.map(({ box: [w, s, e, n] }) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]])
      }] as unknown as ExpressionSpecification
      const names = [...new Set(merged.map(m => m.name))]
      for (const layer of layers) {
        if (layer.type === 'symbol' && /^roads_labels_(minor|major)$/.test(layer.id)) {
          layer.filter = ['all', asExpression(layer.filter), ['any', ['<', ['zoom'], JP_ROADS.minzoom], ['!', ['in', ['get', 'name'], ['literal', names]]], ['!', area]]]
        }
      }
      layers.splice(insertAt, 0, {
        ...major,
        'id': 'roads-label-merged',
        'source': ROADS_SOURCE,
        'source-layer': 'label',
        'minzoom': JP_ROADS.minzoom,
        'filter': ['has', 'name'],
        'layout': { ...major.layout, 'text-field': ['get', 'name'] },
        // No halo: it runs on the median, and a halo in the road's colour
        // wider than the strip erased the median wherever the name ran.
        'paint': { ...major.paint, 'text-halo-width': 0 }
      })
    }
  }
  // Light and dark: landmarks only (LANDMARK_POIS), keeping Protomaps' zoom rule.
  if (bakedRoads.kind === 'apple') {
    const pois = layers.find(l => l.id === 'pois')
    if (pois?.type === 'symbol') {
      const { flavor: { pois: colours } } = bakedRoads.palette
      if (pois.paint) {
        pois.paint['text-halo-color'] = bakedRoads.palette.poiHalo
        // Each label in its category's colour, as its icon is.
        pois.paint['text-color'] = ['match', ['get', 'kind'],
          ...Object.entries(POIS.kinds).flatMap(([kind, [, category]]) => [kind, colours![POIS.categories[category as keyof typeof POIS.categories].text as keyof NonNullable<typeof colours>]]),
          bakedRoads.palette.poiHalo] as unknown as ExpressionSpecification
      }
      if (pois.paint) pois.paint['text-halo-width'] = 1.5
      if (pois.layout) {
        pois.layout['icon-image'] = ['concat', 'poi-', ['get', 'kind']]
        // Bold, as Apple's place labels are semibold: a regular weight in a
        // pale tint lost its contrast over buildings (Museum Nasional).
        pois.layout['text-font'] = ['PT Sans Bold']
        // A named landmark is placed first: Istiqlal's own pin sits 10 m from
        // its library's, and the library won the collision.
        pois.layout['symbol-sort-key'] = ['case', NAMED_LANDMARK, -1, ['get', 'min_zoom']]
      }
      pois.filter = ['all', LANDMARK_FILTER, ['>=', ['zoom'], ['+', ['get', 'min_zoom'], 0]]]
    }
  }
  // Light and dark: opaque buildings, as Apple's; Protomaps blends them at
  // half opacity, which left them a ghost of the ground in dark.
  if (bakedRoads.kind === 'apple') {
    const buildings = layers.find(l => l.id === 'buildings')
    if (buildings?.type === 'fill' && buildings.paint) buildings.paint['fill-opacity'] = 1
  }
  // Light and dark: the ground's own close-up shade, faded in like the roads.
  if (bakedRoads.kind === 'apple' && bakedRoads.palette.earthNear) {
    const earth = layers.find(l => l.id === 'earth')
    if (earth?.type === 'fill' && earth.paint) earth.paint['fill-color'] = ['interpolate', ['linear'], ['zoom'], 12, flavor.earth, NEAR_FROM_ZOOM - 1, bakedRoads.palette.earthNear]
  }
  // Each level's baked roads right above that level's basemap roads.
  const baked = (level: 'ground' | 'bridge') => bakedRoads.kind === 'jp' ? jpLayers(level) : appleRoadLayers(level, bakedRoads.palette)
  layers.splice(layers.findIndex(l => l.id === 'roads_highway') + 1, 0, ...baked('ground'))
  layers.splice(layers.findIndex(l => l.id === 'roads_bridges_highway') + 1, 0, ...baked('bridge'))

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
      [SOURCE]: { type: 'vector', url: `${origin}/${tileset}.json` },
      [ROADS_SOURCE]: { type: 'vector', url: `${origin}/${JP_ROADS.tileset}.json` }
    },
    layers
  }
}
