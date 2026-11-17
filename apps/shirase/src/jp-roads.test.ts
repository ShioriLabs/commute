import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Color, createExpression, featureFilter, v8, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { APPLE_DARK, APPLE_LIGHT, NEAR_FROM_ZOOM } from './flavors'
import { JP_ROADS, jpLayers, metresWide, PAVING_ORDER, ROADS_SOURCE } from './jp-roads'
import { appleRoadLayers, CASINGS_FROM, ROAD_WIDTH, scaleWidth } from './roads'
import POIS from './pois.json'
import { buildStyle, LANDMARK_POIS, OVERLAY_LAYER_ID, THEMES, type Theme } from './style'

const options = { origin: 'https://shirase.example', tileset: 'jabodetabek-20261114' }

/*
 * The ordinance's ranges (道路標識、区画線及び道路標示に関する命令 別表第四/第六,
 * figures in metres). The spec must sit inside them; the circular's standard
 * values do.
 */
describe('jp-roads.json against the ordinance', () => {
  const lines = JP_ROADS.rows.flatMap(row => row.lines.map(line => ({ row: row.id, ...line })))

  it('keeps every stripe width within 0.10–0.20 m', () => {
    for (const line of lines) {
      expect(line.widthM, `${line.row}: ${line.ref}`).toBeGreaterThanOrEqual(0.10)
      expect(line.widthM, `${line.row}: ${line.ref}`).toBeLessThanOrEqual(0.20)
    }
  })

  it('keeps every dash 3–10 m long with a gap of 1.0–2.0 times it', () => {
    for (const line of lines) {
      if (!('dash' in line) || !line.dash) continue
      const [painted, gap] = line.dash as [number, number]
      expect(painted, line.row).toBeGreaterThanOrEqual(3)
      expect(painted, line.row).toBeLessThanOrEqual(10)
      expect(gap / painted, line.row).toBeGreaterThanOrEqual(1)
      expect(gap / painted, line.row).toBeLessThanOrEqual(2)
    }
  })

  it('draws a centre line only where the carriageway is at least 5.5 m (別表第三)', () => {
    for (const row of JP_ROADS.rows) {
      const hasCentre = row.lines.some(l => l.offsetM === 0 || (l.offsetM < 1 && l.colour === 'yellow'))
      if (row.oneway !== 'yes' && hasCentre) expect(row.widthM - 1, row.id).toBeGreaterThanOrEqual(5.5)
    }
    expect(JP_ROADS.rows.find(r => r.id === 'local')?.lines.every(l => l.offsetM > 1)).toBe(true)
  })

  it('keeps every stripe on the road', () => {
    for (const row of JP_ROADS.rows) {
      for (const line of row.lines) expect(line.offsetM + line.widthM / 2, row.id).toBeLessThanOrEqual(row.widthM / 2)
    }
  })

  it('names every colour it uses', () => {
    for (const row of JP_ROADS.rows) {
      expect(JP_ROADS.colours, row.id).toHaveProperty(row.background)
      for (const line of row.lines) expect(JP_ROADS.colours, row.id).toHaveProperty(line.colour)
    }
  })
})

describe('metresWide', () => {
  it('converts metres to pixels at Jakarta latitude, doubling per zoom', () => {
    const [, , , z17, px17, z24, px24] = metresWide(10, 17) as [string, unknown, unknown, number, number, number, number]
    expect(z17).toBe(17)
    // 10 m at z17: 78,271.517 m/px at z0 on the equator, × cos 6.2°, ÷ 2^17.
    expect(px17).toBeCloseTo(10 * 2 ** 17 / (78271.517 * Math.cos(6.2 * Math.PI / 180)), 2)
    // Rounded to 0.001 px at each end, so the ratio is exact to about 1e-5.
    expect(Math.abs(px24 / px17 / 2 ** (z24 - z17) - 1)).toBeLessThan(1e-4)
  })
})

