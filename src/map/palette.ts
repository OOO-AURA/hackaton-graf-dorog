import type { Theme } from '../state/ui';

/** Road classes shown in the legend, ordered from the busiest down. Colours follow the Sakura Chroma palette. */
export const ROAD_CLASSES = [
  { id: 'trunk', label: 'Скоростная, магистраль', match: ['motorway', 'trunk'] },
  { id: 'primary', label: 'Магистральная', match: ['primary'] },
  { id: 'secondary', label: 'Районная', match: ['secondary'] },
  { id: 'tertiary', label: 'Местного значения', match: ['tertiary'] },
  { id: 'residential', label: 'Жилая, без класса', match: ['residential', 'unclassified', 'road'] },
  { id: 'living', label: 'Жилая зона', match: ['living_street'] },
  { id: 'service', label: 'Проезд', match: ['service'] },
] as const;

export type RoadClassId = (typeof ROAD_CLASSES)[number]['id'];

export interface MapPalette {
  background: string;
  roads: Record<RoadClassId, string>;
  casing: string;
  bridgeCasing: string;
  arrow: string;
  building: string;
  buildingLine: string;
  path: string;
  tram: string;
  nodeFill: string;
  nodeStroke: string;
  signal: string;
  crossing: string;
  vertex: string;
  selection: string;
  error: string;
  warning: string;
  cordon: string;
  draw: string;
}

export const MAP_PALETTE: Record<Theme, MapPalette> = {
  light: {
    background: '#F1E6CB',
    roads: { trunk: '#E5392A', primary: '#F09131', secondary: '#F0BC2A', tertiary: '#3D9F47', residential: '#3F8BC4', living: '#E54489', service: '#B8A27E' },
    casing: '#3A2516',
    bridgeCasing: '#1B110A',
    arrow: '#3A2516',
    building: '#C9B48A',
    buildingLine: '#8C7350',
    path: '#9C8763',
    tram: '#7A4FA0',
    nodeFill: '#FBF6EA',
    nodeStroke: '#3A2516',
    signal: '#E5392A',
    crossing: '#FBF6EA',
    vertex: '#3F8BC4',
    selection: '#E54489',
    error: '#D92D20',
    warning: '#E07B12',
    cordon: '#3F8BC4',
    draw: '#E54489',
  },
  dark: {
    background: '#1C140E',
    roads: { trunk: '#F0503F', primary: '#F5A04A', secondary: '#F3C640', tertiary: '#55B45F', residential: '#5FA3D6', living: '#EE5C9C', service: '#8A7658' },
    casing: '#0E0905',
    bridgeCasing: '#F1E6CB',
    arrow: '#F1E6CB',
    building: '#4A3A2A',
    buildingLine: '#6E5A42',
    path: '#7A6750',
    tram: '#B48ADB',
    nodeFill: '#2F2319',
    nodeStroke: '#F1E6CB',
    signal: '#F0503F',
    crossing: '#F1E6CB',
    vertex: '#5FA3D6',
    selection: '#EE5C9C',
    error: '#FF5A47',
    warning: '#F5A04A',
    cordon: '#5FA3D6',
    draw: '#EE5C9C',
  },
};

/** MapLibre `match` expression from the OSM highway value (without `_link`) to the class colour. */
export function roadColorExpression(p: MapPalette): unknown {
  const pairs = ROAD_CLASSES.flatMap((c) => [[...c.match], p.roads[c.id]]);
  return ['match', ['get', 'highway'], ...pairs, p.roads.service];
}
