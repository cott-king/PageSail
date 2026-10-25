/**
 * Small hand-drawn stroke icon set (original artwork, MIT like the rest of PageSail).
 * Icons are decorative: every button using one also carries a visible label or aria-label.
 */
const PATHS = {
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15.5 9.5h.01',
  convert: 'M4 8h13l-3-3 M20 16H7l3 3',
  pages: 'M8 3h9a2 2 0 0 1 2 2v12 M5 7h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  select: 'M5 3l14 8-6 2-2 6z',
  text: 'M5 6V4h14v2 M12 4v16 M9 20h6',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L19 5 M10 5h9v9',
  pen: 'M3 17c3-1 4-6 7-6s2 5 5 5 4-4 6-5',
  imageAdd: 'M4 5h11 M4 5v14h16v-6 M4 16l5-5 4 4 2-2 5 5 M19 3v6 M16 6h6',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  rotateLeft: 'M4 4v6h6 M4.5 10A8 8 0 1 1 6 16.5',
  rotateRight: 'M20 4v6h-6 M19.5 10A8 8 0 1 0 18 16.5',
  flipH: 'M12 3v18 M8 7L3 12l5 5z M16 7l5 5-5 5z',
  flipV: 'M3 12h18 M7 8l5-5 5 5z M7 16l5 5 5-5z',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14 M2 6h14a2 2 0 0 1 2 2v14',
  resize: 'M14 4h6v6 M10 20H4v-6 M20 4l-7 7 M4 20l7-7',
  download: 'M12 4v11 M7 10l5 5 5-5 M4 20h16',
  upload: 'M12 20V9 M7 14l5-5 5 5 M4 4h16',
  close: 'M6 6l12 12 M18 6L6 18',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  zoomIn: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M20 20l-4-4 M8 11h6 M11 8v6',
  zoomOut: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M20 20l-4-4 M8 11h6',
  fit: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
  plus: 'M12 5v14 M5 12h14',
  arrowUp: 'M12 19V5 M6 11l6-6 6 6',
  arrowDown: 'M12 5v14 M6 13l6 6 6-6',
  arrowLeft: 'M19 12H5 M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14 M13 6l6 6-6 6',
  bringForward: 'M8 8h12v12H8z M4 16V4h12',
  sendBackward: 'M4 4h12v12H4z M8 20h12V8',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 7.5-2',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z M9 12l2 2 4-4',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M3 12h18 M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5',
  split: 'M4 4h6v16H4z M14 4h6v16h-6z',
  merge: 'M5 4v6l7 5 7-5V4 M12 15v5',
  check: 'M5 12l5 5 9-9',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  contrast: 'M12 3a9 9 0 1 1 0 18z M12 3a9 9 0 1 0 0 18',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 11v6 M12 7.5h.01',
  warning: 'M12 3l10 18H2z M12 10v5 M12 18h.01',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7 M4 4v5h5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
