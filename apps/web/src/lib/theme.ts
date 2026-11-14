import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "nearvoice:theme";

/** Light or dark; starts from the saved choice or the system, and follows the system until the user picks. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) ?? "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#090c13" : "#3b5bfd");
  }, [theme]);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const follow = (e: MediaQueryListEvent) => {
      try {
        if (!localStorage.getItem(KEY)) setTheme(e.matches ? "dark" : "light");
      } catch {
        /* storage blocked */
      }
    };
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);
  const toggle = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* storage blocked */
      }
      return next;
    });
  return [theme, toggle];
}
