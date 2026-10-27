/** A description cut to about 160 characters at a word, for search results. */
export function summary(text: string | null | undefined, max = 160): string | null {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s || null;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : cut.length)}…`;
}
