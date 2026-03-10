/**
 * Utility functions for the SoulLink app.
 *
 * Includes both ported helpers from the original index.html
 * (formatMessageTime, shouldShowTimeSeparator, debounce, escapeHtml)
 * and new general-purpose utilities.
 */

import type { Message } from '@/types';

// ==================== Time Formatting ====================

/**
 * Format a message timestamp in WeChat style.
 *
 * - Today: "3:45 PM"
 * - Yesterday: "Yesterday 3:45 PM"
 * - Within 7 days: "Mon 3:45 PM"
 * - Same year: "3/15 3:45 PM"
 * - Different year: "3/15/2025 3:45 PM"
 *
 * Chinese locale uses period-of-day prefixes (凌晨, 上午, 中午, 下午, 晚上).
 *
 * @param dateInput - Date string, Date object, or null/undefined.
 * @param language - 'zh-CN' for Chinese formatting, anything else for English.
 */
export function formatMessageTime(
  dateInput: string | Date | null | undefined,
  language: string = 'en',
): string {
  if (!dateInput) return '';

  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);

  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const isZh = language === 'zh-CN';

  let timeStr: string;
  if (isZh) {
    const period =
      hours < 6
        ? '\u51CC\u6668'
        : hours < 12
          ? '\u4E0A\u5348'
          : hours < 13
            ? '\u4E2D\u5348'
            : hours < 18
              ? '\u4E0B\u5348'
              : '\u665A\u4E0A';
    const h12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    timeStr = `${period}${h12}:${minutes}`;
  } else {
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    timeStr = `${h12}:${minutes} ${ampm}`;
  }

  if (diffDays === 0) return timeStr;
  if (diffDays === 1) return isZh ? `\u6628\u5929 ${timeStr}` : `Yesterday ${timeStr}`;

  if (diffDays < 7) {
    const weekdays = isZh
      ? ['\u5468\u65E5', '\u5468\u4E00', '\u5468\u4E8C', '\u5468\u4E09', '\u5468\u56DB', '\u5468\u4E94', '\u5468\u516D']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${weekdays[date.getDay()]} ${timeStr}`;
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (date.getFullYear() === now.getFullYear()) {
    return isZh
      ? `${month}\u6708${day}\u65E5 ${timeStr}`
      : `${month}/${day} ${timeStr}`;
  }

  return isZh
    ? `${date.getFullYear()}\u5E74${month}\u6708${day}\u65E5 ${timeStr}`
    : `${month}/${day}/${date.getFullYear()} ${timeStr}`;
}

/**
 * Determine if a time separator should be shown between two messages.
 *
 * Returns true if:
 * - It is the first message (prevMsg is null/undefined)
 * - The gap between the two messages exceeds 5 minutes
 */
export function shouldShowTimeSeparator(
  prevMsg: Message | null | undefined,
  currMsg: Message | null | undefined,
): boolean {
  if (!currMsg) return false;
  if (!prevMsg) return true;

  const prevTime = prevMsg.timestamp ? new Date(prevMsg.timestamp) : null;
  const currTime = currMsg.timestamp ? new Date(currMsg.timestamp) : null;

  if (!prevTime || !currTime) return false;

  return currTime.getTime() - prevTime.getTime() > 5 * 60 * 1000;
}

// ==================== Duration & Relative Time ====================

/**
 * Format a duration in seconds as m:ss.
 *
 * @example formatDuration(125) => "2:05"
 * @example formatDuration(3)   => "0:03"
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Format an ISO timestamp as a relative time string for chat separators.
 *
 * - < 1 min:   "Just now" / "刚刚"
 * - < 60 min:  "5 minutes ago" / "5分钟前"
 * - < 24 hrs:  "3 hours ago" / "3小时前"
 * - Otherwise: falls back to formatMessageTime for absolute display
 */
export function formatTimeSeparator(
  isoString: string | null | undefined,
  language: string = 'en',
): string {
  if (!isoString) return '';

  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const isZh = language === 'zh-CN';

  if (diffMin < 1) {
    return isZh ? '\u521A\u521A' : 'Just now';
  }
  if (diffMin < 60) {
    return isZh
      ? `${diffMin}\u5206\u949F\u524D`
      : `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  }
  if (diffHrs < 24) {
    return isZh
      ? `${diffHrs}\u5C0F\u65F6\u524D`
      : `${diffHrs} hour${diffHrs === 1 ? '' : 's'} ago`;
  }

  return formatMessageTime(date, language);
}

// ==================== General Utilities ====================

/**
 * Generate a unique ID string (timestamp + random hex).
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Clamp a number between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Create a debounced version of a function.
 *
 * The returned function delays invoking `fn` until after `delay` milliseconds
 * have elapsed since the last time it was invoked.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, delay);
  };
}

// ==================== Environment Detection ====================

/**
 * Returns true when running in a browser environment (not SSR).
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Returns true on mobile / touch devices (user-agent or touch heuristic).
 */
export function isMobile(): boolean {
  if (!isBrowser()) return false;
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    ) || ('ontouchstart' in window && window.innerWidth < 768)
  );
}

// ==================== Encoding ====================

/**
 * Decode a Base64 string into a Uint8Array.
 *
 * Useful for converting base64-encoded audio or binary data
 * received from the API into a typed array for playback or processing.
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const binaryStr = atob(b64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

// ==================== HTML Escaping ====================

/**
 * Escape HTML special characters to prevent XSS.
 *
 * In the browser this uses a temporary DOM element (textContent -> innerHTML).
 * For SSR or non-browser environments, falls back to string replacement.
 */
export function escapeHtml(text: string): string {
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // SSR-safe fallback
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
