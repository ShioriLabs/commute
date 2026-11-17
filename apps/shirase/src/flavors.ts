import { namedFlavor, type Flavor } from '@protomaps/basemaps'

/*
 * Light and dark, drawn the way Apple Maps draws Jakarta. Colours are sampled
 * from Apple Maps screenshots (whole city, and Bundaran HI up close, in both
 * modes; 2026-11-15):
 *
 *            ground   water    parks             far roads / highways    close-up roads / kerb / toll
 *   light    #f5f1ea  #8ddbf6  #d5efbd #c0e99f   #e0e3e6 / #c3c6cb       #e0e3e6 / #b5b7b9 / #b3b5b9
 *   dark     #314256  #1c347a  #005e5c (teal)    #7d8fa7 / #8296b7       #2e343f / -       / #1c2631
 * (cities, Bundaran HI, Semanggi and Monas.) Parks are one flat green
 * (#bfe89d light, #005d5b dark). Dark ground is #314256 across the city and
 * #374d64 up close (earthNear). Minor streets are fainter than
 * arterials from afar (white in light, #5d6d82 in dark).
 *
 * Highways stay in the streets' colour family, never yellow: a step
 * stronger as lines across the city, a step darker as surfaces up close. In dark, roads are LIGHTER than the ground as lines across the
 * city and DARKER than it as surfaces up close, so a road's colour cannot be
 * one value: each palette has far colours (Protomaps' road keys) and near
 * ones, and src/style.ts fades every basemap road from far to near by
 * NEAR_FROM_ZOOM, so the baked surfaces (src/roads.ts, from JP_ROADS.minzoom)
 * take over in the very colour the roads already have.
 *
 * Each flavor starts from Protomaps' own and overrides what it changes, so a
 * key a later @protomaps/basemaps adds still has a value.
 */

export interface Palette {
  flavor: Flavor
  /*
   * Roads across the whole city (z11), where they are thin solid lines with
   * no casing: a white street would vanish on the cream ground there. They
   * fade to the flavor's road colours by z14.
   */
  city: { road: string, minor: string, highway: string }
  /** The ground up close, where Apple's differs from its city-wide one (dark). */
  earthNear?: string
  /** Up close: road surfaces, toll roads, bus lanes, and the hairline kerb round them. */
  surface: string
  highway: string
  busLane: string
  kerb: string
  /** Inferred planted medians: a muted green, quieter than a park (it is a guess). */
  median: string
  /** A merged divided road's plain median, as Apple's: a raised strip a shade off the road. */
  divider: string
  /** Tunnels up close: a faded road, between the road and the ground. */
  tunnel: string
  /** Mapped sidewalks up close, as Apple's block edges: a shade off the ground. */
  pavement: string
  /*
   * Footbridges (JPO, skywalks): Apple's translucent deck over whatever is
   * below, with a slightly lighter rim. Drawn at FOOTBRIDGE_OPACITY.
   */
  footbridge: { deck: string, rim: string }
  /*
   * The halo behind place labels (Protomaps hard-codes its own ground
   * colour there). Every POI colour light and dark keep (LANDMARK_POIS)
   * clears WCAG 4.5:1 against it, tested.
   */
  poiHalo: string
}

/** How opaque a footbridge's deck and rim are: the ground and roads show through, as Apple's. */
export const FOOTBRIDGE_OPACITY = 0.7

/** Where basemap roads have finished fading from their far colour to their near one. */
export const NEAR_FROM_ZOOM = 16.5

const light = namedFlavor('light')
const dark = namedFlavor('dark')

