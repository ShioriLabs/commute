// Hero canvas: the Jabodetabek rail network as a glowing LED dot-matrix.
// Layout comes from the FDTJ schematic (network.ts sx/sy — arms collapsed, core
// expanded), snapped to a dot lattice. Lines are octilinear (0/45/90°) runs of
// lit dots in true line colors; trains hop dot-to-dot. Dark-only.
import { NETWORK, type NetNode } from "./network";

// Interchange stations that earn a text label (the recognizable ones). Others
// still render as roundels, just unlabeled, to keep the map legible.
const LABELED = new Set<string>([
  "KCI-MRI", // Manggarai
  "KCI-THB", // Tanah Abang
  "KCI-SUD", // Sudirman
  "KCI-DU", // Duri
  "KCI-JNG", // Jatinegara
  "KCI-JAKK", // Jakarta Kota
  "KCI-CTA", // Citayam
  "KCI-DP", // Depok
  "KCI-BKS", // Bekasi
  "MRTJ-DKA", // Dukuh Atas (MRT)
  "KCI-CW", // Cawang
  "LRTJBDB-CWG", // Cawang (LRT trunk split)
]);

const PADDING = 56;
// Lattice (cols/rows) + per-station col/row are baked into network.ts, so the
// diagram is identical at every viewport width. See generateDataPlatformNetwork.
const FIELD_COLOR = "#20242e"; // faint unlit dot
const FIELD_RADIUS = 1.1;
const LINE_DOT_RADIUS = 2.1; // lit line dots
const LINE_STROKE_WIDTH = 1.4; // faint connector under the dots
const LINE_STROKE_ALPHA = 0.45;
const STATION_RADIUS = 2.8;
const INTERCHANGE_RADIUS = 4.2;
const TRAIN_RADIUS = 2.9;

const HOVER_DISTANCE = 150;
const HOVER_SCALE = 2.3;
const DRAW_IN_MS = 1700; // total time for all lines to finish lighting up
const TRAIN_STEP_MS = 90; // ms per dot-to-dot hop
const TRAINS_PER_LINE = 2;

interface Cell {
  col: number;
  row: number;
  x: number;
  y: number;
}

interface LitDot {
  col: number;
  row: number;
  x: number;
  y: number;
  color: string;
  order: number; // 0..1 position along its line's route, for staggered draw-in
}

// A train rides the ordered lattice cells of one line's longest route.
interface Train {
  route: Cell[];
  color: string;
  idx: number;
}

interface SafeZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Octilinear route between two lattice cells: step diagonally (45°) along the
// shorter axis, then straight (H or V) for the remainder. Returns every cell
// the route passes through, inclusive of both ends.
function octRoute(a: Cell, b: Cell): { col: number; row: number }[] {
  const cells: { col: number; row: number }[] = [];
  let col = a.col;
  let row = a.row;
  const dc = Math.sign(b.col - col);
  const dr = Math.sign(b.row - row);
  const diag = Math.min(Math.abs(b.col - col), Math.abs(b.row - row));
  cells.push({ col, row });
  for (let i = 0; i < diag; i++) {
    col += dc;
    row += dr;
    cells.push({ col, row });
  }
  while (col !== b.col) {
    col += dc;
    cells.push({ col, row });
  }
  while (row !== b.row) {
    row += dr;
    cells.push({ col, row });
  }
  return cells;
}

// True when route[i] is where the path changes direction (a dogleg corner).
function isCorner(route: { col: number; row: number }[], i: number): boolean {
  if (i <= 0 || i >= route.length - 1) return false;
  const p = route[i - 1]!;
  const c = route[i]!;
  const n = route[i + 1]!;
  return Math.sign(c.col - p.col) !== Math.sign(n.col - c.col) || Math.sign(c.row - p.row) !== Math.sign(n.row - c.row);
}

