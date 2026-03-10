/**
 * Multi-bubble text splitter for WeChat-style chat UI.
 *
 * Ported from splitIntoBubbles() in index.html (lines 11131-11168).
 *
 * Splits AI response text into multiple chat bubbles (max 4) by paragraph,
 * with intelligent merging rules:
 * - Short fragments (<10 chars) merge into the previous bubble
 * - Consecutive list items merge together
 * - Excess bubbles beyond MAX_BUBBLES are evenly distributed
 */

/** Maximum number of bubbles to avoid fragmentation of long content. */
const MAX_BUBBLES = 4;

/**
 * Split a text response into multiple bubble segments.
 *
 * @param text - The full AI response text.
 * @returns An array of text segments, each becoming one chat bubble.
 *          Always returns at least one element.
 */
export function splitIntoBubbles(text: string): string[] {
  if (!text || !text.trim()) return [text || ''];

  // Split by double newlines (paragraph breaks)
  const raw = text.split(/\n\n+/);
  const bubbles: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i].trim();
    if (!seg) continue;

    const isListItem =
      seg.startsWith('-') ||
      seg.startsWith('\u2022') ||
      /^\d+\./.test(seg);

    // Short fragments (<10 chars) merge into the previous bubble
    // to avoid lonely fragments like "OK!" or "Sure!"
    if (
      bubbles.length > 0 &&
      seg.length < 10 &&
      !seg.startsWith('-') &&
      !seg.startsWith('\u2022') &&
      !/^\d+\./.test(seg)
    ) {
      bubbles[bubbles.length - 1] += '\n\n' + seg;
    }
    // Consecutive list items merge with the previous bubble
    // if the previous bubble also ends with a list item
    else if (bubbles.length > 0 && isListItem) {
      const prevEndsWithList = /(?:^|\n)[-\u2022]\s|(?:^|\n)\d+\.\s/.test(
        bubbles[bubbles.length - 1],
      );
      if (prevEndsWithList) {
        bubbles[bubbles.length - 1] += '\n\n' + seg;
      } else {
        bubbles.push(seg);
      }
    } else {
      bubbles.push(seg);
    }
  }

  // Single or empty → return as-is
  if (bubbles.length <= 1) {
    return bubbles.length > 0 ? bubbles : [text];
  }

  // Too many bubbles → evenly merge down to MAX_BUBBLES
  if (bubbles.length > MAX_BUBBLES) {
    const merged: string[] = [];
    const perGroup = Math.ceil(bubbles.length / MAX_BUBBLES);
    for (let i = 0; i < bubbles.length; i += perGroup) {
      merged.push(bubbles.slice(i, i + perGroup).join('\n\n'));
    }
    return merged;
  }

  return bubbles;
}
