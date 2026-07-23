const SPACING = 28;
const BASE_RADIUS = 1.4;
const HOVER_RADIUS = 3.2;
const HOVER_DISTANCE = 140;
const BASE_ALPHA = 0.07;
const HOVER_ALPHA = 0.22;

export function initDotGrid(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const section = canvas.parentElement;
  let pointer: { x: number; y: number } | null = null;
  let dpr = window.devicePixelRatio || 1;
  let width = 0;
  let height = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const dotRgb = document.documentElement.classList.contains("dark")
      ? "255, 255, 255"
      : "15, 23, 42";
    ctx!.clearRect(0, 0, width, height);
    for (let y = SPACING / 2; y < height; y += SPACING) {
      for (let x = SPACING / 2; x < width; x += SPACING) {
        let radius = BASE_RADIUS;
        let alpha = BASE_ALPHA;
        if (pointer) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < HOVER_DISTANCE) {
            const t = 1 - dist / HOVER_DISTANCE;
            radius = BASE_RADIUS + (HOVER_RADIUS - BASE_RADIUS) * t;
            alpha = BASE_ALPHA + (HOVER_ALPHA - BASE_ALPHA) * t;
          }
        }
        ctx!.beginPath();
        ctx!.arc(x, y, radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${dotRgb}, ${alpha})`;
        ctx!.fill();
      }
    }
    requestAnimationFrame(draw);
  }

  function handlePointerMove(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
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
