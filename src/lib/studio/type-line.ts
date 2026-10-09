export function revealHighlighted(
  text: string,
  highlight: string,
  count: number,
): { before: string; highlight: string; after: string } {
  const shown = text.slice(0, Math.max(0, Math.min(count, text.length)));
  const at = highlight ? text.indexOf(highlight) : -1;
  if (at < 0) return { before: shown, highlight: "", after: "" };
  return {
    before: shown.slice(0, at),
    highlight: shown.slice(at, at + highlight.length),
    after: shown.slice(at + highlight.length),
  };
}
