// The render loop: owns rAF, the single per-frame view-projection matrix, and
// the four instanced passes (field, lit dots, trains, stations). Exposes camera
// target control, highlight mix, and an onFrame(project) hook so HTML overlays
// (labels, PIDS flyout) reposition against the exact same matrix — no drift.
import * as twgl from 'twgl.js'
import type { Camera, Vec3Tuple } from './camera'
import { createPrograms } from './programs'
import {
  buildFieldPass,
  buildDotPass,
  buildStationPass,
  buildTrainPass,
  type HighlightablePass,
  type InstancedPass,
  type TrainPass
} from './instanced'
import {
  type HighlightId,
  type NetworkScene,
  FIELD_COLOR,
  FIELD_RADIUS,
  TRAIN_RADIUS,
  TRAINS_PER_LINE,
  TRAIN_STEP_MS
} from '../scene/network-scene'

const DRAW_IN_MS = 1700
const MAX_DPR = 2

const STATION_COLOR: Vec3Tuple = [0xcb / 255, 0xd0 / 255, 0xda / 255]

export interface ProjectFn {
  (world: Vec3Tuple, vpW: number, vpH: number): {
    x: number
    y: number
    depth: number
    visible: boolean
  }
}

export interface FrameContext {
  project: ProjectFn
  viewportW: number
  viewportH: number
  progress: number
  highlightMix: number
}

export interface Renderer {
  start(): void
  stop(): void
  resize(): void
  /** Sets the topology-emphasis target (0 = none, 1 = full). Eased each frame. */
  setHighlightMix(target: number): void
  /**
   * Chooses WHICH subject the emphasis applies to. Cheap to call repeatedly —
   * re-uploads only when the id actually changes. Swap while the mix is near 0,
   * or the emphasis visibly jumps from one subject to another.
   */
  setHighlightSet(id: HighlightId): void
  dispose(): void
}

interface TrainState {
  routeIndex: number // index into scene.trainRoutes
  pos: number // index into that route's points
}

