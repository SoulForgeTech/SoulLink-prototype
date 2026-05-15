/**
 * Two fixed full-viewport overlay divs that render the diary
 * aesthetic's paper grain + soft radial wash. Mounted by the
 * /login route layout, so they only exist on auth pages and
 * unmount cleanly when the user navigates away.
 *
 * All styling lives in `_styles/diary-tokens.css` under
 * `.diary-grain-layer` and `.diary-wash-layer`, including the
 * SVG turbulence data URL and the `prefers-color-scheme`
 * blend-mode flip.
 */
export default function DiaryBackground() {
  return (
    <>
      <div className="diary-wash-layer" aria-hidden />
      <div className="diary-grain-layer" aria-hidden />
    </>
  );
}
