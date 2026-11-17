import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { Flavor } from '@protomaps/basemaps'
import { FOOTBRIDGE_OPACITY, NEAR_FROM_ZOOM, type Palette } from './flavors'
import { JP_ROADS, PAVING_ORDER, ROADS_SOURCE } from './jp-roads'

/*
 * Light and dark up close: the baked road surfaces (smooth curves, kerb
 * returns, merged junctions; scripts/build-jp-roads.mjs) in the palette's
 * colours, outlined by a hairline kerb. No lane markings: Apple Maps keeps a
 * city's roads plain so what is drawn over them reads first.
 *
 * Two layers per level (ground, bridge), at the same points in the style as
 * jp's, from the same zoom.
 */

/*
 * A hairline, not a width in metres: Apple's kerbs stay about a pixel at any
 * zoom, a touch firmer as roads grow.
 */
const KERB_WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], JP_ROADS.minzoom, 0.75, 20, 1.25, 24, 1.5]

export function appleRoadLayers(level: 'ground' | 'bridge', palette: Palette): LayerSpecification[] {
  const l = level === 'ground' ? 'g' : 'b'
  // Tunnels under the ground roads, faded: an underpass runs on beneath them.
  const tunnel: LayerSpecification[] = level === 'ground'
    ? [{
        'id': 'roads-tunnel',
        'type': 'fill',
        'source': ROADS_SOURCE,
        'source-layer': 'surface',
        'minzoom': JP_ROADS.minzoom,
        'filter': ['==', ['get', 'l'], 't'],
        'paint': { 'fill-color': palette.tunnel }
      }]
    : []
  return [
    ...tunnel,
    {
      'id': `roads-surface-${level}`,
      'type': 'fill',
      'source': ROADS_SOURCE,
      'source-layer': 'surface',
      'minzoom': JP_ROADS.minzoom,
      // Whole busways, not jp's lanes cut at every junction. Medians have a layer of their own, next.
      'filter': ['all', ['==', ['get', 'l'], l], ['!', ['in', ['get', 'p'], ['literal', ['busLane', 'median', 'divider']]]]],
      'layout': { 'fill-sort-key': PAVING_ORDER },
      'paint': {
        'fill-color': ['match', ['get', 'p'], 'busway', palette.busLane, 'highway', palette.highway, 'sidewalk', palette.pavement, palette.surface]
      }
    },
    /*
     * Medians and dividers over the road surfaces, in a layer of their own:
     * MapLibre draws a fill layer's antialiased outlines after all its fills,
     * so within one layer the asphalt's edge round an island taken into a
     * median drew a hairline across it.
     */
    {
      'id': `roads-median-${level}`,
      'type': 'fill',
      'source': ROADS_SOURCE,
      'source-layer': 'surface',
      'minzoom': JP_ROADS.minzoom,
      'filter': ['all', ['==', ['get', 'l'], l], ['in', ['get', 'p'], ['literal', ['median', 'divider']]]],
      'paint': { 'fill-color': ['match', ['get', 'p'], 'median', palette.median, palette.divider] }
    },
    {
      'id': `roads-kerb-${level}`,
      'type': 'line',
      'source': ROADS_SOURCE,
      'source-layer': 'paint',
      'minzoom': JP_ROADS.minzoom,
      'filter': ['all', ['==', ['get', 'l'], l], ['==', ['get', 'k'], 'kerb']],
      'layout': { 'line-join': 'round' },
      'paint': { 'line-color': palette.kerb, 'line-width': KERB_WIDTH }
    },
    ...(level === 'ground' ? footbridgeLayers(palette) : [])
  ]
}

/*
 * Footbridges up close: the baked deck (a JPO and its stairs as one shape,
 * level f) in its translucent colour, and its outline as the rim. Over the
 * ground roads, under the bridges. No antialiasing on the fill: its tile-clip
 * edges would draw as faint seams through a translucent deck; the rim covers
 * its real edges.
 */
function footbridgeLayers(palette: Palette): LayerSpecification[] {
  return [
    {
      'id': 'roads-footbridge',
      'type': 'fill',
      'source': ROADS_SOURCE,
      'source-layer': 'surface',
      'minzoom': JP_ROADS.minzoom,
      'filter': ['all', ['==', ['get', 'l'], 'f'], ['==', ['get', 'p'], 'footbridge']],
      'paint': { 'fill-color': palette.footbridge.deck, 'fill-opacity': FOOTBRIDGE_OPACITY, 'fill-antialias': false }
    },
    {
      'id': 'roads-footbridge-rim',
      'type': 'line',
      'source': ROADS_SOURCE,
      'source-layer': 'paint',
      'minzoom': JP_ROADS.minzoom,
      'filter': ['all', ['==', ['get', 'l'], 'f'], ['==', ['get', 'k'], 'kerb']],
      'layout': { 'line-join': 'miter' },
      'paint': { 'line-color': palette.footbridge.rim, 'line-opacity': FOOTBRIDGE_OPACITY, 'line-width': 1 }
    }
  ]
}

