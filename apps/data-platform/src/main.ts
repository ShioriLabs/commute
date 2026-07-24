import './style.css'
import { createGL } from './gl/context'
import {
  buildScene,
  HIGHLIGHT_CHAIN,
  MRT_FARE_FROM,
  MRT_FARE_TO
} from './scene/network-scene'
import { createCamera } from './gl/camera'
import { createRenderer } from './gl/renderer'
import { buildBeats } from './scroll/beats'
import { createSectionDirector } from './scroll/section-director'
import { createDeparturesFlyout } from './overlay/departures'
import { createFareTag } from './overlay/fare-tag'
import { createChainLabels } from './overlay/chain-labels'
import { createStationCard } from './overlay/station-card'
import { renderApiPanel, renderStationFacts } from './overlay/station-panel'
import { fetchManggaraiDepartures } from './data/departures-api'
import {
  fetchCorridorFare,
  fetchStationDetail,
  fetchStationTransfers
} from './data/network-api'
import { nextDepartures } from './data/next-departures'

// Smooth-scroll for in-page anchors (unchanged from the original).
document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const id = link.getAttribute('href')?.slice(1)
    if (!id) return
    const target = document.getElementById(id)
    if (!target) return
    event.preventDefault()
    target.scrollIntoView({ behavior: 'smooth' })
  })
})

function bootNetworkBackground(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#network-bg')
  if (!canvas) return

  const ctx = createGL(canvas)
  if (!ctx) {
    // No WebGL2 (old browser / headless without GPU / --disable-webgl): leave
    // the page as-is. A static fallback lives in the DOM so nothing looks broken.
    document.documentElement.setAttribute('data-webgl', 'off')
    return
  }
  document.documentElement.setAttribute('data-webgl', 'on')

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const scene = buildScene()

  const aspect = window.innerWidth / Math.max(window.innerHeight, 1)
  const heroPose = buildBeats(scene, aspect)[0]!.pose

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
  const fareTag
    = overlayRoot && fareA && fareB
      ? createFareTag(
          overlayRoot,
          { x: (fareA.x + fareB.x) / 2, y: 0, z: (fareA.z + fareB.z) / 2 },
          reduceMotion
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

  // The info-stasiun factoid card, anchored to Rasuna Said.
  const rasuna = scene.stationWorld.get('LRTJBDB-RAS')
  const stationCard
    = overlayRoot && rasuna
      ? createStationCard(overlayRoot, rasuna, reduceMotion)
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
        // Mirror the headline figure into the plate's eyebrow datum.
        const datum = document.querySelector<HTMLElement>('[data-fare-datum]')
        if (datum) datum.textContent = `Rp${fare.totalFare.toLocaleString('id-ID')}`
      })
      .catch(() => fareTag.setState({ kind: 'error' }))
  }

  // Rasuna Said backs BOTH the info-stasiun plate and the API beat's code panel,
  // so one fetch serves both; the transfers call is separate and optional.
  let stationLoaded = false
  function loadStation(): void {
    stationCard?.setState({ kind: 'loading' })
    fetchStationDetail()
      .then(async (station) => {
        renderApiPanel(station)
        const transfers = await fetchStationTransfers().catch(() => [])
        renderStationFacts(station)
        stationCard?.setState({ kind: 'ready', station, transfers })
      })
      .catch(() => {
        // Leave the static fallback markup in place — it's accurate, just not live.
        stationCard?.setState({ kind: 'error' })
      })
  }

  const director = createSectionDirector({
    camera,
    renderer,
    reduceMotion,
    // Poses depend on aspect, so the director rebuilds them from the current
    // viewport whenever it needs them (initial + on resize).
    buildBeats: () => buildBeats(scene, window.innerWidth / Math.max(window.innerHeight, 1)),
    onActiveBeat: (id) => {
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
      stationCard?.setVisible(id === 'stasiun')

      // Fetch from the tarif beat onward: the station card wants data before the
      // reader arrives, and the API panel below reads the same response.
      if ((id === 'tarif' || id === 'stasiun' || id === 'api') && !stationLoaded) {
        stationLoaded = true
        loadStation()
      }
    }
  })

  window.addEventListener('resize', () => {
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
