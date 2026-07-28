import './style.css'
import { createDotField } from './docs-field'

/*
 * The only script on the reference page.
 *
 * Everything readable is already in the HTML — endpoints, schemas, examples —
 * rendered at build time by scripts/build-docs.ts. This adds a filter box,
 * makes a deep link open the endpoint it points at, and paints the two
 * decorative dot fields. If it never runs, the page still works: `<details>`
 * toggles natively, the filter input simply does nothing, and the canvases stay
 * empty without leaving a gap (they are sized by CSS, not by their content).
 */

const filter = document.querySelector<HTMLInputElement>('#filter')
const empty = document.querySelector<HTMLElement>('#filter-empty')
const endpoints = [...document.querySelectorAll<HTMLDetailsElement>('[data-endpoint]')]
const sections = [...document.querySelectorAll<HTMLElement>('section[id]')]

function applyFilter(raw: string): void {
  const query = raw.trim().toLowerCase()
  let matches = 0

  for (const endpoint of endpoints) {
    // `data-search` is method + path + summary, lowercased at build time.
    const hit = query === '' || (endpoint.dataset.search ?? '').includes(query)
    endpoint.hidden = !hit
    if (hit) matches++
    // Open matches while filtering so the answer is visible without a click;
    // collapse again when the box is cleared.
    if (query !== '') endpoint.open = hit
    else endpoint.open = false
  }

  // Hide a section whose endpoints all filtered out, so its heading doesn't
  // sit above nothing.
  for (const section of sections) {
    const visible = [...section.querySelectorAll<HTMLDetailsElement>('[data-endpoint]')]
      .some(endpoint => !endpoint.hidden)
    section.hidden = !visible
  }

  // Toggled via the `hidden` attribute, not a class: a Tailwind `hidden` class
  // would out-specify the property and the element would never appear.
  if (empty) empty.hidden = matches > 0
}

filter?.addEventListener('input', () => applyFilter(filter.value))

// `/` focuses the filter, the convention on reference pages. Ignored while the
// user is already typing somewhere.
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey) return
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
  event.preventDefault()
  filter?.focus()
})

// A link to #get-stations-operator-3 should arrive with that endpoint open.
function openFromHash(): void {
  const id = location.hash.slice(1)
  if (!id) return
  const target = document.getElementById(id)
  if (target instanceof HTMLDetailsElement) target.open = true
}

openFromHash()
window.addEventListener('hashchange', openFromHash)

// ── the dot fields ──────────────────────────────────────────────────────────

/*
 * Both canvases are decoration: every endpoint, schema and example is already
 * in the markup, so nothing here can delay the text paint. That matters more on
 * this page than on the homepage — people arrive at a reference from an error
 * message, not from a landing page they chose to look at.
 */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const mastheadCanvas = document.querySelector<HTMLCanvasElement>('#docs-field')
const wordmarkCanvas = document.querySelector<HTMLCanvasElement>('#docs-wordmark')

if (mastheadCanvas) {
  const field = createDotField(mastheadCanvas, 'masthead')
  // Deferred off the critical path: the lattice appearing one frame late is
  // invisible, blocking first paint is not. requestIdleCallback is absent in
  // Safari, hence the timeout.
  const boot = (): void => field?.paintStatic()
  if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 500 })
  else setTimeout(boot, 1)
}

if (wordmarkCanvas) {
  const field = createDotField(wordmarkCanvas, 'wordmark')

  if (field && reduceMotion) {
    // Revealed, not hidden. gl/renderer.ts collapses the same ease to an
    // instant snap rather than withholding the wordmark, and the footer is the
    // page's sign-off — someone who asked for less motion should still get it.
    field.paintStatic()
  } else if (field) {
    /*
     * The single most important perf decision on the page: the footer sits
     * thousands of pixels down, so someone who opened the reference to check
     * one field name never runs this loop at all. It starts when the footer is
     * actually on screen and stops the moment it leaves.
     */
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) field.start()
        else field.stop()
      }
    }, { rootMargin: '100px' })
    observer.observe(wordmarkCanvas)
  }
}
