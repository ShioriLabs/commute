import './style.css'
import { createGL } from './gl/context'
import { buildScene } from './scene/network-scene'
import { createCamera } from './gl/camera'
import { createRenderer } from './gl/renderer'
import { buildBeats } from './scroll/beats'
import { createSectionDirector } from './scroll/section-director'
import { createDeparturesFlyout } from './overlay/departures'
import { fetchManggaraiDepartures } from './data/departures-api'
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

  const renderer = createRenderer({
    gl: ctx.gl,
    canvas,
    scene,
    camera,
    reduceMotion,
    onFrame: frameCtx => flyout?.update(frameCtx)
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
      loadDepartures
    }
  }
}

bootNetworkBackground()