export function createRenderer(opts: {
  gl: WebGL2RenderingContext
  canvas: HTMLCanvasElement
  scene: NetworkScene
  camera: Camera
  reduceMotion: boolean
  onFrame?: (ctx: FrameContext) => void
}): Renderer {
  const { gl, canvas, scene, camera, reduceMotion, onFrame } = opts

  const programs = createPrograms(gl)
  const fieldPass: InstancedPass = buildFieldPass(gl, programs, scene)
  const dotPass: HighlightablePass = buildDotPass(gl, programs, scene)
  const stationPass: HighlightablePass = buildStationPass(gl, programs, scene)

  // Trains: TRAINS_PER_LINE per line route, staggered start positions.
  const trainStates: TrainState[] = []
  const trainColorList: number[] = []
  scene.trainRoutes.forEach((route, ri) => {
    for (let i = 0; i < TRAINS_PER_LINE; i++) {
      const pos = Math.floor((i / TRAINS_PER_LINE + Math.random() * 0.4) * route.points.length)
      trainStates.push({ routeIndex: ri, pos: pos % route.points.length })
      trainColorList.push(route.color[0], route.color[1], route.color[2])
    }
  })
  const trainCount = reduceMotion ? 0 : trainStates.length
  const trainPass: TrainPass | null
    = trainCount > 0
      ? buildTrainPass(gl, programs, new Float32Array(trainColorList), trainCount)
      : null

  let viewportW = 0
  let viewportH = 0
  let dpr = 1

  let running = false
  let rafId = 0
  let startTime = 0
  let lastTime = 0
  let lastTrainStep = 0
  let highlightMix = 0
  let highlightTarget = 0
  let highlightSet: HighlightId = 'none'
  // Counts buffer re-uploads so tests can assert this isn't happening per frame.
  let highlightUploads = 0

  function resize(): void {
    const rect = canvas.getBoundingClientRect()
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    viewportW = rect.width
    viewportH = rect.height
    canvas.width = Math.round(viewportW * dpr)
    canvas.height = Math.round(viewportH * dpr)
    gl.viewport(0, 0, canvas.width, canvas.height)
  }

  function setHighlightMix(target: number): void {
    highlightTarget = Math.max(0, Math.min(1, target))
  }

  function setHighlightSet(id: HighlightId): void {
    if (id === highlightSet) return
    const set = scene.highlights.get(id)
    if (!set) return
    highlightSet = id
    highlightUploads++
    dotPass.setHighlight(gl, set.dots)
    stationPass.setHighlight(gl, set.stations)
  }

  function stepTrains(now: number): void {
    if (!trainPass) return
    if (now - lastTrainStep > TRAIN_STEP_MS) {
      for (const t of trainStates) {
        const route = scene.trainRoutes[t.routeIndex]!
        t.pos = (t.pos + 1) % route.points.length
      }
      lastTrainStep = now
    }
    // Pack current positions.
    for (let i = 0; i < trainStates.length; i++) {
      const t = trainStates[i]!
      const p = scene.trainRoutes[t.routeIndex]!.points[t.pos]!
      trainPass.offsets[i * 3] = p.x
      trainPass.offsets[i * 3 + 1] = p.y
      trainPass.offsets[i * 3 + 2] = p.z
    }
    trainPass.update(gl)
  }

  function frame(now: number): void {
    if (!startTime) {
      startTime = now
      lastTime = now
      lastTrainStep = now
    }
    const dt = now - lastTime
    lastTime = now

    const elapsed = now - startTime
    const progress = reduceMotion ? 1 : Math.min(elapsed / DRAW_IN_MS, 1)

    // Ease highlight + camera. (Reduced-motion camera snapping is driven by the
    // section director via camera.snap(); here we just advance the ease.)
    const hT = 1 - Math.exp(-dt / 200)
    highlightMix += (highlightTarget - highlightMix) * (reduceMotion ? 1 : hT)
    camera.update(dt)

    const aspect = viewportW / Math.max(viewportH, 1)
    const viewProj = camera.viewProj(aspect)

    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied alpha

    // Projection scale for the clip-space billboards: a world radius r maps to
    // clip offset r*u_proj, giving NDC offset r*u_proj/w (shrinks with distance).
    const tanHalf = Math.tan(camera.pose.fovY / 2)
    const uProj: [number, number] = [1 / (tanHalf * aspect), 1 / tanHalf]

    // 1) Faint field.
    gl.useProgram(programs.field.program)
    twgl.setBuffersAndAttributes(gl, programs.field, fieldPass.vao)
    twgl.setUniforms(programs.field, {
      u_viewProj: viewProj,
      u_proj: uProj,
      u_radius: FIELD_RADIUS,
      u_color: FIELD_COLOR
    })
    twgl.drawBufferInfo(gl, fieldPass.vao, gl.TRIANGLE_STRIP, fieldPass.vao.numElements, 0, fieldPass.instanceCount)

    // 2) Lit line dots.
    gl.useProgram(programs.dot.program)
    twgl.setBuffersAndAttributes(gl, programs.dot, dotPass.vao)
    twgl.setUniforms(programs.dot, {
      u_viewProj: viewProj,
      u_proj: uProj,
      u_progress: progress,
      u_highlightMix: highlightMix
    })
    twgl.drawBufferInfo(gl, dotPass.vao, gl.TRIANGLE_STRIP, dotPass.vao.numElements, 0, dotPass.instanceCount)

    // 3) Trains (hop dot-to-dot) — only after the draw-in is half done.
    if (trainPass && progress > 0.5) {
      stepTrains(now)
      gl.useProgram(programs.train.program)
      twgl.setBuffersAndAttributes(gl, programs.train, trainPass.vao)
      twgl.setUniforms(programs.train, {
        u_viewProj: viewProj,
        u_proj: uProj,
        u_radius: TRAIN_RADIUS
      })
      twgl.drawBufferInfo(gl, trainPass.vao, gl.TRIANGLE_STRIP, trainPass.vao.numElements, 0, trainPass.count)
    }

    // 4) Stations + interchanges (drawn last so roundels sit above line dots).
    gl.useProgram(programs.station.program)
    twgl.setBuffersAndAttributes(gl, programs.station, stationPass.vao)
    twgl.setUniforms(programs.station, {
      u_viewProj: viewProj,
      u_proj: uProj,
      u_progress: progress,
      u_highlightMix: highlightMix,
      u_stationColor: STATION_COLOR
    })
    twgl.drawBufferInfo(gl, stationPass.vao, gl.TRIANGLE_STRIP, stationPass.vao.numElements, 0, stationPass.instanceCount)

    onFrame?.({
      project: (world, vpW, vpH) => camera.project(world, vpW, vpH),
      viewportW,
      viewportH,
      progress,
      highlightMix
    })

    if (running) rafId = requestAnimationFrame(frame)
  }

  function start(): void {
    if (running) return
    running = true
    rafId = requestAnimationFrame(frame)
  }

  function stop(): void {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  function dispose(): void {
    stop()
  }

  resize()
  const api: Renderer = { start, stop, resize, setHighlightMix, setHighlightSet, dispose }

  // Dev-only introspection for the headed-browser checks. Defined via
  // defineProperty rather than an object-literal getter inside a spread —
  // spreading INVOKES a getter and copies its value, which would freeze this at
  // its pre-render snapshot.
  if (import.meta.env.DEV) {
    Object.defineProperty(api, 'debugHighlight', {
      get: () => ({ set: highlightSet, uploads: highlightUploads })
    })
  }

  return api
}
