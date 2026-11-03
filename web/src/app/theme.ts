import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "oneshot-theme";
const system = (): Theme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101217" : "#F7F8FA");
}

/** Follows the OS until the user picks a theme; the choice is remembered. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme | null) ?? system());
  useEffect(() => apply(theme), [theme]);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => !localStorage.getItem(KEY) && setTheme(system());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, next);
      return next;
    });
  }, []);
  return [theme, toggle];
}
