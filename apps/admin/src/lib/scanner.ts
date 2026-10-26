/**
 * How this device's scanner types (FR-SCAN-2). Kept in the browser: each counter can have its own
 * scanner. Prefix and suffix are stripped; `terminator: 'none'` ends a scan when the keys stop.
 */
export interface ScannerConfig {
  prefix: string;
  suffix: string;
  terminator: 'Enter' | 'Tab' | 'none';
  maxGapMs: number;
  minLength: number;
}

export const DEFAULT_SCANNER: ScannerConfig = { prefix: '', suffix: '', terminator: 'Enter', maxGapMs: 50, minLength: 4 };
const STORAGE_KEY = 'openrent.scanner';

export function scannerConfig(): ScannerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SCANNER, ...JSON.parse(raw) } : DEFAULT_SCANNER;
  } catch {
    return DEFAULT_SCANNER;
  }
}

export function saveScannerConfig(c: ScannerConfig | null) {
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: the defaults apply */
  }
  window.dispatchEvent(new Event('openrent:scanner-config'));
}

/** Prefix and suffix off a raw scan. */
export function cleanScan(raw: string, c: ScannerConfig) {
  let code = raw;
  if (c.prefix && code.startsWith(c.prefix)) code = code.slice(c.prefix.length);
  if (c.suffix && code.endsWith(c.suffix)) code = code.slice(0, -c.suffix.length);
  return code;
}

/**
 * Learns the scanner's settings from one scan of a barcode whose printed text is `expected`:
 * what comes before and after it, the key that ended the scan and how fast the keys came.
 */
export function detectScanner(keys: { key: string; at: number }[], expected: string): ScannerConfig {
  const terminator = keys.at(-1)?.key === 'Enter' ? 'Enter' : keys.at(-1)?.key === 'Tab' ? 'Tab' : 'none';
  const chars = keys.filter((k) => k.key.length === 1);
  const raw = chars.map((k) => k.key).join('');
  const at = expected ? raw.indexOf(expected) : -1;
  const gaps = chars.slice(1).map((k, i) => k.at - chars[i]!.at);
  const slowest = gaps.length ? Math.max(...gaps) : DEFAULT_SCANNER.maxGapMs;
  return {
    prefix: at > 0 ? raw.slice(0, at) : '',
    suffix: at >= 0 ? raw.slice(at + expected.length) : '',
    terminator,
    // Room for a busy computer (never below the default), but still faster than anyone types.
    maxGapMs: Math.min(150, Math.max(DEFAULT_SCANNER.maxGapMs, Math.ceil(slowest * 2))),
    minLength: Math.max(1, Math.min(DEFAULT_SCANNER.minLength, (expected || raw).length)),
  };
}

/**
 * HID barcode scanners type fast (PRD §4.2.2): keys arriving within `maxGapMs` of each other, at least
 * `minLength` characters, ended by the configured key or, without one, by a pause. Typing in inputs is
 * ignored unless the input opts in (data-scan).
 */
let paused = false;
/** The scanner setup dialog reads raw keys itself; scans are not looked up meanwhile. */
export function pauseScans(on: boolean) {
  paused = on;
}

export function listenForScans(onScan: (code: string) => void, opts: Partial<ScannerConfig> = {}) {
  let c: ScannerConfig = { ...scannerConfig(), ...opts };
  const reload = () => (c = { ...scannerConfig(), ...opts });
  let buf = '';
  let last = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let fromInput = false;
  const finish = (e?: KeyboardEvent) => {
    const code = cleanScan(buf, c);
    if (code.length >= c.minLength && !fromInput) {
      e?.preventDefault();
      onScan(code);
    }
    buf = '';
  };
  const handler = (e: KeyboardEvent) => {
    if (paused) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) && !target.dataset.scan;
    const now = performance.now();
    if (now - last > c.maxGapMs) buf = '';
    last = now;
    clearTimeout(idle);
    if (c.terminator !== 'none' && e.key === c.terminator) return finish(e);
    if (e.key === 'Enter' || e.key === 'Tab') {
      buf = '';
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!buf) fromInput = typing;
      buf += e.key;
      if (c.terminator === 'none') idle = setTimeout(() => finish(), c.maxGapMs * 3);
    }
  };
  window.addEventListener('keydown', handler, true);
  window.addEventListener('openrent:scanner-config', reload);
  return () => {
    clearTimeout(idle);
    window.removeEventListener('keydown', handler, true);
    window.removeEventListener('openrent:scanner-config', reload);
  };
}

let ctx: AudioContext | null = null;
/** Audible feedback: high short tone on success, low double tone on error. */
export function beep(ok: boolean) {
  try {
    ctx ??= new AudioContext();
    const tones = ok ? [[880, 0.08]] : [[220, 0.12], [180, 0.12]];
    let t = ctx.currentTime;
    for (const [f, len] of tones) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f!;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + len!);
      t += len! + 0.04;
    }
  } catch {
    /* audio not available */
  }
}
