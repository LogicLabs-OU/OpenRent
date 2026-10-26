import type { Logger } from '@openrent/plugin-sdk';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const min: number = LEVELS[(globalThis.process?.env?.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

function write(level: Level, obj: unknown, msg?: string) {
  if (LEVELS[level] < min) return;
  const line = { level, time: new Date().toISOString(), app: 'storefront', msg: msg ?? (typeof obj === 'string' ? obj : undefined), ...(typeof obj === 'object' && obj ? (obj as object) : {}) };
  const out = level === 'error' || level === 'warn' ? globalThis.console.error : globalThis.console.log;
  out(JSON.stringify(line));
}

/** Structured JSON logger with the same shape as the API's (pino-style `logger.info(obj, msg)`). */
export const logger: Logger = {
  debug: (o, m) => write('debug', o, m),
  info: (o, m) => write('info', o, m),
  warn: (o, m) => write('warn', o, m),
  error: (o, m) => write('error', o, m),
};
