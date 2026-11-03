export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "fastidious:theme";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function applyTheme(
  root: HTMLElement,
  preference: ThemePreference,
  darkMode: Pick<MediaQueryList, "matches">,
) {
  const resolved = preference === "system" ? (darkMode.matches ? "dark" : "light") : preference;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export const themeInitializationScript = `(() => {
  try {
    const saved = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    const preference = saved === "light" || saved === "dark" ? saved : "system";
    const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const resolved = dark ? "dark" : "light";
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch (_) {}
})();`;
