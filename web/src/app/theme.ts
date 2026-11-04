import { useCallback, useEffect, useState } from "react";

/** What the reader chose. "system" follows the OS and is the default. */
export type ThemeMode = "system" | "light" | "dark";
/** What is actually on screen. */
export type Theme = "light" | "dark";

const KEY = "oneshot-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function storedMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function resolve(mode: ThemeMode): Theme {
  if (mode !== "system") return mode;
  return matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // the browser chrome takes the page's own ground colour
  const paper = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim();
  if (paper) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", paper);
}

/** System, light or dark. The choice is remembered; "system" is stored as the
 * absence of a choice, so it keeps following the OS as that changes. */
export function useTheme(): { mode: ThemeMode; theme: Theme; setMode: (m: ThemeMode) => void } {
  const [mode, setModeState] = useState<ThemeMode>(storedMode);
  const [theme, setTheme] = useState<Theme>(() => resolve(storedMode()));

  useEffect(() => {
    const update = () => setTheme(resolve(mode));
    update();
    if (mode !== "system") return;
    const mq = matchMedia(DARK_QUERY);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [mode]);

  useEffect(() => apply(theme), [theme]);

  const setMode = useCallback((m: ThemeMode) => {
    if (m === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, m);
    setModeState(m);
  }, []);

  return { mode, theme, setMode };
}
