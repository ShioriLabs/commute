/** @jsxImportSource hono/jsx */
import { html } from 'hono/html'

/*
 * GET /map: a bare MapLibre page over shirase's own tiles, glyphs and sprites,
 * for checking an extract by eye. A test page, not a product surface: Peta Bus
 * in apps/web is where the real map lives.
 *
 * It loads the same /styles/{theme}.json the web app and Android do
 * (src/style.ts), so what this page shows is what the apps get.
 *
 * MapLibre is pinned and loaded from unpkg; nothing here is bundled. MapLibre
 * 6 ships ES modules only, so it is imported from a module script (its worker
 * is resolved next to the module, so unpkg serves that too).
 *
 * Rendered with Hono JSX. The stylesheet and the two inline scripts go in
 * through dangerouslySetInnerHTML: JSX escapes text children, which would
 * mangle CSS and JavaScript. Their contents are constants plus the config
 * JSON, which scriptJson makes safe inside a <script>.
 */

import { THEMES, type Theme } from './style'

const MAPLIBRE_VERSION = '6.16.0'

export interface MapPageConfig {
  origin: string
  tilesets: string[]
  tileset: string
  theme: Theme
  themes?: Theme[]
}

/** JSON safe to drop inside a <script> element. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c')

/** The whole document, doctype included (JSX cannot emit one). */
export const renderMapPage = (config: MapPageConfig) =>
  html`<!doctype html>${<MapPage {...config} themes={Object.keys(THEMES) as Theme[]} />}`

function MapPage(config: MapPageConfig) {
  return (
    <html lang="id">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>shirase map</title>
        <link rel="stylesheet" href={`https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`} />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        {config.tilesets.length === 0
          ? <p id="empty">No tilesets in the bucket. Run the extract and seed steps in apps/shirase/README.md.</p>
          : <MapView config={config} />}
      </body>
    </html>
  )
}

function MapView({ config }: { config: MapPageConfig }) {
  return (
    <>
      <div id="map" />
      <div id="panel">
        <strong>shirase</strong>
        <label>
          Tileset
          <select id="tileset" />
        </label>
        <label>
          Theme
          <select id="theme" />
        </label>
        <label class="row">
          <input type="checkbox" id="bounds" />
          {' '}
          Tile boundaries
        </label>
        <div>
          z
          <code id="zoom" />
          {' · '}
          <code id="center" />
        </div>
        <a id="style" target="_blank" rel="noopener">Style JSON</a>
      </div>
      <script type="application/json" id="config" dangerouslySetInnerHTML={{ __html: scriptJson(config) }} />
      <script
        type="module"
        dangerouslySetInnerHTML={{
          __html: `import * as maplibregl from 'https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.mjs';\nwindow.maplibregl = maplibregl;\n${CLIENT_SCRIPT}`
        }}
      />
    </>
  )
}

const CSS = `
  html, body, #map { margin: 0; height: 100%; }
  body { font: 13px/1.4 system-ui, sans-serif; }
  #panel {
    position: absolute; top: 12px; left: 12px; z-index: 1;
    background: rgba(255, 255, 255, 0.94); color: #0f172a;
    padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    display: grid; gap: 6px; min-width: 220px; max-width: calc(100vw - 48px);
  }
  #panel label { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 6px; }
  #panel select { font: inherit; }
  #panel .row { display: flex; gap: 8px; align-items: center; }
  #panel code { font-size: 12px; }
  #panel a { color: #2563eb; }
  #empty { padding: 24px; }
`

/*
 * Browser side. Plain script, no template literals, so it can sit inside the
 * module script above without escaping.
 */
const CLIENT_SCRIPT = `
(function () {
  var config = JSON.parse(document.getElementById('config').textContent);

  function styleUrl(theme, tileset) {
    return config.origin + '/styles/' + theme + '.json?tileset=' + encodeURIComponent(tileset);
  }

  var tilesetSelect = document.getElementById('tileset');
  config.tilesets.forEach(function (name) { tilesetSelect.add(new Option(name, name, false, name === config.tileset)); });
  var themeSelect = document.getElementById('theme');
  config.themes.forEach(function (name) { themeSelect.add(new Option(name, name, false, name === config.theme)); });

  // Monas, at a zoom that shows streets and halte-scale detail.
  var map = new maplibregl.Map({
    container: 'map',
    style: styleUrl(config.theme, config.tileset),
    center: [106.8272, -6.1754],
    zoom: 13,
    hash: true
  });
  // For poking at from the console (and the screenshot checks).
  window.shiraseMap = map;
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

  function readout() {
    var c = map.getCenter();
    document.getElementById('zoom').textContent = map.getZoom().toFixed(2);
    document.getElementById('center').textContent = c.lng.toFixed(5) + ', ' + c.lat.toFixed(5);
  }
  map.on('move', readout);
  readout();

  function restyle() {
    var url = styleUrl(themeSelect.value, tilesetSelect.value);
    map.setStyle(url);
    document.getElementById('style').href = url;
    var params = new URLSearchParams({ tileset: tilesetSelect.value, theme: themeSelect.value });
    history.replaceState(null, '', '?' + params.toString() + location.hash);
  }
  tilesetSelect.addEventListener('change', restyle);
  themeSelect.addEventListener('change', restyle);
  document.getElementById('style').href = styleUrl(config.theme, config.tileset);
  document.getElementById('bounds').addEventListener('change', function (e) { map.showTileBoundaries = e.target.checked; });

  map.on('error', function (e) { console.error(e.error || e); });
})();
`
