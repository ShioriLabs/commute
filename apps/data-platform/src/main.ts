import "./style.css";
import { initNetworkCanvas } from "./network-canvas";

const canvas = document.querySelector<HTMLCanvasElement>("#hero-network");
if (canvas) initNetworkCanvas(canvas);

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
