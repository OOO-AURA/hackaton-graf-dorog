/**
 * Traffic signs and transport symbols as SVG, drawn after GOST R 52290: one picture for the
 * panels (as <img>) and for the map (rasterised into a MapLibre image). viewBox is 48×48.
 */

const RED = '#D7261E';
const BLUE = '#1E5BB8';
const INK = '#1A1A1A';
const YELLOW = '#F6C31B';

/** Warning sign frame (1.x): white triangle, red border, point up. */
const warning = (inner: string) =>
  `<path d="M24 3 L46 42 H2 Z" fill="#fff"/><path d="M24 5 L44.6 41 H3.4 Z" fill="${RED}"/><path d="M24 14.5 L36.4 35.6 H11.6 Z" fill="#fff"/>${inner}`;

/** Service sign frame (5.x): blue square with white edge. */
const service = (inner: string) =>
  `<rect x="2" y="2" width="44" height="44" rx="3" fill="#fff"/><rect x="4" y="4" width="40" height="40" rx="2" fill="${BLUE}"/>${inner}`;

const pedestrian = (x: number, y: number, s: number, fill: string) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}"><circle cx="1" cy="-9" r="2.6"/>` +
  `<path d="M-1.2 -5.6 L3 -5.8 L5.6 -1.4 L4 -0.6 L2.4 -3 L1.6 1 L4.6 4.6 L5 9.6 L2.8 9.8 L2.4 5.6 L-0.4 2.8 L-2 6.6 L-5.2 9.4 L-6.6 7.8 L-4 5 L-2.4 -1.6 L-3.8 0.6 L-6 -0.2 Z"/></g>`;

const bus = (fill: string, bg: string) =>
  `<rect x="10" y="12" width="28" height="22" rx="4" fill="${fill}"/><rect x="13" y="15" width="22" height="8" rx="1.5" fill="${bg}"/>` +
  `<circle cx="16" cy="34" r="3" fill="${fill}"/><circle cx="32" cy="34" r="3" fill="${fill}"/><rect x="14" y="27" width="4" height="2" fill="${bg}"/><rect x="30" y="27" width="4" height="2" fill="${bg}"/>`;

const tram = (fill: string, bg: string) =>
  `<path d="M18 9 L24 13 L30 9" stroke="${fill}" stroke-width="2" fill="none"/><rect x="12" y="14" width="24" height="22" rx="4" fill="${fill}"/>` +
  `<rect x="15" y="17" width="18" height="8" rx="1.5" fill="${bg}"/><rect x="16" y="29" width="3" height="2" fill="${bg}"/><rect x="29" y="29" width="3" height="2" fill="${bg}"/>` +
  `<path d="M15 36 L12 40 M33 36 L36 40" stroke="${fill}" stroke-width="2.4"/>`;

const train = (fill: string, bg: string) =>
  `<rect x="13" y="8" width="22" height="28" rx="6" fill="${fill}"/><rect x="16" y="12" width="16" height="9" rx="1.5" fill="${bg}"/>` +
  `<circle cx="18.5" cy="29" r="2.2" fill="${bg}"/><circle cx="29.5" cy="29" r="2.2" fill="${bg}"/>` +
  `<path d="M16 36 L12 42 M32 36 L36 42 M14 40 H34" stroke="${fill}" stroke-width="2.4"/>`;

