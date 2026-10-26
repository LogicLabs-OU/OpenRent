const DIRECTIVE = { script: 'script-src', frame: 'frame-src', connect: 'connect-src', img: 'img-src', style: 'style-src' } as const;
/** Only plain https origins are accepted from a provider: no keywords, wildcards or paths. */
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;

/** Adds a payment provider's origins to the CSP that SvelteKit built (with its nonce) for this page. */
export function withSources(policy: string, extra: NonNullable<App.Locals['csp']>) {
  const parts = policy.split(';').map((p) => p.trim()).filter(Boolean);
  for (const [key, name] of Object.entries(DIRECTIVE)) {
    const add = (extra[key as keyof typeof DIRECTIVE] ?? []).filter((s) => ORIGIN.test(s));
    if (!add.length) continue;
    const i = parts.findIndex((p) => p.split(/\s+/)[0] === name);
    if (i >= 0) parts[i] = [parts[i], ...add.filter((s) => !parts[i]!.split(/\s+/).includes(s))].join(' ');
    else parts.push(`${name} 'self' ${add.join(' ')}`);
  }
  return parts.join('; ');
}
