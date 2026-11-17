import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec'
import spec from './jp-roads.json'

/*
 * The jp theme's roads: real road surfaces and Japanese road markings, baked
 * into their own tileset by scripts/build-jp-roads.mjs from the values in
 * jp-roads.json (where the sources in Japan's road markings ordinance live).
 * The surfaces merge at junctions and forks, and the markings stop where
 * roads meet, because that is computed once offline rather than drawn road
 * by road. This file only styles the result.
 *
 * Two layers per level of the network (ground, bridge), each right above that
 * level's basemap roads:
 *   surface  fill  asphalt, with bus-lane paving on top of it
 *   paint    line  every marking, coloured and sized from its own properties
 */

export const JP_ROADS = spec

/*
 * The source id of the baked roads (src/style.ts adds it). Every theme reads
 * the same tileset: jp its markings, light and dark (src/roads.ts) only the
 * surfaces and kerbs.
 */
export const ROADS_SOURCE = 'roads'

/** Surfaces drawn over the asphalt: bus lanes over highway paving over plain. */
export const PAVING_ORDER: ExpressionSpecification = ['match', ['get', 'p'], ['busLane', 'busway'], 2, 'highway', 1, 0]

/*
 * Metres to screen pixels at Jakarta's latitude: 512 px tiles put 78,271.517
 * m in a pixel at z0 on the equator, scaled by cos(latitude). One latitude for
 * the whole region is within 0.3% from Merak to Bekasi. Exponential base 2
 * between two zooms is exact at every zoom in between.
 */
const METRES_PER_PX_Z0 = 78271.517 * Math.cos((6.2 * Math.PI) / 180)
const MAX_ZOOM = 24

const pxPerMetre = (zoom: number) => 2 ** zoom / METRES_PER_PX_Z0
const round4 = (n: number) => Math.round(n * 10000) / 10000

export function metresWide(metres: number, fromZoom: number): ExpressionSpecification {
  const px = (zoom: number) => Math.round(metres * pxPerMetre(zoom) * 1000) / 1000
  return ['interpolate', ['exponential', 2], ['zoom'], fromZoom, px(fromZoom), MAX_ZOOM, px(MAX_ZOOM)]
}

/*
 * A marking's width from its `w` (metres). True to scale from trueFromZoom;
 * at minzoom, boldStripeFactor times wider, so a 0.15 m stripe still shows at
 * z17, easing between the two.
 */
function stripeWidth(): ExpressionSpecification {
  const at = (zoom: number, factor: number): ExpressionSpecification => ['*', ['get', 'w'], round4(pxPerMetre(zoom) * factor)]
  return [
    'interpolate', ['exponential', 2], ['zoom'],
    spec.minzoom, at(spec.minzoom, spec.boldStripeFactor),
    spec.trueFromZoom, at(spec.trueFromZoom, 1),
    MAX_ZOOM, at(MAX_ZOOM, 1)
  ]
}

const colourOf = (key: string): ExpressionSpecification => {
  const names = Object.keys(spec.colours) as (keyof typeof spec.colours)[]
  return ['match', ['get', key], ...names.flatMap(n => [n, spec.colours[n]]), spec.colours.asphalt] as unknown as ExpressionSpecification
}

/*
 * True for a basemap road the bake leaves out on purpose (unnamed roads of
 * `named` rows, and a row's hiddenAccess), so the basemap's arrows and names
 * for it can stop where its surface would have been, instead of floating
 * over empty ground (Grand Indonesia's lobby loops and parking aisles).
 */
export function jpLeftOut(): ExpressionSpecification {
  const rules = spec.rows.flatMap((row): ExpressionSpecification[] => {
    const why: ExpressionSpecification[] = []
    if ('named' in row && row.named) why.push(['!', ['has', 'name']])
    if ('hiddenAccess' in row && row.hiddenAccess) why.push(['in', ['get', 'access'], ['literal', row.hiddenAccess]])
    if (!why.length) return []
    return [['all', ['in', ['get', 'kind_detail'], ['literal', row.kindDetail]], ['any', ...why]]]
  })
  return ['any', ...rules]
}

export function jpLayers(level: 'ground' | 'bridge'): LayerSpecification[] {
  const l = level === 'ground' ? 'g' : 'b'
  return [
    {
      'id': `jp-surface-${level}`,
      'type': 'fill',
      'source': ROADS_SOURCE,
      'source-layer': 'surface',
      'minzoom': spec.minzoom,
      // Pavement is light and dark's (src/roads.ts); jp's streets end at the kerb.
      // Pavement and whole busways are light and dark's (src/roads.ts); jp's
      // streets end at the kerb and its bus lanes stop at junctions.
      'filter': ['all', ['==', ['get', 'l'], l], ['!', ['in', ['get', 'p'], ['literal', ['sidewalk', 'busway', 'median', 'divider']]]]],
      // Bus-lane paving over the asphalt it sits on.
      'layout': { 'fill-sort-key': PAVING_ORDER },
      'paint': { 'fill-color': colourOf('p') }
    },
    {
      'id': `jp-paint-${level}`,
      'type': 'line',
      'source': ROADS_SOURCE,
      'source-layer': 'paint',
      'minzoom': spec.minzoom,
      // Every marking but the kerb outline, which is light and dark's.
      'filter': ['all', ['==', ['get', 'l'], l], ['!=', ['get', 'k'], 'kerb']],
      'layout': { 'line-cap': 'butt', 'line-join': 'round' },
      'paint': { 'line-color': colourOf('c'), 'line-width': stripeWidth() }
    }
  ]
}
