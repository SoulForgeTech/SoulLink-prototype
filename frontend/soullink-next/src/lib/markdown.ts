/**
 * Lightweight Markdown renderer.
 *
 * Ported from renderMarkdown() in index.html (lines 11089-11128).
 *
 * Supports: headings (h1-h3), bold, italic, inline code, blockquotes,
 * horizontal rules, ordered/unordered lists, paragraphs, and line breaks.
 *
 * This is intentionally simple — not a full Markdown parser.
 * It is designed for rendering AI chat responses where the content
 * is pre-escaped and relatively well-structured.
 */

import { escapeHtml } from './utils';

/**
 * Render a Markdown-ish text string into HTML.
 *
 * The input text is first HTML-escaped, then Markdown patterns are
 * converted to their HTML equivalents. This prevents XSS while
 * supporting basic formatting in chat messages.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  let html = escapeHtml(text);

  // Headings: ### heading (h1-h3)
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule: --- or ***
  html = html.replace(/^[-*]{3,}\s*$/gm, '<hr>');

  // Blockquote: > text
  html = html.replace(/^&gt;\s*(.+)$/gm, '<blockquote>$1</blockquote>');

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic: *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Ordered list items: 1. item (must come before unordered)
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<ol-li>$1</ol-li>');

  // Unordered list items: - item or bullet
  html = html.replace(/^[-\u2022]\s+(.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Wrap consecutive <ol-li> in <ol>
  html = html.replace(/((?:<ol-li>.*?<\/ol-li>\n?)+)/g, (match) => {
    return '<ol>' + match.replace(/<\/?ol-li>/g, (t) => t.replace('ol-li', 'li')) + '</ol>';
  });

  // Paragraphs: double newline
  html = html.replace(/\n\n+/g, '</p><p>');

  // Single newline to <br>
  html = html.replace(/\n/g, '<br>');

  html = '<p>' + html + '</p>';

  // Clean up: remove <p> wrapping around block elements
  html = html.replace(/<p>(<(?:h[1-3]|ul|ol|hr|blockquote)[\s>])/g, '$1');
  html = html.replace(/(<\/(?:h[1-3]|ul|ol|hr|blockquote)>)<\/p>/g, '$1');
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p><br>/g, '<p>');

  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote><br><blockquote>/g, '<br>');

  return html;
}
