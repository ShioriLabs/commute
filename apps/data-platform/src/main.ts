import './style.css'
import { NETWORK } from './network'
import { createGL } from './gl/context'
import {
  buildScene,
  HIGHLIGHT_CHAIN,
  MRT_FARE_FROM,
  MRT_FARE_TO
} from './scene/network-scene'
import { createCamera } from './gl/camera'
import { createRenderer } from './gl/renderer'
import { bandLayout, buildBeats, viewportLayout, type BeatId } from './scroll/beats'
import { createSectionDirector } from './scroll/section-director'
import { createDeparturesFlyout } from './overlay/departures'
import { createFareTag } from './overlay/fare-tag'
import { createChainLabels } from './overlay/chain-labels'
import { createStationCard } from './overlay/station-card'
import { createApiPanel } from './overlay/api-panel'
import { createRouteStrip } from './overlay/route-strip'
import { createCoveragePanel, toRailRoster, RAIL_OPERATOR_CYCLE } from './overlay/coverage-panel'
import { fetchManggaraiDepartures } from './data/departures-api'
import {
  fetchCorridorFare,
  fetchJourney,
  fetchOperators,
  fetchStationDetail,
  fetchStationTransfers
} from './data/network-api'
import { nextDepartures } from './data/next-departures'
import { applyLineColors } from './theme/line-colors'

// Default the page to its no-WebGL state, then promote it once a context is
// actually in hand (below). The attribute used to be written only INSIDE
// bootNetworkBackground(), which left it absent between parse and boot — so CSS
// keyed on `off` could not style the first paint, and a browser that fails at
// createGL after painting would never have been styled at all. Default-off then
// promote-on is the only ordering that cannot flash the wrong state.
document.documentElement.setAttribute('data-webgl', 'off')

// Line colours as CSS custom properties, from the baked network. Runs on both
// paths: the static evidence plates need their bars coloured with no WebGL.
applyLineColors()

// Smooth-scroll for in-page anchors. `block: 'center'` matters here: the nav
// links point at beat sections, each a full viewport tall, and the director
// anchors a beat when its CENTRE crosses the viewport centre. Aligning their top
// edge (scrollIntoView's default) would leave every jump one half-viewport short
// of the beat it named, with the camera still mid-transition on arrival.
document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const id = link.getAttribute('href')?.slice(1)
    if (!id) return
    const target = document.getElementById(id)
    if (!target) return
    event.preventDefault()
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
})

