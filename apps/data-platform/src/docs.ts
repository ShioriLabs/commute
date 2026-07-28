import './style.css'

/*
 * The only script on the reference page.
 *
 * Everything readable is already in the HTML — endpoints, schemas, examples —
 * rendered at build time by scripts/build-docs.ts. This adds a filter box and
 * makes a deep link open the endpoint it points at. If it never runs, the page
 * still works: `<details>` toggles natively and the filter input simply does
 * nothing.
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
