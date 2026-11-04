import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "oneshot-theme";
const PAPER = { light: "#F2F0EB", dark: "#12110E" } as const;

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", PAPER[theme]);
}

/** Paper (light) is the default and the identity; dark is a choice, remembered. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(KEY) === "dark" ? "dark" : "light"));
  useEffect(() => apply(theme), [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, next);
      return next;
    });
  }, []);
  return [theme, toggle];
}
