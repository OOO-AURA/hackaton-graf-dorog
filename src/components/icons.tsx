import type { ReactNode, SVGProps } from 'react';

/** Small stroke icons on a 20px grid, drawn for this app. */
const PATHS: Record<string, ReactNode> = {
  select: <path d="M5 3l10 6.5-4.5 1.2L8.3 15z" />,
  eye: <><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" /><circle cx="10" cy="10" r="2.4" /></>,
  road: <><path d="M6 17L9 3M14 17L11 3" /><path d="M10 6v1.5M10 10v1.5M10 14v1.5" /></>,
  node: <><path d="M3 14L17 6" /><circle cx="10" cy="10" r="2.6" /></>,
  signal: <><rect x="7" y="2.5" width="6" height="12" rx="2" /><circle cx="10" cy="5.6" r="1" /><circle cx="10" cy="8.6" r="1" /><circle cx="10" cy="11.6" r="1" /><path d="M10 14.5V18" /></>,
  undo: <path d="M7 5L3.5 8.5 7 12M4 8.5h8a4.5 4.5 0 010 9H9" />,
  redo: <path d="M13 5l3.5 3.5L13 12M16 8.5H8a4.5 4.5 0 000 9h3" />,
  plus: <path d="M10 4v12M4 10h12" />,
  minus: <path d="M4 10h12" />,
  fit: <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />,
  north: <><path d="M10 2.5l4 12-4-2.5-4 2.5z" /></>,
  open: <path d="M2.5 5.5V15a1 1 0 001 1h13a1 1 0 001-1V7.5a1 1 0 00-1-1H9.5L8 4.5H3.5a1 1 0 00-1 1z" />,
  save: <><path d="M4 3h9.5L17 6.5V16a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M6.5 3v4h6V3M6 17v-5h8v5" /></>,
  check: <path d="M4 10.5l4 4 8-9" />,
  play: <path d="M6 4l10 6-10 6z" />,
  pause: <path d="M7 4v12M13 4v12" />,
  step: <path d="M5 4l8 6-8 6zM15 4v12" />,
  stop: <rect x="5" y="5" width="10" height="10" rx="1" />,
  sun: <><circle cx="10" cy="10" r="3.5" /><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4" /></>,
  moon: <path d="M15.5 12.5A6.5 6.5 0 017.5 4.5a6.5 6.5 0 108 8z" />,
  search: <><circle cx="8.5" cy="8.5" r="5" /><path d="M12.3 12.3L17 17" /></>,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  chevron: <path d="M5 8l5 5 5-5" />,
  layers: <><path d="M10 3l7.5 4L10 11 2.5 7z" /><path d="M2.5 10.5L10 14.5l7.5-4M2.5 14L10 18l7.5-4" /></>,
  flip: <path d="M4 7h11l-3-3M16 13H5l3 3" />,
  reverse: <path d="M15 6a6 6 0 10.8 6M15.5 2.5V6.3h-3.8" />,
  scissors: <><circle cx="5.5" cy="14.5" r="2.5" /><circle cx="14.5" cy="14.5" r="2.5" /><path d="M7 12.5L15 3M13 12.5L5 3" /></>,
  trash: <path d="M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l1 11h8l1-11" />,
  building: <><path d="M4 17V6.5L10 3l6 3.5V17z" /><path d="M8 17v-4h4v4M7.5 8h1M11.5 8h1M7.5 10.8h1M11.5 10.8h1" /></>,
  dock: <><rect x="2.5" y="3.5" width="15" height="13" rx="1" /><path d="M2.5 12h15" /></>,
  info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v5M10 6.2v.2" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {PATHS[name]}
    </svg>
  );
}