export function initNetworkCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const section = canvas.parentElement;
  const content = section?.querySelector<HTMLElement>("[data-hero-content]") ?? null;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let rows = 0;
  let originX = 0;
  let originY = 0;
  let cellPx = 0;

  let stationCells = new Map<string, Cell>();
  let stationList: { node: NetNode; cell: Cell }[] = [];
  let litDots: LitDot[] = [];
  // Faint octilinear connector polylines under the dots (one per line segment).
  let linePaths: { color: string; pts: { x: number; y: number }[] }[] = [];
  let trains: Train[] = [];
  let fieldLayer: HTMLCanvasElement | null = null;

  let safeZone: SafeZone = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 };
  let pointer: { x: number; y: number } | null = null;
  let startTime = 0;
  let lastTrainStep = 0;

  function cellCenter(col: number, row: number): { x: number; y: number } {
    return { x: originX + (col + 0.5) * cellPx, y: originY + (row + 0.5) * cellPx };
  }

  function layout() {
    const availW = width - PADDING * 2;
    const availH = height - PADDING * 2;
    // The lattice is BAKED (network.ts col/row + grid) so the diagram is
    // identical at every width — here we only fit that fixed grid into the
    // padded box and scale col/row -> pixels. No per-resize re-snapping (that
    // made octilinear doglegs drift as the width changed).
    const cols = NETWORK.grid.cols;
    rows = NETWORK.grid.rows;
    cellPx = Math.min(availW / cols, availH / rows);
    const drawnW = cols * cellPx;
    const drawnH = rows * cellPx;
    originX = PADDING + (availW - drawnW) / 2;
    originY = PADDING + (availH - drawnH) / 2;

    stationCells = new Map();
    for (const node of NETWORK.nodes) {
      const p = cellCenter(node.col, node.row);
      stationCells.set(node.id, { col: node.col, row: node.row, x: p.x, y: p.y });
    }
    stationList = NETWORK.nodes.map((node) => ({ node, cell: stationCells.get(node.id)! }));

    // Octilinear lit dots per line, plus per-line ordered routes for trains and
    // faint connector polylines under the dots.
    litDots = [];
    trains = [];
    linePaths = [];
    const litKeys = new Set<string>(); // dedupe by cell+color
    const routesByColor = new Map<string, Cell[]>();

    for (const line of NETWORK.lines) {
      const lineRoute: { col: number; row: number }[] = [];
      for (const seg of line.segments) {
        // Connector polyline for this segment (station -> corner -> station).
        const segPts: { x: number; y: number }[] = [];
        for (let i = 0; i < seg.length - 1; i++) {
          const a = stationCells.get(seg[i]!);
          const b = stationCells.get(seg[i + 1]!);
          if (!a || !b) continue;
          const route = octRoute(a, b);
          route.forEach((c, ri) => {
            if (lineRoute.length === 0 || lineRoute[lineRoute.length - 1]!.col !== c.col || lineRoute[lineRoute.length - 1]!.row !== c.row) {
              lineRoute.push(c);
            }
            // Connector needs the endpoints + the dogleg corner only.
            if (ri === 0 || ri === route.length - 1 || isCorner(route, ri)) {
              const p = cellCenter(c.col, c.row);
              if (!segPts.length || segPts[segPts.length - 1]!.x !== p.x || segPts[segPts.length - 1]!.y !== p.y) segPts.push(p);
            }
          });
        }
        if (segPts.length >= 2) linePaths.push({ color: line.color, pts: segPts });
      }
      // Emit lit dots (skip cells occupied by a station so station dots win).
      const total = Math.max(lineRoute.length, 1);
      lineRoute.forEach((c, i) => {
        const key = `${c.col},${c.row}:${line.color}`;
        if (litKeys.has(key)) return;
        litKeys.add(key);
        const p = cellCenter(c.col, c.row);
        litDots.push({ col: c.col, row: c.row, x: p.x, y: p.y, color: line.color, order: i / total });
      });
      // Keep the longest route per color for trains.
      const existing = routesByColor.get(line.color);
      if (!existing || lineRoute.length > existing.length) {
        routesByColor.set(line.color, lineRoute.map((c) => ({ ...c, ...cellCenter(c.col, c.row) })));
      }
    }

    if (!reduceMotion) {
      for (const [color, route] of routesByColor) {
        if (route.length < 4) continue;
        for (let i = 0; i < TRAINS_PER_LINE; i++) {
          trains.push({ route, color, idx: Math.floor((i / TRAINS_PER_LINE + Math.random() * 0.4) * route.length) });
        }
      }
    }

    buildFieldLayer(cols);
  }

  // Render the faint dot field once to an offscreen canvas; composite each
  // frame with a single drawImage (no per-frame field redraw). The field tiles
  // the WHOLE hero (not just the network grid) with "dead" dots, phase-aligned
  // to the grid origin so the network dots land exactly on field cells — the
  // letterbox margins fill in and the hero reads as one continuous matrix.
  function buildFieldLayer(_cols: number) {
    const c = document.createElement("canvas");
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const fctx = c.getContext("2d");
    if (!fctx) return;
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.fillStyle = FIELD_COLOR;
    // Tile from the grid origin outward across the full canvas (both directions).
    const startCol = Math.ceil((0 - originX) / cellPx - 0.5);
    const endCol = Math.floor((width - originX) / cellPx - 0.5);
    const startRow = Math.ceil((0 - originY) / cellPx - 0.5);
    const endRow = Math.floor((height - originY) / cellPx - 0.5);
    for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
        const p = cellCenter(col, row);
        fctx.beginPath();
        fctx.arc(p.x, p.y, FIELD_RADIUS, 0, Math.PI * 2);
        fctx.fill();
      }
    }
    fieldLayer = c;
  }

  function measureSafeZone() {
    if (!content || !width || !height) {
      safeZone = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 };
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const rect = content.getBoundingClientRect();
    const pad = 30;
    safeZone = {
      left: (rect.left - canvasRect.left - pad) / width,
      right: (rect.right - canvasRect.left + pad) / width,
      top: (rect.top - canvasRect.top - pad) / height,
      bottom: (rect.bottom - canvasRect.top + pad) / height,
    };
  }

  function inSafeZone(x: number, y: number) {
    const fx = x / width;
    const fy = y / height;
    return fx > safeZone.left && fx < safeZone.right && fy > safeZone.top && fy < safeZone.bottom;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    measureSafeZone();
  }

  function bloom(x: number, y: number) {
    if (!pointer) return 1;
    const d = Math.hypot(x - pointer.x, y - pointer.y);
    if (d >= HOVER_DISTANCE) return 1;
    return 1 + (HOVER_SCALE - 1) * (1 - d / HOVER_DISTANCE);
  }

  function draw(now: number) {
    if (!startTime) startTime = now;
    const elapsed = now - startTime;
    const progress = reduceMotion ? 1 : Math.min(elapsed / DRAW_IN_MS, 1);

    ctx!.clearRect(0, 0, width, height);
    // static faint field
    if (fieldLayer) ctx!.drawImage(fieldLayer, 0, 0, width, height);

    // faint octilinear connectors under the dots, so each line reads as a
    // continuous route rather than loose beads. Fades in with the draw-in.
    ctx!.lineWidth = LINE_STROKE_WIDTH;
    ctx!.lineJoin = "round";
    ctx!.lineCap = "round";
    for (const path of linePaths) {
      ctx!.globalAlpha = (reduceMotion ? 1 : progress) * LINE_STROKE_ALPHA;
      ctx!.strokeStyle = path.color;
      ctx!.beginPath();
      ctx!.moveTo(path.pts[0]!.x, path.pts[0]!.y);
      for (let i = 1; i < path.pts.length; i++) ctx!.lineTo(path.pts[i]!.x, path.pts[i]!.y);
      ctx!.stroke();
    }

    // lit line dots (staggered reveal by route order). The field + lines render
    // continuously (no safe-zone hole — that reads as a rectangle); the scrim
    // gradient behind the text handles legibility. Only labels honor the zone.
    for (const d of litDots) {
      if (progress < d.order * 0.85) continue;
      const scale = bloom(d.x, d.y);
      ctx!.globalAlpha = reduceMotion ? 0.95 : Math.min(1, (progress - d.order * 0.85) / 0.15) * 0.95;
      ctx!.fillStyle = d.color;
      ctx!.beginPath();
      ctx!.arc(d.x, d.y, LINE_DOT_RADIUS * scale, 0, Math.PI * 2);
      ctx!.fill();
    }

    // trains: hop dot-to-dot along their route
    if (!reduceMotion && progress > 0.5) {
      if (now - lastTrainStep > TRAIN_STEP_MS) {
        for (const t of trains) t.idx = (t.idx + 1) % t.route.length;
        lastTrainStep = now;
      }
      for (const t of trains) {
        const c = t.route[t.idx]!;
        ctx!.globalAlpha = 1;
        ctx!.fillStyle = t.color;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, TRAIN_RADIUS, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.globalAlpha = 0.3;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, TRAIN_RADIUS * 2.3, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    // station dots + interchange roundels + labels
    for (const { node, cell } of stationList) {
      const scale = bloom(cell.x, cell.y);
      const baseAlpha = (reduceMotion ? 1 : progress) * (node.interchange ? 1 : 0.85);
      ctx!.globalAlpha = baseAlpha;
      const r = (node.interchange ? INTERCHANGE_RADIUS : STATION_RADIUS) * scale;
      ctx!.beginPath();
      ctx!.arc(cell.x, cell.y, r, 0, Math.PI * 2);
      if (node.interchange) {
        ctx!.fillStyle = "#0d0f14";
        ctx!.fill();
        ctx!.lineWidth = 2;
        ctx!.strokeStyle = "#e8eaf0";
        ctx!.stroke();
      } else {
        ctx!.fillStyle = "#cbd0da";
        ctx!.fill();
      }

      // Labels are the real text-on-text conflict — suppress only these in the
      // hero-copy zone (the dots/lines show through the scrim fine).
      if (node.interchange && LABELED.has(node.id) && progress > 0.85 && !inSafeZone(cell.x, cell.y)) {
        ctx!.globalAlpha = Math.min(1, (progress - 0.85) / 0.15) * 0.85;
        ctx!.fillStyle = "#c7ccd6";
        ctx!.font = '600 10px "Plus Jakarta Sans", sans-serif';
        ctx!.fillText(node.name, cell.x + r + 4, cell.y + 3);
      }
    }

    ctx!.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  function handlePointerMove(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function handlePointerLeave() {
    pointer = null;
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(draw);
  if (section) {
    section.addEventListener("pointermove", handlePointerMove);
    section.addEventListener("pointerleave", handlePointerLeave);
  }
}
