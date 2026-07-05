/** Pure markdown-section parsing shared by career config + watchlist (client-safe: no node imports). */

/** Bullet items (`- item`) under a `## Heading`, until the next heading. */
export function parseSection(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const items: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inSection = h[1].trim().toLowerCase() === heading.toLowerCase();
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      const item = bullet[1].trim();
      if (item) items.push(item);
    }
  }
  return items;
}