/* The road keys of a flavor: minor streets fainter than arterials, highways their own. */
function roads(c: { road: string, roadFaint: string, path: string, casing: string, highway: string, highwayCasing: string, tunnel: string, tunnelCasing: string }) {
  return {
    other: c.path,
    minor_service: c.roadFaint,
    minor_a: c.roadFaint,
    minor_b: c.roadFaint,
    major: c.road,
    link: c.road,
    highway: c.highway,
    minor_service_casing: c.casing,
    minor_casing: c.casing,
    link_casing: c.casing,
    major_casing_early: c.casing,
    major_casing_late: c.casing,
    highway_casing_early: c.highwayCasing,
    highway_casing_late: c.highwayCasing,
    bridges_other: c.path,
    bridges_minor: c.roadFaint,
    bridges_link: c.road,
    bridges_major: c.road,
    bridges_highway: c.highway,
    bridges_other_casing: c.casing,
    bridges_minor_casing: c.casing,
    bridges_link_casing: c.casing,
    bridges_major_casing: c.casing,
    bridges_highway_casing: c.highwayCasing,
    tunnel_other: c.tunnel,
    tunnel_minor: c.tunnel,
    tunnel_link: c.tunnel,
    tunnel_major: c.tunnel,
    tunnel_highway: c.tunnel,
    tunnel_other_casing: c.tunnelCasing,
    tunnel_minor_casing: c.tunnelCasing,
    tunnel_link_casing: c.tunnelCasing,
    tunnel_major_casing: c.tunnelCasing,
    tunnel_highway_casing: c.tunnelCasing
  }
}

const LIGHT_EARTH = '#f6f3eb'

export const APPLE_LIGHT: Palette = {
  flavor: {
    ...light,
    background: '#ece8e0',
    earth: LIGHT_EARTH,
    // One flat green at every zoom for parks, woods and lawns (Monas), not
    // Protomaps' two-tone ramp. (`zoo` is Protomaps' key for military land.)
    park_a: '#bfe89d',
    park_b: '#bfe89d',
    wood_a: '#bfe89d',
    wood_b: '#bfe89d',
    scrub_a: '#bfe89d',
    scrub_b: '#bfe89d',
    zoo: '#ebe8e2',
    hospital: '#f8e6e3',
    school: '#f6eedc',
    industrial: '#eeebe6',
    // Plazas: the pavement's colour, one surface as in Apple (Akihabara).
    pedestrian: '#e8e7e3',
    military: '#ece9e3',
    aerodrome: '#e9e9ee',
    runway: '#d9dbe2',
    sand: '#f3ebd5',
    beach: '#f6edd2',
    glacier: '#ffffff',
    water: '#8ddbf6',
    // Apple's warm tan (Tokyo, light, iOS 26): blocks of buildings read as
    // cream shapes on the pale ground, where a grey-beige barely separated.
    buildings: '#f2e4c8',
    pier: '#ebe7df',
    ...roads({
      road: '#e0e3e6',
      roadFaint: '#ffffff',
      // Footpaths: faint grey on the park green, not white.
      path: '#dcdfe2',
      casing: '#ced1d4',
      highway: '#c3c6cb',
      highwayCasing: '#9a9ea4',
      tunnel: '#eceef2',
      tunnelCasing: '#d3d6de'
    }),
    railway: '#b0b4bd',
    boundaries: '#c9a3c9',
    roads_label_minor: '#5e6168',
    roads_label_minor_halo: '#ffffff',
    roads_label_major: '#45484e',
    roads_label_major_halo: '#ffffff',
    address_label: '#8a8d93',
    address_label_halo: LIGHT_EARTH,
    subplace_label: '#6e7178',
    subplace_label_halo: LIGHT_EARTH,
    city_label: '#303131',
    city_label_halo: LIGHT_EARTH,
    state_label: '#8e9197',
    state_label_halo: LIGHT_EARTH,
    country_label: '#7a7d83',
    ocean_label: '#3f8fc0',
    // Darkened where Protomaps' failed 4.5:1 on the cream ground.
    pois: { ...light.pois!, green: '#1b7543', lapis: '#2f57c6', slategray: '#5d4f80', pink: '#b8307f', blue: '#13739c', tangerine: '#a65303', red: '#c42950', turquoise: '#00798a' },
    landcover: {
      grassland: '#e2efc8',
      barren: '#f3eee1',
      urban_area: '#f2eee7',
      farmland: '#e6f0cf',
      glacier: '#ffffff',
      scrub: '#e1eec6',
      forest: '#cfeab0'
    }
  },
  city: { road: '#bcc2cd', minor: '#e7e6e5', highway: '#9aa0ae' },
  surface: '#e0e3e6',
  highway: '#b3b5b9',
  busLane: '#f5d6cf',
  pavement: '#e8e7e3',
  tunnel: '#eaebea',
  median: '#d3e6bf',
  // A guess, a step darker than the road, until a light Apple screenshot shows one.
  divider: '#cbcfd5',
  footbridge: { deck: '#ffffff', rim: '#c4c8ce' },
  poiHalo: LIGHT_EARTH,
  kerb: '#b5b7b9'
}