function bootNetworkBackground(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#network-bg')
  if (!canvas) return

  const ctx = createGL(canvas)
  if (!ctx) {
    // No WebGL2 (old browser / headless without GPU / --disable-webgl): leave
    // the page in its default `data-webgl="off"` state, which reveals the static
    // evidence plates (.sign-static in style.css) carrying the figures the
    // anchored overlays would have shown.
    return
  }
  document.documentElement.setAttribute('data-webgl', 'on')

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const scene = buildScene()

  // Below the md: breakpoint the seven content beats render the map into a fixed
  // IMAX-ish band at the top of the viewport, with their plates scrolling
  // underneath. hero and footer keep the whole viewport on every device. The
  // band is what bounds the anchored overlays on a phone — a 248px departures
  // card in a 390px viewport used to hang ~70px off the right edge.
  const BAND_BREAKPOINT = 768
  const bandActive = (): boolean => window.innerWidth < BAND_BREAKPOINT
  const layouts = (): [ReturnType<typeof viewportLayout>, ReturnType<typeof viewportLayout>] => {
    const full = viewportLayout(window.innerWidth, window.innerHeight)
    return [full, bandActive() ? bandLayout(window.innerWidth) : full]
  }

  // Only the content beats are banded; hero and footer are full-bleed.
  const BANDED_BEATS = new Set<BeatId>(['jadwal', 'topologi', 'tarif', 'stasiun', 'rute', 'cakupan', 'api'])
  // Tracked so a resize can re-evaluate the band on the CURRENT beat; the
  // director only reports a beat when it changes.
  let activeBeatId: BeatId | null = null
  function applyBand(id: BeatId): void {
    activeBeatId = id
    const on = bandActive() && BANDED_BEATS.has(id)
    const root = document.documentElement
    if (on === root.hasAttribute('data-map-band')) return
    if (on) root.setAttribute('data-map-band', '')
    else root.removeAttribute('data-map-band')
    // The canvas box just changed, so the GL viewport and projection aspect must
    // be re-derived before the next frame projects any overlay against them.
    renderer.resize()
  }

  const heroPose = buildBeats(scene, ...layouts())[0]!.pose

  const camera = createCamera(heroPose)
  camera.snap(heroPose)

  const overlayRoot = document.querySelector<HTMLElement>('#overlay-root')

  const manggarai = scene.stationWorld.get('KCI-MRI')
  const flyout
    = overlayRoot && manggarai
      ? createDeparturesFlyout(overlayRoot, manggarai, reduceMotion)
      : null

  // The fare tag sits at the MIDDLE of the priced corridor rather than on one
  // end: the price is a property of the whole run, and centring keeps it clear
  // of both endpoint roundels.
  const fareA = scene.stationWorld.get(MRT_FARE_FROM)
  const fareB = scene.stationWorld.get(MRT_FARE_TO)
  // The tag's left bar carries the priced line's own colour, read from the same
  // baked network the map draws — so the bar, the plate beside it and the lit
  // corridor cannot disagree.
  const mrtColor = NETWORK.lines.find(l => l.operator === 'MRTJ' && l.code === 'M')?.color
  const fareTag
    = overlayRoot && fareA && fareB
      ? createFareTag(
          overlayRoot,
          { x: (fareA.x + fareB.x) / 2, y: 0, z: (fareA.z + fareB.z) / 2 },
          reduceMotion,
          mrtColor
        )
      : null

  // Station-code plates on the topology beat's highlighted chain. Codes come
  // from the station IDs (KCI-SUD -> SUD), so they can't drift from the chain.
  const chainLabels = overlayRoot
    ? createChainLabels(
        overlayRoot,
        HIGHLIGHT_CHAIN.flatMap((id) => {
          const world = scene.stationWorld.get(id)
          return world ? [{ code: id.split('-')[1] ?? id, world }] : []
        }),
        reduceMotion
      )
    : null

  // Both of these anchor to Rasuna Said: the factoid card shows it as a record
  // at the stasiun beat, the API panel as raw JSON at the api beat. They must
  // never be visible together — see the beat gating in onActiveBeat below.
  const rasuna = scene.stationWorld.get('LRTJBDB-RAS')
  const stationCard
    = overlayRoot && rasuna
      ? createStationCard(overlayRoot, rasuna, reduceMotion)
      : null
  const apiPanel
    = overlayRoot && rasuna
      ? createApiPanel(
          overlayRoot,
          document.querySelector<HTMLElement>('[data-api-dock]'),
          rasuna,
          reduceMotion
        )
      : null

  // The rute beat's journey strip, anchored to the INTERCHANGE rather than an
  // endpoint. Cikoko and Cawang are diagonally adjacent cells on the lattice
  // (they really are ~220m apart), so the two lit legs visually touch and the
  // highlight alone can't show that you get off and walk. Anchoring the strip
  // here is what names the transfer.
  const interchange = scene.stationWorld.get('LRTJBDB-CKK')
  const routeStrip
    = overlayRoot && interchange
      ? createRouteStrip(
          overlayRoot,
          document.querySelector<HTMLElement>('[data-rute-dock]'),
          interchange,
          reduceMotion
        )
      : null

  // The cakupan beat's roster. Not anchored to anything: its subject is the
  // whole network, and the map points by lighting one operator at a time.
  const coveragePanel = overlayRoot
    ? createCoveragePanel(
        overlayRoot,
        document.querySelector<HTMLElement>('[data-cakupan-dock]'),
        reduceMotion
      )
    : null

  const renderer = createRenderer({
    gl: ctx.gl,
    canvas,
    scene,
    camera,
    reduceMotion,
    onFrame: (frameCtx) => {
      flyout?.update(frameCtx)
      fareTag?.update(frameCtx)
      chainLabels?.update(frameCtx)
      stationCard?.update(frameCtx)
      apiPanel?.update(frameCtx)
      routeStrip?.update(frameCtx)
      coveragePanel?.update(frameCtx)
    }
  })

  // Lazily load Manggarai departures the first time the schedule beat is near,
  // then refresh (cache TTL guards against spamming) on each re-entry.
  let departuresLoaded = false
  function loadDepartures(): void {
    if (!flyout) return
    flyout.setState({ kind: 'loading' })
    fetchManggaraiDepartures()
      .then((timetable) => {
        const rows = nextDepartures(timetable, 4)
        flyout.setState(rows.length ? { kind: 'ready', rows } : { kind: 'empty' })
      })
      .catch(() => flyout.setState({ kind: 'error' }))
  }

  let fareLoaded = false
  function loadFare(): void {
    if (!fareTag) return
    fareTag.setState({ kind: 'loading' })
    fetchCorridorFare()
      .then((fare) => {
        fareTag.setState({ kind: 'ready', fare })
      })
      .catch(() => fareTag.setState({ kind: 'error' }))
  }

  // Rasuna Said backs BOTH the factoid card and the API response panel, so one
  // fetch serves both; the transfers call is separate and optional.
  let stationLoaded = false
  function loadStation(): void {
    stationCard?.setState({ kind: 'loading' })
    apiPanel?.setState({ kind: 'loading' })
    fetchStationDetail()
      .then(async (station) => {
        apiPanel?.setState({ kind: 'ready', station })
        const transfers = await fetchStationTransfers().catch(() => [])
        stationCard?.setState({ kind: 'ready', station, transfers })
      })
      .catch(() => {
        // Both overlays fall back to readable content of their own; the plate
        // keeps whatever the markup already says.
        stationCard?.setState({ kind: 'error' })
        apiPanel?.setState({ kind: 'error' })
      })
  }

  let journeyLoaded = false
  function loadJourney(): void {
    if (!routeStrip) return
    routeStrip.setState({ kind: 'loading' })
    fetchJourney()
      .then((route) => {
        routeStrip.setState({ kind: 'ready', route })
      })
      .catch(() => routeStrip.setState({ kind: 'error' }))
  }

  let operatorsLoaded = false
  function loadOperators(): void {
    if (!coveragePanel) return
    coveragePanel.setState({ kind: 'loading' })
    fetchOperators()
      .then((operators) => {
        // The roster is filtered against the BAKED network, not just by operator:
        // the API also reports rail lines this map doesn't draw (KCI's airport
        // line), and listing one would show a row that never lights.
        const drawn = new Set(NETWORK.lines.map(l => `${l.operator}:${l.code}`))
        coveragePanel.setState({ kind: 'ready', operators: toRailRoster(operators, drawn) })
      })
      .catch(() => coveragePanel.setState({ kind: 'error' }))
  }

  const director = createSectionDirector({
    camera,
    renderer,
    reduceMotion,
    // Poses depend on aspect, so the director rebuilds them from the current
    // viewport whenever it needs them (initial + on resize).
    buildBeats: () => buildBeats(scene, ...layouts()),
    onActiveBeat: (id) => {
      // Band first: it resizes the canvas, and every overlay below projects
      // against that box on the frames that follow.
      applyBand(id)

      const onJadwal = id === 'jadwal'
      flyout?.setVisible(onJadwal)
      if (onJadwal && !departuresLoaded) {
        departuresLoaded = true
        loadDepartures()
      }

      const onTarif = id === 'tarif'
      fareTag?.setVisible(onTarif)
      if (onTarif && !fareLoaded) {
        fareLoaded = true
        loadFare()
      }

      // Chain codes belong to the topology beat only — that's what keeps them
      // from becoming the label clutter this page already removed once.
      chainLabels?.setVisible(id === 'topologi')
      // Mutually exclusive: both hang off the same roundel.
      stationCard?.setVisible(id === 'stasiun')
      apiPanel?.setVisible(id === 'api')

      // Fetch from the tarif beat onward: the station card wants data before the
      // reader arrives, and the API panel below reads the same response.
      if ((id === 'tarif' || id === 'stasiun' || id === 'api') && !stationLoaded) {
        stationLoaded = true
        loadStation()
      }

      const onRute = id === 'rute'
      routeStrip?.setVisible(onRute)
      // One beat early, same reasoning as the station fetch: the strip is the
      // whole point of the beat and shouldn't still be skeletons on arrival.
      if ((id === 'stasiun' || onRute) && !journeyLoaded) {
        journeyLoaded = true
        loadJourney()
      }

      const onCakupan = id === 'cakupan'
      coveragePanel?.setVisible(onCakupan)
      // Prefetch from `rute`, the beat BEFORE this one. (It used to key on `api`,
      // which was the preceding beat until api and cakupan swapped places; left
      // alone it would only have started loading after the roster was on screen.)
      if ((onRute || onCakupan) && !operatorsLoaded) {
        operatorsLoaded = true
        loadOperators()
      }
    },
    // The cakupan beat steps through one rail operator at a time; mark the
    // matching roster row so the panel and the lit lines never disagree.
    onHighlightSet: (highlight) => {
      const step = RAIL_OPERATOR_CYCLE.find(o => o.highlight === highlight)
      if (step) coveragePanel?.setActiveOperator(step.code)
    }
  })

  window.addEventListener('resize', () => {
    // Re-check the band before anything else: crossing the md: breakpoint (or
    // rotating a phone) changes the canvas box, and `director.refresh()` below
    // rebuilds poses from the layouts that box implies. Can't be left to
    // onActiveBeat — the director only fires that when the ACTIVE BEAT changes,
    // and a resize usually keeps the reader on the same beat.
    if (activeBeatId) applyBand(activeBeatId)
    renderer.resize()
    director.refresh()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) renderer.stop()
    else renderer.start()
  })

  director.start()
  renderer.start()

  // Expose for headed-browser verification (see plan's verification section).
  if (import.meta.env.DEV) {
    (window as unknown as { __commute?: unknown }).__commute = {
      camera,
      renderer,
      scene,
      director,
      loadDepartures,
      loadFare,
      loadStation
    }
  }
}

bootNetworkBackground()
