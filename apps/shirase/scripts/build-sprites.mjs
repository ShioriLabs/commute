/*
 * Light and dark's sprites: Protomaps' own sheet (road shields, one-way
 * arrows, town dots), kept exactly where it is, plus our place icons in rows
 * below it: a white Maki glyph (@mapbox/maki, CC0) on a circle of its
 * category's colour, ringed in the theme's label halo, as Apple draws them.
 * One SVG per sheet, rendered once by resvg, so the copied sheet keeps its
 * pixels and every icon is drawn at its pixel ratio, not scaled.
 *
 *   node scripts/build-sprites.mjs   (after fetch:sprites)
 *   -> data/sprites/<theme sprite>{,@2x}.{json,png}
 *
 * The kinds, glyphs and colours come from src/pois.json, which src/style.ts
 * reads too.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Resvg } from '@resvg/resvg-js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPRITES = path.join(ROOT, 'data', 'sprites')
const POIS = JSON.parse(readFileSync(path.join(ROOT, 'src', 'pois.json'), 'utf8'))
const MAKI = path.join(path.dirname(createRequire(import.meta.url).resolve('@mapbox/maki/package.json')), 'icons')

/** Icon box in CSS pixels; the glyph's 15 px drawn at GLYPH inside it. */
export const ICON = 20
const GLYPH = 11
const RING = 1.5
const GAP = 2

/** A Maki glyph's drawing, without its own <svg> wrapper or ids. */
export function makiGlyph(name) {
  const svg = readFileSync(path.join(MAKI, `${name}.svg`), 'utf8')
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return inner.replace(/\sid="[^"]*"/g, '').replace(/\sfill="[^"]*"/g, '').trim()
}

export function iconSvg(name, circle, ring) {
  const c = ICON / 2
  const at = (ICON - GLYPH) / 2
  return `<circle cx="${c}" cy="${c}" r="${c - RING / 2}" fill="${circle}" stroke="${ring}" stroke-width="${RING}"/>`
    + `<g transform="translate(${at} ${at}) scale(${GLYPH / 15})" fill="#ffffff">${makiGlyph(name)}</g>`
}

function buildSheet(theme, ratio) {
  const suffix = ratio === 1 ? '' : `@${ratio}x`
  const base = JSON.parse(readFileSync(path.join(SPRITES, `${theme.base}${suffix}.json`), 'utf8'))
  const basePng = readFileSync(path.join(SPRITES, `${theme.base}${suffix}.png`))
  const baseW = basePng.readUInt32BE(16)
  const baseH = basePng.readUInt32BE(20)

  const size = ICON * ratio
  const step = size + GAP * ratio
  const perRow = Math.max(1, Math.floor(baseW / step))
  const kinds = Object.entries(POIS.kinds)
  const width = Math.max(baseW, perRow * step)
  const height = baseH + GAP * ratio + Math.ceil(kinds.length / perRow) * step

  const json = { ...base }
  const parts = [`<image href="data:image/png;base64,${basePng.toString('base64')}" x="0" y="0" width="${baseW}" height="${baseH}"/>`]
  kinds.forEach(([kind, [icon, category]], i) => {
    const x = (i % perRow) * step
    const y = baseH + GAP * ratio + Math.floor(i / perRow) * step
    parts.push(`<g transform="translate(${x} ${y}) scale(${ratio})">${iconSvg(icon, POIS.categories[category].circle, theme.ring)}</g>`)
    json[`poi-${kind}`] = { x, y, width: size, height: size, pixelRatio: ratio }
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
  const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng()
  writeFileSync(path.join(SPRITES, `${theme.sprite}${suffix}.png`), png)
  writeFileSync(path.join(SPRITES, `${theme.sprite}${suffix}.json`), JSON.stringify(json))
  return { file: `${theme.sprite}${suffix}`, width, height, icons: kinds.length }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const theme of Object.values(POIS.themes)) {
    for (const ratio of [1, 2]) {
      const { file, width, height, icons } = buildSheet(theme, ratio)
      console.log(`${file}: ${width}x${height}, ${icons} place icons`)
    }
  }
}