const DARK_EARTH = '#314256'

export const APPLE_DARK: Palette = {
  flavor: {
    ...dark,
    background: '#2b3a4d',
    earth: DARK_EARTH,
    park_a: '#005d5b',
    park_b: '#005d5b',
    wood_a: '#005d5b',
    wood_b: '#005d5b',
    scrub_a: '#005d5b',
    scrub_b: '#005d5b',
    zoo: '#34465a',
    hospital: '#46455f',
    school: '#3d4b62',
    industrial: '#34465a',
    pedestrian: '#3c516b',
    military: '#34465a',
    aerodrome: '#3a4f6c',
    runway: '#52637e',
    sand: '#424a55',
    beach: '#454c57',
    glacier: '#4a5a70',
    water: '#1d3580',
    // Apple's, sampled at Akihabara: clearly lifted off the ground.
    buildings: '#4e6888',
    pier: '#3b4d63',
    ...roads({
      road: '#7d8fa7',
      roadFaint: '#5d6d82',
      path: '#5d6a7f',
      casing: '#30425a',
      highway: '#8296b7',
      highwayCasing: '#30425a',
      tunnel: '#46586f',
      tunnelCasing: '#30425a'
    }),
    railway: '#6b7d98',
    boundaries: '#7d6a8e',
    roads_label_minor: '#b3bfd2',
    roads_label_minor_halo: '#2e343f',
    roads_label_major: '#d4dceb',
    roads_label_major_halo: '#2e343f',
    address_label: '#93a0b6',
    address_label_halo: DARK_EARTH,
    subplace_label: '#b8c3d4',
    subplace_label_halo: DARK_EARTH,
    city_label: '#dae4ed',
    city_label_halo: DARK_EARTH,
    state_label: '#8e9bb1',
    state_label_halo: DARK_EARTH,
    country_label: '#a3afc3',
    ocean_label: '#8fa8e6',
    // Light tints, as Apple's dark labels: Protomaps' were made for a
    // near-black ground and sank into the blue slate (Sudirman station).
    pois: { blue: '#7cc8ee', green: '#6ad9a0', lapis: '#9bb7ff', pink: '#f7a1d8', red: '#ffa3b5', slategray: '#bfc6d6', tangerine: '#ffb184', turquoise: '#6fe3ec' },
    landcover: {
      grassland: '#2d5f56',
      barren: '#3d4655',
      urban_area: '#34475d',
      farmland: '#2f5c55',
      glacier: '#4a5a70',
      scrub: '#2e5d56',
      forest: '#256659'
    }
  },
  city: { road: '#7487a0', minor: '#3d4f66', highway: '#889dbf' },
  earthNear: '#374d64',
  surface: '#2e343f',
  highway: '#1c2631',
  busLane: '#5a3439',
  pavement: '#3c516b',
  tunnel: '#323e52',
  median: '#2a5651',
  // Sampled from Apple's dark map (Shinanomachi, Route 319): #42495b on #2e343f.
  divider: '#42495b',
  // Sampled from Apple's dark map (Higashi-Kanda): #465a76 at ~70%.
  footbridge: { deck: '#465a76', rim: '#5b7192' },
  poiHalo: '#263044',
  kerb: '#262b34'
}
