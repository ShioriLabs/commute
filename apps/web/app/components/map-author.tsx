import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hitTestPoints, type Point, type Transform } from '../lib/map-renderer'

interface AuthorOverlayProps {
  viewportRef: React.RefObject<HTMLDivElement | null>
  points: Point[]
  editingId: string | null
  rendered: Transform
  onChange: (next: Point[]) => void
  onSetEditingId: (id: string | null) => void
  onExport: () => void
  onClear: () => void
}

export function AuthorOverlay({
  viewportRef,
  points,
  editingId,
  rendered,
  onChange,
  onSetEditingId,
  onExport,
  onClear
}: AuthorOverlayProps) {
  const editing = editingId !== null ? points.find(p => p.id === editingId) : null

  // Draft state — the ID input is buffered so partial typing (e.g. "SUDB" mid-
  // way to "SUDBA") doesn't clobber an existing pill with the same prefix.
  // Committed on Done / Enter; reverted on Esc / panel close.
  const [draftId, setDraftId] = useState('')
  useEffect(() => {
    setDraftId(editing?.id ?? '')
  }, [editing?.id])

  // Project a world point to screen-space CSS pixels using the rendered
  // transform — same math the renderer uses, kept in JS for the floating UI.
  const project = (worldX: number, worldY: number) => ({
    x: worldX * rendered.scale + rendered.tx,
    y: worldY * rendered.scale + rendered.ty
  })

  // Update a non-ID field immediately (no collision risk).
  const updateEditingField = (patch: Partial<Omit<Point, 'id'>>) => {
    if (!editing) return
    onChange(points.map(p => (p.id === editing.id ? { ...p, ...patch } : p)))
  }

  const commitId = () => {
    if (!editing) return
    const next = draftId.trim()
    if (!next || next === editing.id) {
      onSetEditingId(null)
      return
    }
    if (points.some(p => p.id === next)) {
      window.alert(`ID "${next}" already exists. Choose a different ID.`)
      return
    }
    onChange(points.map(p => (p.id === editing.id ? { ...p, id: next } : p)))
    onSetEditingId(null)
  }

  const cancelEdit = () => {
    setDraftId(editing?.id ?? '')
    onSetEditingId(null)
  }

  const deleteEditing = () => {
    if (!editing) return
    onChange(points.filter(p => p.id !== editing.id))
    onSetEditingId(null)
  }

  const nudgeEditing = (dx: number, dy: number) => {
    if (!editing) return
    onChange(points.map(p => p.id === editing.id
      ? { ...p, ax: p.ax + dx, ay: p.ay + dy, bx: p.bx + dx, by: p.by + dy }
      : p
    ))
  }

  useEffect(() => {
    if (!editing) return
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTextInput = target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text'
      if (isTextInput) return
      const step = e.shiftKey ? 5 : 1
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      nudgeEditing(dx, dy)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editing, points])

  const editingScreen = editing
    ? project((editing.ax + editing.bx) / 2, (editing.ay + editing.by) / 2)
    : null

  const panelRef = useRef<HTMLDivElement | null>(null)
  const [panelSize, setPanelSize] = useState({ w: 240, h: 280 })
  useLayoutEffect(() => {
    if (!panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    if (rect.width && rect.height && (Math.abs(rect.width - panelSize.w) > 1 || Math.abs(rect.height - panelSize.h) > 1)) {
      setPanelSize({ w: rect.width, h: rect.height })
    }
  })

  const panelPosition = (() => {
    if (!editing || !editingScreen || !viewportRef.current) return null
    const vw = viewportRef.current.clientWidth
    const vh = viewportRef.current.clientHeight
    const margin = 12
    const gap = 16
    const offsetX = editing.r * rendered.scale + gap
    const offsetY = editing.r * rendered.scale + gap
    const fitsRight = editingScreen.x + offsetX + panelSize.w + margin <= vw
    const left = fitsRight
      ? editingScreen.x + offsetX
      : editingScreen.x - offsetX - panelSize.w
    const fitsBelow = editingScreen.y + offsetY + panelSize.h + margin <= vh
    const top = fitsBelow
      ? editingScreen.y + offsetY
      : editingScreen.y - offsetY - panelSize.h
    return {
      left: clampUI(left, margin, Math.max(margin, vw - panelSize.w - margin)),
      top: clampUI(top, margin, Math.max(margin, vh - panelSize.h - margin))
    }
  })()

  return (
    <>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur rounded-lg shadow-lg px-3 py-2 flex gap-2 items-center text-sm">
        <span className="font-mono text-slate-700">
          {points.length}
          {' pills'}
        </span>
        <button
          type="button"
          onClick={onExport}
          className="px-3 py-1 rounded bg-rose-100 hover:bg-rose-200 text-pink-800 font-semibold"
        >
          Export
        </button>
        <button
          type="button"
          onClick={onClear}
          className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
        >
          Clear
        </button>
        <span className="text-xs text-slate-500 ml-2">
          tap empty space = new pill · tap pill = edit · shift-tap then tap empty space = extend to capsule
        </span>
      </div>

      {editing && panelPosition && (
        <div
          ref={panelRef}
          className="absolute z-20 bg-white rounded-lg shadow-xl border border-slate-200 p-3 flex flex-col gap-2 min-w-[220px]"
          style={{ left: panelPosition.left, top: panelPosition.top }}
          onPointerDown={e => e.stopPropagation()}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">ID (e.g. KCI-MRI)</span>
            <input
              type="text"
              value={draftId}
              onChange={e => setDraftId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitId()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              className="px-2 py-1 border border-slate-300 rounded font-mono text-sm"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Radius (world units)</span>
            <input
              type="number"
              value={editing.r}
              step="1"
              min="1"
              onChange={e => updateEditingField({ r: Number(e.target.value) })}
              className="px-2 py-1 border border-slate-300 rounded font-mono text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Corner radius (empty = capsule)</span>
            <input
              type="number"
              value={editing.cr ?? ''}
              step="1"
              min="0"
              max={editing.r}
              placeholder={String(editing.r)}
              onChange={(e) => {
                const raw = e.target.value
                updateEditingField({ cr: raw === '' ? undefined : Number(raw) })
              }}
              className="px-2 py-1 border border-slate-300 rounded font-mono text-sm"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Nudge (1u · shift = 5u)</span>
            <div className="grid grid-cols-3 gap-1 w-fit">
              <span />
              <button type="button" onClick={e => nudgeEditing(0, e.shiftKey ? -5 : -1)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm" aria-label="Nudge up">↑</button>
              <span />
              <button type="button" onClick={e => nudgeEditing(e.shiftKey ? -5 : -1, 0)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm" aria-label="Nudge left">←</button>
              <span />
              <button type="button" onClick={e => nudgeEditing(e.shiftKey ? 5 : 1, 0)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm" aria-label="Nudge right">→</button>
              <span />
              <button type="button" onClick={e => nudgeEditing(0, e.shiftKey ? 5 : 1)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm" aria-label="Nudge down">↓</button>
              <span />
            </div>
          </div>
          <div className="text-xs font-mono text-slate-500">
            A (
            {editing.ax.toFixed(1)}
            ,
            {' '}
            {editing.ay.toFixed(1)}
            )
            {!(editing.ax === editing.bx && editing.ay === editing.by) && (
              <>
                {' → B ('}
                {editing.bx.toFixed(1)}
                ,
                {' '}
                {editing.by.toFixed(1)}
                )
              </>
            )}
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={deleteEditing}
              className="px-2 py-1 rounded text-rose-700 hover:bg-rose-50 text-sm"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={commitId}
              className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function clampUI(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return Math.min(hi, Math.max(lo, v))
}

// Author-mode tap handler. Returns true if it handled the tap (placed or
// selected a pill), false if the caller should fall through to normal
// hit-test logic. Called from map.tsx only when authorMode is true (and
// authorMode itself is gated by import.meta.env.DEV).
export function handleAuthorTap(args: {
  worldX: number
  worldY: number
  slopWorld: number
  shift: boolean
  pointsRef: { current: Point[] }
  editingId: string | null
  setWorkingPoints: (next: Point[]) => void
  setEditingId: (id: string | null) => void
  defaultR: number
}): void {
  const { worldX, worldY, slopWorld, shift, pointsRef, editingId, setWorkingPoints, setEditingId, defaultR } = args
  const hit = hitTestPoints(worldX, worldY, pointsRef.current, slopWorld)
  if (hit && shift) {
    setEditingId(hit.id)
    return
  }
  if (hit) {
    setEditingId(hit.id)
    return
  }
  // Empty space: finish a pending capsule extension or drop a new circle.
  if (editingId !== null) {
    const idx = pointsRef.current.findIndex(p => p.id === editingId)
    if (idx >= 0) {
      const target = pointsRef.current[idx]
      const isCircle = target.ax === target.bx && target.ay === target.by
      if (isCircle) {
        const next = [...pointsRef.current]
        next[idx] = { ...target, bx: worldX, by: worldY }
        setWorkingPoints(next)
        return
      }
    }
  }
  const newId = `new-${Date.now().toString(36)}`
  setWorkingPoints([
    ...pointsRef.current,
    { id: newId, ax: worldX, ay: worldY, bx: worldX, by: worldY, r: defaultR }
  ])
  setEditingId(newId)
}