/*
 * Light and dark below the baked surfaces: Protomaps' road lines reshaped the
 * way Apple draws them.
 *   - No casings across the city: thin solid lines, in the palette's city
 *     colours. Casings come in at CASINGS_FROM, where roads are wide enough
 *     to need an edge (the `_casing_early` layers, which end before it, are
 *     removed in src/style.ts).
 *   - Wider main roads (ROAD_WIDTH; a casing's gap grows with its road), so
 *     arterials and toll roads carry the picture, as in Apple's city view,
 *     and the jump to true widths at the baked handover is smaller.
 *   - Colours: city (z11) → the flavor's road colour (z14, held until a zoom
 *     before NEAR_FROM_ZOOM) → the baked surfaces' close-up colour, so the
 *     surfaces take over in the colour the roads already have.
 */
export const CASINGS_FROM = 14

/*
 * Protomaps' `major` class is trunk down to tertiary: widened alike, every
 * tertiary street read as a main road and the city view was a dense mesh.
 * Apple's hierarchy: trunk and primary wide, secondary a little, tertiary
 * thinner than now (and faint across the city, see restyleAppleRoad).
 */
const MAJOR_WIDTH: ExpressionSpecification = ['match', ['get', 'kind_detail'], ['trunk', 'primary'], 1.6, 'secondary', 1.25, 0.85]

export const ROAD_WIDTH: Record<RoadClass, number | ExpressionSpecification> = { highway: 1.6, major: MAJOR_WIDTH, link: 1.3, minor: 1.15, minor_service: 1 }

type RoadClass = 'highway' | 'major' | 'link' | 'minor' | 'minor_service'

const classOf = (id: string): RoadClass => {
  const match = /^roads_(?:bridges_)?(minor_service|minor|major|highway|link)/.exec(id)
  if (!match) throw new Error(`not a road layer: ${id}`)
  return match[1] as RoadClass
}

/*
 * Every output of a zoom-interpolated width, times `factor`: a number, or a
 * per-feature expression (which MapLibre allows inside zoom stops).
 */
export function scaleWidth(width: unknown, factor: number | ExpressionSpecification): unknown {
  if (factor === 1 || width === undefined) return width
  const times = (v: number) => typeof factor === 'number' ? Math.round(v * factor * 1000) / 1000 : v === 0 ? 0 : ['*', v, factor]
  if (typeof width === 'number') return times(width)
  if (Array.isArray(width) && width[0] === 'interpolate') {
    return width.map((v, i) => (i >= 4 && (i - 4) % 2 === 0 && typeof v === 'number' ? times(v) : v))
  }
  throw new Error(`unhandled width ${JSON.stringify(width)}`)
}

export function restyleAppleRoad(layer: LayerSpecification, palette: Palette, flavor: Flavor): void {
  if (layer.type !== 'line' || !layer.paint) return
  const kind = classOf(layer.id)
  const factor = ROAD_WIDTH[kind]
  if (layer.id.includes('_casing')) {
    layer.minzoom = Math.max(layer.minzoom ?? 0, CASINGS_FROM)
    layer.paint['line-gap-width'] = scaleWidth(layer.paint['line-gap-width'], factor) as never
    layer.paint['line-color'] = ['interpolate', ['linear'], ['zoom'], NEAR_FROM_ZOOM - 1, layer.paint['line-color'] as string, NEAR_FROM_ZOOM, palette.kerb]
    return
  }
  layer.paint['line-width'] = scaleWidth(layer.paint['line-width'], factor) as never
  const far = { highway: flavor.highway, major: flavor.major, link: flavor.link, minor: flavor.minor_b, minor_service: flavor.minor_service }[kind]
  const city: string | ExpressionSpecification = kind === 'highway'
    ? palette.city.highway
    : kind === 'minor' || kind === 'minor_service'
      ? palette.city.minor
      : kind === 'major' ? ['match', ['get', 'kind_detail'], 'tertiary', palette.city.minor, palette.city.road] : palette.city.road
  const near = kind === 'highway' ? palette.highway : palette.surface
  layer.paint['line-color'] = ['interpolate', ['linear'], ['zoom'], 11, city, CASINGS_FROM, far, NEAR_FROM_ZOOM - 1, far, NEAR_FROM_ZOOM, near] as ExpressionSpecification
}
