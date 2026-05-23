/// <reference lib="webworker" />
/*
 * Off-main-thread SVG -> ImageBitmap rasterizer.
 *
 * The main thread fetches the SVG text (so it picks up the page's cache /
 * service worker), then posts it here. The worker decodes via createImageBitmap
 * (off the main thread) and draws onto an OffscreenCanvas at the requested
 * pixel size, transferring the resulting ImageBitmap back.
 *
 * Used as the fallback path when a tile tier has no pre-rasterized WebP
 * available (e.g. tier 4 on desktop, or any tier in dev before the build
 * script has produced raster tiles).
 */

export interface RasterizeRequest {
  id: number
  svgText: string
  w: number
  h: number
}

export interface RasterizeSuccess {
  id: number
  bitmap: ImageBitmap
}

export interface RasterizeFailure {
  id: number
  error: string
}

export type RasterizeResponse = RasterizeSuccess | RasterizeFailure

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.addEventListener('message', async (event: MessageEvent<RasterizeRequest>) => {
  const { id, svgText, w, h } = event.data
  try {
    const blob = new Blob([svgText], { type: 'image/svg+xml' })
    // createImageBitmap with explicit resize bypasses the synchronous SVG draw
    // path entirely; the browser handles decoding off the main thread.
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high'
    })
    const response: RasterizeSuccess = { id, bitmap }
    ctx.postMessage(response, [bitmap])
  } catch (err) {
    const response: RasterizeFailure = {
      id,
      error: err instanceof Error ? err.message : String(err)
    }
    ctx.postMessage(response)
  }
})
