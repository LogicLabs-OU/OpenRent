import { describe, expect, it } from 'vitest';
import { cleanRichText, richTextHtml, richTextPlain } from '../src/storefront/code.ts';

describe('product descriptions', () => {
  it('cleans rich text to a small set of tags and keeps plain text as it is', () => {
    expect(cleanRichText('<p>Light <strong>and</strong> fast<script>alert(1)</script></p><img src=x onerror=alert(1)>')).toBe('<p>Light <strong>and</strong> fast</p>');
    expect(cleanRichText('<a href="javascript:alert(1)">x</a><a href="https://example.com" target="_blank">ok</a>')).toBe('<a>x</a><a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>');
    expect(cleanRichText('Line one\nLine 2 < 3')).toBe('Line one\nLine 2 < 3');
  });
  it('turns plain text into paragraphs for the storefront', () => {
    expect(richTextHtml('Kayak with paddle.\nSpray deck included.\n\nBook early & save <3')).toBe('<p>Kayak with paddle.<br>Spray deck included.</p><p>Book early &amp; save &lt;3</p>');
  });
  it('gives plain text for cards and meta tags', () => {
    expect(richTextPlain('<h2>Kayak</h2><p>Fast &amp; light</p><ul><li>Paddle</li><li>Deck</li></ul>')).toBe('Kayak\nFast & light\nPaddle\nDeck');
  });
});
