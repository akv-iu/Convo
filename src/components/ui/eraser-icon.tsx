/**
 * A small eraser, marking a badge line you can tap to remove. Decorative:
 * the line's switch beside the badge carries the name for screen readers.
 */
export function EraserIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-eraser=""
      className={`inline-block size-4 shrink-0 ${className}`}
    >
      {/* The rubber, tilted, with its tip shaded, on the line it rubs out. */}
      <path d="M9 2 14 7 8 13 3 8Z" />
      <path d="M3 8 8 13 11 10 6 5Z" fill="currentColor" fillOpacity="0.35" stroke="none" />
      <path d="M6 5 11 10" />
      <path d="M8 14.5h6" />
    </svg>
  );
}
