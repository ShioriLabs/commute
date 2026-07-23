import "./style.css";
import { initDotGrid } from "./dotgrid";
import { initThemeToggle } from "./theme";

const canvas = document.querySelector<HTMLCanvasElement>("#hero-dot-grid");
if (canvas) initDotGrid(canvas);

initThemeToggle();

document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const id = link.getAttribute("href")?.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth" });
  });
});