export const SIGN_SVG: Record<string, string> = {
  // 1.8 «Светофорное регулирование».
  signal: warning(`<rect x="20.6" y="19" width="6.8" height="15.6" rx="1.6" fill="${INK}"/><circle cx="24" cy="22.2" r="1.9" fill="${RED}"/><circle cx="24" cy="26.8" r="1.9" fill="${YELLOW}"/><circle cx="24" cy="31.4" r="1.9" fill="#2FA84F"/>`),
  // 1.17 «Искусственная неровность».
  bump: warning(`<path d="M13.5 33.6 H34.5" stroke="${INK}" stroke-width="1.8"/><path d="M18 33.6 Q24 25 30 33.6 Z" fill="${INK}"/>`),
  // 2.4 «Уступите дорогу».
  give_way: `<path d="M2 6 H46 L24 45 Z" fill="#fff"/><path d="M4.6 7.5 H43.4 L24 42 Z" fill="${RED}"/><path d="M14 12.5 H34 L24 30.5 Z" fill="#fff"/>`,
  // 2.5 «Движение без остановки запрещено».
  stop: `<path d="M15.2 2 H32.8 L46 15.2 V32.8 L32.8 46 H15.2 L2 32.8 V15.2 Z" fill="#fff"/><path d="M16 4 H32 L44 16 V32 L32 44 H16 L4 32 V16 Z" fill="${RED}"/>` +
    `<text x="24" y="28.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="12.5" fill="#fff" letter-spacing="-0.3">STOP</text>`,
  // 2.1 «Главная дорога».
  main_road: `<path d="M24 2 L46 24 L24 46 L2 24 Z" fill="${INK}"/><path d="M24 4 L44 24 L24 44 L4 24 Z" fill="#fff"/><path d="M24 10 L38 24 L24 38 L10 24 Z" fill="${YELLOW}"/>`,
  // 5.19.1 «Пешеходный переход».
  crossing: service(`<path d="M24 7 L42 40 H6 Z" fill="#fff"/><path d="M12.5 37.5 H35.5" stroke="${INK}" stroke-width="3.2" stroke-dasharray="2.6 1.6"/>${pedestrian(23.5, 25, 1.05, INK)}`),
  // 5.16 «Место остановки автобуса».
  bus_stop: service(bus('#fff', BLUE)),
  // 5.17 «Место остановки трамвая».
  tram_stop: service(tram('#fff', BLUE)),
  // Railway station and halt (map symbols, not road signs).
  station: `<rect x="2" y="2" width="44" height="44" rx="8" fill="#fff"/><rect x="4" y="4" width="40" height="40" rx="7" fill="#B3261E"/>${train('#fff', '#B3261E')}`,
  halt: `<circle cx="24" cy="24" r="22" fill="#fff"/><circle cx="24" cy="24" r="20" fill="#C9503F"/>${train('#fff', '#C9503F')}`,
};

/** White disc with a red ring: prohibitory signs 3.x. */
const prohibit = (inner: string, bar = false) =>
  `<circle cx="24" cy="24" r="22" fill="#fff"/><circle cx="24" cy="24" r="21" fill="${RED}"/><circle cx="24" cy="24" r="16.2" fill="#fff"/>${inner}` +
  (bar ? `<path d="M12.6 12.6 L35.4 35.4" stroke="${RED}" stroke-width="3.6"/>` : '');
/** Blue disc: mandatory signs 4.x. */
const mandatory = (inner: string) => `<circle cx="24" cy="24" r="22" fill="#fff"/><circle cx="24" cy="24" r="20.5" fill="${BLUE}"/>${inner}`;
const arrow = (d: string) => `<path d="${d}" stroke="#fff" stroke-width="4.2" fill="none" stroke-linejoin="round"/>`;
const head = (x: number, y: number, deg: number, fill = '#fff') => `<path d="M0 -7 L6 2 H-6 Z" fill="${fill}" transform="translate(${x} ${y}) rotate(${deg})"/>`;