describe('jp layers', () => {
  it('styles the baked surface and paint, one pair per level, from minzoom, without the kerbs', () => {
    for (const level of ['ground', 'bridge'] as const) {
      const [surface, paint] = jpLayers(level)
      const l = level === 'ground' ? 'g' : 'b'
      expect(surface).toMatchObject({ 'id': `jp-surface-${level}`, 'type': 'fill', 'source': ROADS_SOURCE, 'source-layer': 'surface', 'minzoom': JP_ROADS.minzoom, 'filter': ['all', ['==', ['get', 'l'], l], ['!', ['in', ['get', 'p'], ['literal', ['sidewalk', 'busway', 'median', 'divider']]]]] })
      expect(paint).toMatchObject({ 'id': `jp-paint-${level}`, 'type': 'line', 'source': ROADS_SOURCE, 'source-layer': 'paint', 'minzoom': JP_ROADS.minzoom, 'filter': ['all', ['==', ['get', 'l'], l], ['!=', ['get', 'k'], 'kerb']] })
    }
  })

  it('draws bus-lane paving over highway paving over the asphalt', () => {
    const surface = jpLayers('ground')[0]!
    expect(surface.type === 'fill' && surface.layout?.['fill-sort-key']).toEqual(PAVING_ORDER)
    expect(PAVING_ORDER).toEqual(['match', ['get', 'p'], ['busLane', 'busway'], 2, 'highway', 1, 0])
  })

  it('colours from the spec palette and sizes stripes true from trueFromZoom, bolder at minzoom', () => {
    const paint = jpLayers('ground')[1]!
    if (paint.type !== 'line') throw new Error('paint is a line layer')
    const colour = paint.paint?.['line-color'] as unknown[]
    for (const [name, hex] of Object.entries(JP_ROADS.colours)) {
      expect(colour[colour.indexOf(name) + 1]).toBe(hex)
    }
    const width = paint.paint?.['line-width'] as [string, unknown, unknown, number, [string, unknown, number], number, [string, unknown, number]]
    const [, , , zMin, atMin, zTrue, atTrue] = width
    expect(zMin).toBe(JP_ROADS.minzoom)
    expect(zTrue).toBe(JP_ROADS.trueFromZoom)
    const [, , , , onePx17] = metresWide(1, JP_ROADS.minzoom) as [string, unknown, unknown, number, number]
    const [, , , , onePx20] = metresWide(1, JP_ROADS.trueFromZoom) as [string, unknown, unknown, number, number]
    expect(atMin[2]).toBeCloseTo(onePx17 * JP_ROADS.boldStripeFactor, 2)
    expect(atTrue[2]).toBeCloseTo(onePx20, 2)
  })
})

