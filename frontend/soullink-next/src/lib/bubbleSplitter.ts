/**
 * Multi-bubble text splitter for WeChat-style chat UI.
 *
 * Splits AI response text into multiple chat bubbles (max 4):
 *   1. Primary split on \n\n (paragraph breaks the LLM emitted explicitly)
 *   2. Merge short fragments (<10 chars) and consecutive list items back into prev bubble
 *   3. **Secondary split**: any bubble >TARGET_BUBBLE_CHARS gets split on sentence
 *      boundaries (。！？.!?) so a single huge LLM paragraph still feels like
 *      multiple WeChat-style messages
 *   4. Cap at MAX_BUBBLES; merge excess by even grouping
 */

/** Maximum number of bubbles to avoid fragmentation of long content. */
const MAX_BUBBLES = 4;

/** Target max chars per bubble — anything over gets the sentence-split treatment. */
const TARGET_BUBBLE_CHARS = 80;

/** Minimum chars after sentence split — fragments shorter than this re-merge with neighbours. */
const MIN_FRAGMENT_CHARS = 18;

/**
 * Split a single long bubble into multiple sentence-bounded sub-bubbles.
 * Splits on Chinese 。！？〜 and ASCII .!? (followed by whitespace or end).
 * Re-merges fragments shorter than MIN_FRAGMENT_CHARS into their neighbours.
 */
function splitLongBubble(text: string): string[] {
  if (text.length <= TARGET_BUBBLE_CHARS) return [text];

  // Capture-and-keep split: keep the punctuation attached to the preceding sentence.
  // Match: any chars (lazy) up to a terminator (。！？〜.!?) optionally followed by a closing
  // quote / paren, then a non-letter or end-of-string.
  const sentences = text.match(
    /[^。！？〜.!?]*[。！？〜.!?]+["'）」』]?(?=\s|[^a-zA-Z一-鿿]|$)/g,
  ) || [text];

  // Re-merge fragments under MIN_FRAGMENT_CHARS into neighbours
  const merged: string[] = [];
  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (merged.length > 0 && (merged[merged.length - 1].length < MIN_FRAGMENT_CHARS || trimmed.length < MIN_FRAGMENT_CHARS)) {
      merged[merged.length - 1] += trimmed;
    } else {
      merged.push(trimmed);
    }
  }

  // Final pass: any bubble still over TARGET_BUBBLE_CHARS * 1.8 gets a hard char-cut.
  // (Catches single-sentence paragraphs that have no internal punctuation.)
  const HARD_CAP = Math.floor(TARGET_BUBBLE_CHARS * 1.8);
  const final: string[] = [];
  for (const m of merged) {
    if (m.length <= HARD_CAP) {
      final.push(m);
    } else {
      // Hard cut at HARD_CAP; rare path, only triggers on degenerate input
      for (let i = 0; i < m.length; i += HARD_CAP) {
        final.push(m.slice(i, i + HARD_CAP));
      }
    }
  }

  return final.length > 0 ? final : [text];
}

/**
 * Split a text response into multiple bubble segments.
 *
 * @param text - The full AI response text.
 * @returns An array of text segments, each becoming one chat bubble.
 *          Always returns at least one element.
 */
export function splitIntoBubbles(text: string): string[] {
  if (!text || !text.trim()) return [text || ''];

  // Step 1: primary split on \n\n
  const raw = text.split(/\n\n+/);
  const bubbles: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i].trim();
    if (!seg) continue;

    const isListItem =
      seg.startsWith('-') ||
      seg.startsWith('•') ||
      /^\d+\./.test(seg);

    // Short fragments (<10 chars) merge into previous bubble — avoid "OK!" lonely bubbles
    if (
      bubbles.length > 0 &&
      seg.length < 10 &&
      !seg.startsWith('-') &&
      !seg.startsWith('•') &&
      !/^\d+\./.test(seg)
    ) {
      bubbles[bubbles.length - 1] += '\n\n' + seg;
    }
    // Consecutive list items merge with previous bubble
    else if (bubbles.length > 0 && isListItem) {
      const prevEndsWithList = /(?:^|\n)[-•]\s|(?:^|\n)\d+\.\s/.test(
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

  if (bubbles.length === 0) return [text];

  // Step 2: secondary split — any over-long bubble gets sentence-split treatment.
  // This is the key fix for "LLM emits one giant paragraph" — without this, the whole
  // 200-char wall lands in a single bubble.
  const fineGrained: string[] = [];
  for (const b of bubbles) {
    fineGrained.push(...splitLongBubble(b));
  }

  // Step 3: cap at MAX_BUBBLES — merge tail excess
  if (fineGrained.length <= MAX_BUBBLES) return fineGrained;

  const groupSize = Math.ceil(fineGrained.length / MAX_BUBBLES);
  const merged: string[] = [];
  for (let i = 0; i < fineGrained.length; i += groupSize) {
    merged.push(fineGrained.slice(i, i + groupSize).join('\n\n'));
  }
  return merged;
}
