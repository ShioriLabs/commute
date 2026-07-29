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

// ── sidebar scroll-spy ──────────────────────────────────────────────────────

/*
 * Marks the section you are currently reading in the sidebar.
 *
 * Additive by construction: the markup ships with no group marked active, so
 * with scripting off the sidebar is simply a list of anchor links that already
 * work. Nothing here is load-bearing.
 *
 * Intersection alone answers the wrong question here — sections are tall and
 * unevenly sized, so several are "visible" at once and the observer's callback
 * order says nothing about which one you are reading. So the observer is used
 * only as a cheap signal that something moved, and the decision is made by
 * position: the last section whose top has passed the reading line. That also
 * gives a correct answer on first paint, which a purely intersection-driven
 * version cannot (nothing has changed yet, so nothing is marked).
 */
const groups = [...document.querySelectorAll<HTMLElement>('.nav-group')]
  .map(group => ({ group, section: document.getElementById(group.dataset.spy ?? '') }))
  .filter((g): g is { group: HTMLElement, section: HTMLElement } => g.section !== null)

if (groups.length) {
  let queued = false

  const sync = (): void => {
    queued = false
    // A fifth of the way down the viewport: high enough that the active group
    // changes as a heading settles into reading position, low enough that it
    // does not flip while the previous section is still the one on screen.
    const line = window.innerHeight * 0.2
    let active = -1
    for (let i = 0; i < groups.length; i++) {
      if (groups[i]!.section.getBoundingClientRect().top <= line) active = i
    }
    for (let i = 0; i < groups.length; i++) {
      groups[i]!.group.classList.toggle('is-active', i === active)
    }
  }

  const schedule = (): void => {
    if (queued) return
    queued = true
    requestAnimationFrame(sync)
  }

  // Scroll drives it; the observer only wakes things when a section edge
  // crosses the viewport, so idle scrolling in the middle of a long section
  // costs nothing.
  const spy = new IntersectionObserver(schedule)
  for (const { section } of groups) spy.observe(section)
  window.addEventListener('scroll', schedule, { passive: true })
  sync()
}

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
