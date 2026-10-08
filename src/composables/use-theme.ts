import type { Ref } from 'vue';

import { effectScope, ref, watch } from 'vue';

const THEME_STORAGE_KEY = 'theme' as const;
const DARK_CLASS = 'dark' as const;

type UseThemeReturn = {
  /** Reactive flag - `true` when dark mode is active. */
  isDark: Ref<boolean>;
  /** Toggle between light and dark mode. */
  toggleTheme: () => void;
};

// Shared singleton ref so every consumer sees the same state.
const isDark = ref<boolean>(false);

function applyTheme(dark: boolean): void {
  if (dark) {
    document.documentElement.classList.add(DARK_CLASS);
  }
  else {
    document.documentElement.classList.remove(DARK_CLASS);
  }
  localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light');
}

function toggleTheme(): void {
  isDark.value = !isDark.value;
}

// Module-level persistent effect scope: registers a single watcher and
// runs initialization exactly once for the entire app lifetime.
let initialized = false;

const scope = effectScope(true);

scope.run(() => {
  // Sync DOM + storage whenever the reactive value changes.
  watch(isDark, (newVal: boolean) => {
    applyTheme(newVal);
  });
});

function initialize(): void {
  if (initialized)
    return;
  initialized = true;

  const saved: string | null = localStorage.getItem(THEME_STORAGE_KEY);

  if (saved !== null) {
    isDark.value = saved === 'dark';
  }
  else {
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
}

/**
 * Composable that manages the application's light / dark theme.
 *
 * - Persists the user's preference in `localStorage`.
 * - Falls back to the OS-level `prefers-color-scheme` media query.
 * - Adds / removes the `dark` class on `<html>` so CSS variables switch.
 *
 * Uses a module-level singleton so multiple consumers share the same
 * reactive state and only one watcher / initialization routine exists.
 */
export function useTheme(): UseThemeReturn {
  // Lazily initialize on first composable call (guaranteed to be in a
  // browser context where localStorage and matchMedia are available).
  initialize();

  return {
    isDark,
    toggleTheme,
  };
}
