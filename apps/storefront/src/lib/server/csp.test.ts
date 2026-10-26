import { describe, expect, it } from 'vitest';
import { withSources } from './csp.ts';

describe('payment provider CSP sources', () => {
  const base = "default-src 'self'; script-src 'self' 'nonce-abc'; connect-src 'self'; img-src 'self' data: https:";

  it('adds origins to the directives SvelteKit built, keeping the nonce', () => {
    const out = withSources(base, { script: ['https://js.stripe.com'], connect: ['https://api.stripe.com'], frame: ['https://js.stripe.com'] });
    expect(out).toContain("script-src 'self' 'nonce-abc' https://js.stripe.com");
    expect(out).toContain("connect-src 'self' https://api.stripe.com");
    expect(out).toContain("frame-src 'self' https://js.stripe.com");
  });

  it('ignores anything that is not a plain https origin', () => {
    const out = withSources(base, { script: ["'unsafe-inline'", 'https://*.evil.example', 'http://plain.example', 'https://ok.example/path', 'https://ok.example'] });
    expect(out).toContain("script-src 'self' 'nonce-abc' https://ok.example");
    expect(out).not.toMatch(/unsafe-inline|evil|plain|\/path/);
    expect(withSources(base, {})).toBe(base);
  });
});
