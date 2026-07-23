const STORAGE_KEY = "theme";

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

function setDark(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
}

export function initThemeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (!button) return;

  const sunIcon = button.querySelector<HTMLElement>("[data-icon='sun']");
  const moonIcon = button.querySelector<HTMLElement>("[data-icon='moon']");

  function syncIcons() {
    const dark = isDark();
    sunIcon?.classList.toggle("hidden", !dark);
    moonIcon?.classList.toggle("hidden", dark);
    button?.setAttribute(
      "aria-label",
      dark ? "Ganti ke mode terang" : "Ganti ke mode gelap",
    );
  }

  syncIcons();

  button.addEventListener("click", () => {
    setDark(!isDark());
    syncIcons();
  });
}