describe('every theme', () => {
  for (const theme of Object.keys(THEMES) as Theme[]) {
    const style = buildStyle({ ...options, theme })
    const ids = style.layers.map(l => l.id)
    const baked = theme === 'jp' ? ['jp-surface', 'jp-paint'] : ['roads-surface', 'roads-median', 'roads-kerb']

    it(`${theme}: is a valid MapLibre style reading the baked roads from their versioned tileset`, () => {
      expect(validateStyleMin(style)).toEqual([])
      expect(style.sources[ROADS_SOURCE]).toEqual({ type: 'vector', url: `https://shirase.example/${JP_ROADS.tileset}.json` })
      // A release name, or a dev one while iterating locally (README: never upload a dev name).
      expect(JP_ROADS.tileset).toMatch(/^roads-(dev-)?v\d+$/)
    })

    it(`${theme}: puts each level's baked roads right above its basemap roads, under the overlay slot`, () => {
      // Light and dark draw their baked tunnels first, under the ground roads.
      const ground = [...(theme === 'jp' ? [] : ['roads-tunnel']), ...baked.map(b => `${b}-ground`)]
      expect(ids.slice(ids.indexOf('roads_highway') + 1, ids.indexOf('roads_highway') + 1 + ground.length)).toEqual(ground)
      expect(ids.slice(ids.indexOf('roads_bridges_highway') + 1, ids.indexOf('roads_bridges_highway') + 1 + baked.length)).toEqual(baked.map(b => `${b}-bridge`))
      const overlay = ids.indexOf(OVERLAY_LAYER_ID)
      for (const id of ids.filter(i => baked.some(b => i.startsWith(b)))) expect(ids.indexOf(id)).toBeLessThan(overlay)
    })

    it(`${theme}: stops the basemap's own road lines where the baked surfaces take over`, () => {
      const replaced = style.layers.filter(l => /^roads_(bridges_)?(minor|minor_service|major|highway|link)(_casing(_early|_late)?)?$/.test(l.id))
      expect(replaced.map(l => l.id)).toEqual(expect.arrayContaining(['roads_minor', 'roads_major', 'roads_highway', 'roads_link', 'roads_bridges_major', 'roads_major_casing_late']))
      // By minzoom at the latest; some already stop earlier in Protomaps' own style.
      for (const l of replaced) expect(l.maxzoom, l.id).toBeLessThanOrEqual(JP_ROADS.minzoom)
      // Paths, rail and runways keep their lines; tunnels too, except where light and dark bake them.
      const kept = style.layers.filter(l => /^roads_(other|tunnels_|rail|pier|runway)/.test(l.id)
        && !(theme !== 'jp' && /^roads_tunnels_(minor|minor_service|major|highway|link)(_casing)?$/.test(l.id)))
      for (const l of kept) expect(l.maxzoom ?? 24, l.id).toBeGreaterThan(JP_ROADS.minzoom)
    })

    it(`${theme}: never draws the basemap lines of roads the bake leaves out`, () => {
      for (const id of ['roads_minor_service', 'roads_minor_service_casing', 'roads_bridges_minor']) {
        const layer = style.layers.find(l => l.id === id)
        if (layer?.type !== 'line') throw new Error(`${id} is a line layer`)
        const filter = featureFilter(layer.filter)
        const shows = (zoom: number, properties: Record<string, unknown>) =>
          filter.filter({ zoom }, { type: 2, properties: { kind: 'minor_road', ...properties } } as never)
        expect(shows(15, { kind_detail: 'service' }), id).toBe(false)
        expect(shows(15, { kind_detail: 'service', access: 'private', name: 'Jalan Gedung' }), id).toBe(false)
        if (id !== 'roads_bridges_minor') expect(shows(15, { kind_detail: 'service', name: 'Jalan Martapura' }), id).toBe(true)
      }
    })

    it(`${theme}: drops basemap arrows and names for the roads the bake leaves out, from minzoom only`, () => {
      for (const id of ['roads_oneway', 'roads_labels_minor']) {
        const layer = style.layers.find(l => l.id === id)
        if (layer?.type !== 'symbol') throw new Error(`${id} is a symbol layer`)
        const filter = featureFilter(layer.filter)
        const shows = (zoom: number, properties: Record<string, unknown>) =>
          filter.filter({ zoom }, { type: 2, properties: { kind: 'minor_road', oneway: 'yes', ...properties } } as never)
        expect(shows(18, { kind_detail: 'service', name: 'Jalan Gedung', access: 'private' }), id).toBe(false)
        expect(shows(18, { kind_detail: 'residential', name: 'Jalan Lamandau', access: 'private' }), id).toBe(true)
        expect(shows(18, { kind_detail: 'service' }), id).toBe(false)
        expect(shows(18, { kind_detail: 'service', name: 'Jalan Martapura' }), id).toBe(true)
        expect(shows(18, { kind_detail: 'residential', name: 'Jalan Sawo' }), id).toBe(true)
        // Below minzoom the basemap still draws those roads, so their symbols stay.
        expect(shows(16, { kind_detail: 'service' }), id).toBe(true)
      }
    })
  }

  it('jp keeps the plain light sprite and Protomaps\' own light colours', () => {
    const jp = buildStyle({ ...options, theme: 'jp' })
    expect(jp.sprite).toBe('https://shirase.example/sprites/light')
    const earth = jp.layers.find(l => l.id === 'earth')
    expect(earth?.type === 'fill' && earth.paint?.['fill-color']).toBe('#e2dfda')
  })
})

/* WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('place icons (src/pois.json)', () => {
  const MAKI = path.join(path.dirname(createRequire(import.meta.url).resolve('@mapbox/maki/package.json')), 'icons')

  it('names a Maki glyph that exists, and a category, for every kind', () => {
    for (const [kind, [icon, category]] of Object.entries(POIS.kinds)) {
      expect(existsSync(path.join(MAKI, `${icon}.svg`)), `${kind}: ${icon}`).toBe(true)
      expect(POIS.categories, kind).toHaveProperty(category!)
    }
  })

  it('never draws a hospital on red (the protected Red Cross emblem)', () => {
    const [, category] = POIS.kinds.hospital
    const [r, g, b] = [1, 3, 5].map(i => parseInt(POIS.categories[category as keyof typeof POIS.categories].circle.slice(i, i + 2), 16))
    expect(g! > r! && g! > b!, 'a green circle').toBe(true)
  })

  it('keeps a white glyph readable on every category circle (3:1, non-text)', () => {
    for (const [name, { circle }] of Object.entries(POIS.categories)) expect(contrast('#ffffff', circle), name).toBeGreaterThanOrEqual(3)
  })
})

describe('light and dark: Apple Maps-like', () => {
  for (const [theme, palette] of [['light', APPLE_LIGHT], ['dark', APPLE_DARK]] as const) {
    const style = buildStyle({ ...options, theme })

    it(`${theme}: draws baked surfaces in the palette and only the kerb outline, never markings`, () => {
      const [tunnel, surface, , kerb] = appleRoadLayers('ground', palette)
      expect(tunnel).toMatchObject({ id: 'roads-tunnel', type: 'fill', filter: ['==', ['get', 'l'], 't'], paint: { 'fill-color': palette.tunnel } })
      if (surface?.type !== 'fill' || kerb?.type !== 'line') throw new Error('a fill and a line')
      expect(surface.paint?.['fill-color']).toEqual(['match', ['get', 'p'], 'busway', palette.busLane, 'highway', palette.highway, 'sidewalk', palette.pavement, palette.surface])
      // Whole busways, never jp's lanes cut at junctions; medians in a layer of their own.
      expect(surface.filter).toEqual(['all', ['==', ['get', 'l'], 'g'], ['!', ['in', ['get', 'p'], ['literal', ['busLane', 'median', 'divider']]]]])
      // Medians over the surfaces, a layer above: MapLibre draws a fill layer's
      // antialiased outlines after all its fills, so the asphalt's edge round an
      // island taken into a median drew a hairline across it within one layer.
      const medians = style.layers.find(l => l.id === 'roads-median-ground')
      if (medians?.type !== 'fill') throw new Error('a fill')
      expect(medians.filter).toEqual(['all', ['==', ['get', 'l'], 'g'], ['in', ['get', 'p'], ['literal', ['median', 'divider']]]])
      expect(medians.paint?.['fill-color']).toEqual(['match', ['get', 'p'], 'median', palette.median, palette.divider])
      expect(style.layers.findIndex(l => l.id === 'roads-median-ground')).toBe(style.layers.findIndex(l => l.id === 'roads-surface-ground') + 1)
      expect(surface.layout?.['fill-sort-key']).toEqual(PAVING_ORDER)
      expect(kerb.filter).toEqual(['all', ['==', ['get', 'l'], 'g'], ['==', ['get', 'k'], 'kerb']])
      expect(kerb.paint?.['line-color']).toBe(palette.kerb)
      expect(style.layers.some(l => l.id.startsWith('jp-'))).toBe(false)
    })

    it(`${theme}: fades the basemap roads to the baked colours before the handover`, () => {
      const colourAt = (id: string, zoom: number) => {
        const layer = style.layers.find(l => l.id === id)
        if (layer?.type !== 'line') throw new Error(`${id} is a line layer`)
        const value = createExpression(layer.paint?.['line-color'], v8.paint_line['line-color'] as never)
        if (value.result !== 'success') throw new Error(`${id}: ${JSON.stringify(value.value)}`)
        return String(value.value.evaluate({ zoom }))
      }
      const css = (hex: string) => String(Color.parse(hex))
      for (const id of ['roads_minor', 'roads_major', 'roads_link', 'roads_bridges_major']) {
        expect(colourAt(id, NEAR_FROM_ZOOM), id).toBe(css(palette.surface))
      }
      expect(colourAt('roads_highway', NEAR_FROM_ZOOM)).toBe(css(palette.highway))
      expect(colourAt('roads_major_casing_late', NEAR_FROM_ZOOM)).toBe(css(palette.kerb))
      // Across the city, Apple's thin road lines; from z14, the flavor's roads.
      expect(colourAt('roads_major', 11)).toBe(css(palette.city.road))
      expect(colourAt('roads_highway', 11)).toBe(css(palette.city.highway))
      expect(colourAt('roads_minor', 11)).toBe(css(palette.city.minor))
      expect(colourAt('roads_major', 15)).toBe(css(palette.flavor.major))
      expect(colourAt('roads_highway', 15)).toBe(css(palette.flavor.highway))
    })

    it(`${theme}: draws roads without casings across the city, wider main roads, casings matching them`, () => {
      const line = (id: string) => {
        const layer = style.layers.find(l => l.id === id)
        if (layer?.type !== 'line') throw new Error(`${id} is a line layer`)
        return layer
      }
      expect(style.layers.some(l => l.id.endsWith('_casing_early'))).toBe(false)
      for (const l of style.layers.filter(l => /^roads_(bridges_)?(minor|minor_service|major|highway|link)_casing/.test(l.id))) {
        expect(l.minzoom, l.id).toBeGreaterThanOrEqual(CASINGS_FROM)
      }
      const jp = buildStyle({ ...options, theme: 'jp' })
      const jpLine = (id: string) => jp.layers.find(l => l.id === id) as { paint: Record<string, unknown> }
      for (const [fill, casing, kind] of [['roads_major', 'roads_major_casing_late', 'major'], ['roads_highway', 'roads_highway_casing_late', 'highway']] as const) {
        expect(line(fill).paint?.['line-width'], fill).toEqual(scaleWidth(jpLine(fill).paint['line-width'], ROAD_WIDTH[kind]))
        // A casing's gap is its road: both grow alike, or the edge drifts off.
        expect(line(casing).paint?.['line-gap-width'], casing).toEqual(scaleWidth(jpLine(casing).paint['line-gap-width'], ROAD_WIDTH[kind]))
      }
    })

    it(`${theme}: keeps road labels readable against their halos`, () => {
      const f = palette.flavor
      expect(contrast(f.roads_label_minor, f.roads_label_minor_halo)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(f.roads_label_major, f.roads_label_major_halo)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(f.city_label, f.city_label_halo)).toBeGreaterThanOrEqual(4.5)
    })

    it(`${theme}: stops drawing sidewalk and pedestrian-street lines where the pavement takes over`, () => {
      // Plazas are the pavement's colour too.
      expect(palette.flavor.pedestrian).toBe(palette.pavement)
      const paths = style.layers.find(l => l.id === 'roads_other')
      if (paths?.type !== 'line') throw new Error('roads_other is a line layer')
      const filter = featureFilter(paths.filter)
      const shows = (zoom: number, kind_detail: string) => filter.filter({ zoom }, { type: 2, properties: { kind: 'path', kind_detail } } as never)
      expect(shows(16, 'sidewalk')).toBe(true)
      expect(shows(JP_ROADS.minzoom, 'sidewalk')).toBe(false)
      expect(shows(JP_ROADS.minzoom, 'pedestrian')).toBe(false)
      expect(shows(JP_ROADS.minzoom, 'footway')).toBe(true)
    })

    it(`${theme}: draws footbridges as a translucent deck with a rim beside it, never over it`, () => {
      const deck = style.layers.find(l => l.id === 'roads_bridges_foot')
      const rim = style.layers.find(l => l.id === 'roads_bridges_foot_casing')
      if (deck?.type !== 'line' || rim?.type !== 'line') throw new Error('footbridges are lines')
      expect(deck.paint?.['line-color']).toBe(palette.footbridge.deck)
      expect(rim.paint?.['line-color']).toBe(palette.footbridge.rim)
      expect(deck.paint?.['line-opacity']).toBeLessThan(1)
      // The rim sits beside a gap exactly the deck's width.
      expect(rim.paint?.['line-gap-width']).toEqual(deck.paint?.['line-width'])
      // True to scale up close: 3 m at z20.
      const width = createExpression(deck.paint?.['line-width'], v8.paint_line['line-width'] as never)
      if (width.result !== 'success') throw new Error(JSON.stringify(width.value))
      const px = width.value.evaluate({ zoom: 20 } as never) as number
      expect(px / (2 ** 20 / (78271.517 * Math.cos((6.2 * Math.PI) / 180)))).toBeCloseTo(3, 1)
      // Footpaths only: a busway on a bridge (Protomaps' `other` too) keeps the basemap's look.
      const shows = (id: string, kind: string) => {
        const layer = style.layers.find(l => l.id === id)
        if (layer?.type !== 'line') throw new Error(id)
        return featureFilter(layer.filter).filter({ zoom: 18 }, { type: 2, properties: { kind, is_bridge: true } } as never)
      }
      expect(shows('roads_bridges_foot', 'path')).toBe(true)
      expect(shows('roads_bridges_foot', 'other')).toBe(false)
      expect(shows('roads_bridges_other', 'other')).toBe(true)
      expect(shows('roads_bridges_other', 'path')).toBe(false)
      // A JPO's stairs (highway=steps, never tagged bridge) are part of it, and leave the ground paths.
      const steps = (id: string) => {
        const layer = style.layers.find(l => l.id === id)
        if (layer?.type !== 'line') throw new Error(id)
        return featureFilter(layer.filter).filter({ zoom: 18 }, { type: 2, properties: { kind: 'path', kind_detail: 'steps' } } as never)
      }
      expect(steps('roads_bridges_foot')).toBe(true)
      expect(steps('roads_other')).toBe(false)
      // Up close the baked deck takes over: one shape, translucent, its outline the rim.
      expect(deck.maxzoom).toBe(JP_ROADS.minzoom)
      const baked = style.layers.find(l => l.id === 'roads-footbridge')
      const bakedRim = style.layers.find(l => l.id === 'roads-footbridge-rim')
      if (baked?.type !== 'fill' || bakedRim?.type !== 'line') throw new Error('a fill and a line')
      expect(baked.filter).toEqual(['all', ['==', ['get', 'l'], 'f'], ['==', ['get', 'p'], 'footbridge']])
      expect(baked.paint?.['fill-color']).toBe(palette.footbridge.deck)
      expect(baked.paint?.['fill-opacity']).toBeLessThan(1)
      expect(bakedRim.filter).toEqual(['all', ['==', ['get', 'l'], 'f'], ['==', ['get', 'k'], 'kerb']])
      // Over the ground roads, under the bridges.
      const at = (id: string) => style.layers.findIndex(l => l.id === id)
      expect(at('roads-footbridge')).toBeGreaterThan(at('roads-kerb-ground'))
      expect(at('roads-footbridge')).toBeLessThan(at('roads-surface-bridge'))
    })

    it(`${theme}: names a merged divided road once, on its centre line, where the basemap named each carriageway`, () => {
      const merged = style.layers.find(l => l.id === 'roads-label-merged')
      if (merged?.type !== 'symbol') throw new Error('a symbol layer')
      expect(merged.source).toBe(ROADS_SOURCE)
      expect(merged['source-layer']).toBe('label')
      expect(merged.minzoom).toBe(JP_ROADS.minzoom)
      expect(merged.layout?.['text-field']).toEqual(['get', 'name'])
      // Styled as the basemap's main-road names.
      const major = style.layers.find(l => l.id === 'roads_labels_major')
      if (major?.type !== 'symbol') throw new Error('a symbol layer')
      expect(merged.layout?.['text-font']).toEqual(major.layout?.['text-font'])
      // No halo over the median it runs on.
      expect(merged.paint?.['text-halo-width']).toBe(0)
      // The basemap's names for those roads give way from minzoom (inside the stretches).
      expect(JSON.stringify(major.filter)).toContain('within')
      expect(JSON.stringify(major.filter)).toContain(JP_ROADS.merge.stretches[0]!.name)
    })

    it(`${theme}: labels landmarks only, not the long tail of shops`, () => {
      const pois = style.layers.find(l => l.id === 'pois')
      if (pois?.type !== 'symbol') throw new Error('pois is a symbol layer')
      const filter = featureFilter(pois.filter)
      const shows = (kind: string) => filter.filter({ zoom: 18 }, { type: 1, properties: { kind, min_zoom: 16 } } as never)
      for (const kind of ['station', 'museum', 'park', 'university', 'stadium']) expect(shows(kind), kind).toBe(true)
      for (const kind of ['cafe', 'restaurant', 'fast_food', 'convenience', 'supermarket', 'post_office', 'bus_stop', 'school', 'bench']) expect(shows(kind), kind).toBe(false)
      // Places of worship: only the landmarks named, not every neighbourhood masjid.
      const worship = (name: string) => filter.filter({ zoom: 18 }, { type: 1, properties: { kind: 'place_of_worship', name, min_zoom: 15 } } as never)
      expect(worship('Masjid Istiqlal')).toBe(true)
      expect(worship('Katedral Jakarta')).toBe(true)
      expect(worship('Masjid Al Hidayah')).toBe(false)
      // Protomaps' own zoom rule still holds.
      expect(filter.filter({ zoom: 15 }, { type: 1, properties: { kind: 'museum', min_zoom: 16 } } as never)).toBe(false)
    })

    it(`${theme}: draws each landmark with its own icon, ringed in the label halo`, () => {
      const pois = style.layers.find(l => l.id === 'pois')
      if (pois?.type !== 'symbol') throw new Error('pois is a symbol layer')
      expect(pois.layout?.['icon-image']).toEqual(['concat', 'poi-', ['get', 'kind']])
      expect(pois.layout?.['text-font']).toEqual(['PT Sans Bold'])
      // Named landmarks first: Istiqlal over its own library, 10 m away.
      const sortKey = createExpression(pois.layout?.['symbol-sort-key'], v8.layout_symbol['symbol-sort-key'] as never)
      if (sortKey.result !== 'success') throw new Error(JSON.stringify(sortKey.value))
      const keyOf = (kind: string, name: string) => sortKey.value.evaluate({ zoom: 17 }, { type: 1, properties: { kind, name, min_zoom: 14 } } as never) as number
      expect(keyOf('place_of_worship', 'Masjid Istiqlal')).toBeLessThan(keyOf('library', 'Perpustakaan Masjid Istiqlal'))
      expect(pois.paint?.['text-halo-width']).toBe(1.5)
      expect(POIS.themes[theme].ring).toBe(palette.poiHalo)
    })

    it(`${theme}: names streets in Narrow Bold`, () => {
      for (const id of ['roads_labels_minor', 'roads_labels_major']) {
        const layer = style.layers.find(l => l.id === id)
        expect(layer?.type === 'symbol' && layer.layout?.['text-font'], id).toEqual(['PT Sans Narrow Bold'])
        const major = id === 'roads_labels_major'
        expect(layer?.type === 'symbol' && layer.layout?.['text-letter-spacing'], id).toBe(major ? 0.12 : 0.05)
        expect(layer?.type === 'symbol' && layer.layout?.['text-transform'], id).toBe(major ? 'uppercase' : undefined)
      }
    })

    it(`${theme}: draws buildings opaque in the palette's colour`, () => {
      const buildings = style.layers.find(l => l.id === 'buildings')
      expect(buildings?.type === 'fill' && buildings.paint).toMatchObject({ 'fill-color': palette.flavor.buildings, 'fill-opacity': 1 })
    })

    it(`${theme}: keeps every landmark label readable against its halo`, () => {
      const pois = style.layers.find(l => l.id === 'pois')
      if (pois?.type !== 'symbol') throw new Error('pois is a symbol layer')
      expect(pois.paint?.['text-halo-color']).toBe(palette.poiHalo)
      const colour = createExpression(pois.paint?.['text-color'], v8.paint_symbol['text-color'] as never)
      if (colour.result !== 'success') throw new Error('bad text-color')
      for (const kind of LANDMARK_POIS) {
        const c = colour.value.evaluate({ zoom: 18 }, { type: 1, properties: { kind } } as never) as unknown as Color
        const hex = '#' + [c.r, c.g, c.b].map(v => Math.round((v / (c.a || 1)) * 255).toString(16).padStart(2, '0')).join('')
        expect(contrast(hex, palette.poiHalo), `${kind} ${hex}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${theme}: uses its own sprite and the palette's ground`, () => {
      expect(style.sprite).toBe(`https://shirase.example/sprites/${POIS.themes[theme].sprite}`)
      const earth = style.layers.find(l => l.id === 'earth')
      const colour = earth?.type === 'fill' ? earth.paint?.['fill-color'] : undefined
      if (palette.earthNear) expect(colour).toEqual(['interpolate', ['linear'], ['zoom'], 12, palette.flavor.earth, NEAR_FROM_ZOOM - 1, palette.earthNear])
      else expect(colour).toBe(palette.flavor.earth)
    })
  }
})
