/** The app's display language for formatters. Reactive, so amounts re-render when an app switches language. */
const state = $state<{ current: string | undefined }>({ current: undefined });

export function setFormatLocale(locale: string | undefined) {
  state.current = locale;
}

export function formatLocale(): string | undefined {
  return state.current;
}
