/** Host-page theme detection, shared by all ChatHP shadow UIs. */
export function detectDarkTheme(): boolean {
  try {
    const html = document.documentElement;
    if (html.classList.contains('dark') || html.dataset.mode === 'dark') return true;
    if (html.classList.contains('light') || html.dataset.mode === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}
