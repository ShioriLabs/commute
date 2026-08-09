# @commute/tsundere

The routing engine. Dependency-free by design.

```ts
const tsun = loadGraph({ edges, transfers, restrictions, headwaysS })
const legs = tsun.findRoute('KCI-SUD', 'MRTJ-LBB')       // one best route
const options = tsun.findRoutes('KCI-SUD', 'MRTJ-LBB')   // several, scored
```

## The boundary

This package knows about nodes, arcs and distances. It does not know what an
operator is, what a rupiah is, or that station ids happen to look like
`${operator}-${code}`. Everything Jakarta-specific — topology, endpoint
restrictions, fares, the D1 graph inputs — stays in `apps/api` and is passed in.

Keep it that way. The moment this package imports `@commute/constants` or a
database type, it stops being a routing engine and becomes part of the API.

The one place this rule is knowingly bent is `planner/materialise.ts`, which
splits a station id on `-` to derive `RideLeg.operator`. That is documented at
the call site, and it is load-bearing downstream: `summarizeFares` switches
per-operator tariffs on it.

## The public surface is deliberately small

One entry point, one handle, and the shapes that cross the boundary as data.
Everything else — `buildGraph`, `findRoute` as a free function, `RouteGraph`,
`GraphEdge`, the penalty constants — is internal and stays that way.

That is not tidiness. Phase 2 changes how routing works internally:
per-(stop, round) Pareto bags instead of a scalar Dijkstra, a by-line index
beside the adjacency map, headways attached to the graph. If `RouteGraph` and
`buildGraph` were public, every one of those becomes a breaking change to a
consumer that never needed them. Behind `loadGraph` they are free to move.

The rule for anything added to `index.ts` later: export it only if a caller
outside this package genuinely cannot do its job without it. `Tsundere` gaining
a method is cheap; `Tsundere` exposing its graph is not.
