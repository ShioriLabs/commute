// WebGL2 context creation with a hard guard. Returns null when WebGL2 is
// unavailable (old browsers, headless Chromium without a GPU, or an explicit
// --disable-webgl) so the caller can fall back to static content rather than
// render a blank page.
//
// NOTE for local testing: headless Chromium on this machine has no WebGL2 —
// exercise the renderer with `xvfb-run -a` + a HEADED browser (see the plan's
// verification section), or createGL will (correctly) return null.
export interface GLContext {
  gl: WebGL2RenderingContext
}

export function createGL(canvas: HTMLCanvasElement): GLContext | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    // The scene is drawn back-to-front with additive-ish blending; we don't
    // depend on depth ordering for the flat/tilted plane, so no depth buffer.
    depth: false,
    premultipliedAlpha: true,
    // Keep the buffer so we can pixel-probe for tests without a forced redraw.
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  })

  if (!gl) return null
  return { gl }
}