/** Pictures of the placeable signs (osm/trafficSigns.ts) by code; `value` is the number on 3.24. */
export function codeSvgBody(code: string, value?: number): string | undefined {
  switch (code) {
    case 'signal': return `<rect x="15" y="3" width="18" height="42" rx="5" fill="${INK}"/><circle cx="24" cy="12" r="5" fill="${RED}"/><circle cx="24" cy="24" r="5" fill="${YELLOW}"/><circle cx="24" cy="36" r="5" fill="#2FA84F"/>`;
    case 'signal_ped': return `<rect x="12" y="4" width="24" height="40" rx="5" fill="${INK}"/><rect x="16" y="8" width="16" height="15" rx="2" fill="#5a1210"/>${pedestrian(24, 16, 0.55, RED)}<rect x="16" y="25" width="16" height="15" rx="2" fill="#0f3a1c"/>${pedestrian(24, 33, 0.55, '#2FA84F')}`;
    case '1.8': return SIGN_SVG.signal;
    case '2.1': return SIGN_SVG.main_road;
    case '2.2': return `${SIGN_SVG.main_road}<path d="M12 36 L36 12" stroke="${INK}" stroke-width="2.4"/><path d="M14 38 L38 14" stroke="${INK}" stroke-width="1.2"/>`;
    case '2.4': return SIGN_SVG.give_way;
    case '2.5': return SIGN_SVG.stop;
    case '3.1': return `<circle cx="24" cy="24" r="22" fill="#fff"/><circle cx="24" cy="24" r="21" fill="${RED}"/><rect x="10" y="20.5" width="28" height="7" fill="#fff"/>`;
    case '3.2': return prohibit('');
    case '3.4': return prohibit(`<rect x="13" y="19" width="15" height="11" fill="${INK}"/><rect x="28" y="22" width="7" height="8" fill="${INK}"/><circle cx="17" cy="31.5" r="2.4" fill="${INK}"/><circle cx="31" cy="31.5" r="2.4" fill="${INK}"/>`);
    case '3.18.1': return prohibit(`<path d="M20 36 V24 Q20 18 26 18 H28" stroke="${INK}" stroke-width="3.4" fill="none"/>${head(31, 18, 90, INK)}`, true);
    case '3.18.2': return prohibit(`<path d="M28 36 V24 Q28 18 22 18 H20" stroke="${INK}" stroke-width="3.4" fill="none"/>${head(17, 18, -90, INK)}`, true);
    case '3.19': return prohibit(`<path d="M28 36 V22 Q28 14 22 14 Q16 14 16 22 V26" stroke="${INK}" stroke-width="3.4" fill="none"/>${head(16, 29, 180, INK)}`, true);
    case '3.20': return prohibit(`<rect x="11" y="20" width="11" height="12" rx="2" fill="${RED}"/><rect x="26" y="20" width="11" height="12" rx="2" fill="${INK}"/>`);
    case '3.24': return prohibit(`<text x="24" y="30.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${String(value ?? 40).length > 2 ? 14 : 17}" fill="${INK}">${value ?? 40}</text>`);
    case '3.27': return `<circle cx="24" cy="24" r="22" fill="#fff"/><circle cx="24" cy="24" r="21" fill="${RED}"/><circle cx="24" cy="24" r="16.2" fill="${BLUE}"/><path d="M12.6 12.6 L35.4 35.4 M35.4 12.6 L12.6 35.4" stroke="${RED}" stroke-width="3.6"/>`;
    case '3.28': return `<circle cx="24" cy="24" r="22" fill="#fff"/><circle cx="24" cy="24" r="21" fill="${RED}"/><circle cx="24" cy="24" r="16.2" fill="${BLUE}"/><path d="M12.6 12.6 L35.4 35.4" stroke="${RED}" stroke-width="3.6"/>`;
    case '4.1.1': return mandatory(`${arrow('M24 38 V16')}${head(24, 13, 0)}`);
    case '4.1.2': return mandatory(`${arrow('M20 38 V26 Q20 20 26 20 H30')}${head(33, 20, 90)}`);
    case '4.1.3': return mandatory(`${arrow('M28 38 V26 Q28 20 22 20 H18')}${head(15, 20, -90)}`);
    case '5.19': return SIGN_SVG.crossing;
    case '5.16': return SIGN_SVG.bus_stop;
    case '5.20': return service(`<path d="M10 33 H38" stroke="#fff" stroke-width="2.4"/><path d="M15 33 Q24 18 33 33 Z" fill="#fff"/>`);
    case '5.21': return service(`<rect x="10" y="22" width="12" height="12" fill="#fff"/><path d="M8 23 L16 15 L24 23" fill="#fff"/>${pedestrian(31, 29, 0.7, '#fff')}`);
    case '5.5': return service(`${arrow('M24 38 V16')}${head(24, 12, 0)}`);
    case '8.13': return `<rect x="3" y="10" width="42" height="28" rx="2" fill="#fff" stroke="${INK}" stroke-width="1.5"/><path d="M16 34 V24 H32 V16" stroke="${INK}" stroke-width="3.4" fill="none"/><path d="M24 34 V24" stroke="${INK}" stroke-width="1.6"/>`;
    default: return undefined;
  }
}

/** A sign id of the map: a kind of SIGN_SVG, or `ts:<code>` / `ts:<code>:<value>` for a placed sign. */
export const signSvg = (id: string): string | undefined => {
  let body: string | undefined = SIGN_SVG[id];
  if (!body && id.startsWith('ts:')) {
    const [, code, value] = id.split(':');
    body = codeSvgBody(code, value ? Number(value) : undefined);
  }
  return body && `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`;
};

export const signUrl = (id: string): string | undefined => {
  const svg = signSvg(id);
  return svg && `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

/** Rasterises a sign at `px` device pixels; resolves to null if the browser cannot. */
export function signBitmap(id: string, px: number): Promise<ImageData | null> {
  const url = signUrl(id);
  if (!url || typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image(px, px);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = px; c.height = px;
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, px, px);
      resolve(ctx.getImageData(0, 0, px, px));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
