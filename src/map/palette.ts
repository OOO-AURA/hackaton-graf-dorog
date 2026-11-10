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
  /** Soft shadow under bridges in 2D. */
  bridgeShadow: string;
  arrow: string;
  building: string;
  buildingLine: string;
  building3d: string;
  /** Sides of bridge decks, piers and tunnel portals in 3D. */
  bridgeSide: string;
  /** Tops of bridge parapets in 3D: a light outline of the deck. */
  bridgeParapet: string;
  /** Earth slopes of the embankments up to bridges in 3D. */
  embankment: string;
  /** Roads in the road map look: main, district and local roads, and their edges. */
  schemeMain: string;
  schemeMainEdge: string;
  schemeDistrict: string;
  schemeLocal: string;
  schemeEdge: string;
  /** Roads in the engineering look: asphalt with a light edge line. */
  asphalt: string;
  asphaltEdge: string;
  /** Lane lines when no flows are computed. */
  lane: string;
  /** Lane markings: a light line with a dark outline, so they show on a road of any colour. */
  laneMark: string;
  laneMarkCasing: string;
  path: string;
  /** Paved walks and sidewalks, cycleways, pedestrian squares, unpaved trails. */
  walk: string;
  cycle: string;
  square: string;
  trail: string;
  tram: string;
  /** Railway tracks, their ties and platforms. */
  rail: string;
  railTies: string;
  platform: string;
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
    bridgeShadow: 'rgba(58, 37, 22, 0.45)',
    arrow: '#3A2516',
    building: '#C9B48A',
    buildingLine: '#8C7350',
    building3d: '#D9C69C',
    bridgeSide: '#8C7350',
    bridgeParapet: '#F4EBDD',
    embankment: '#A3A07A',
    schemeMain: '#FFD45C',
    schemeMainEdge: '#D9962B',
    schemeDistrict: '#FFFFFF',
    schemeLocal: '#F3EFE6',
    schemeEdge: '#B9AE9A',
    asphalt: '#83838B',
    asphaltEdge: '#F4F1EA',
    lane: '#FBF6EA',
    laneMark: '#FFFFFF',
    laneMarkCasing: '#2B1D12',
    path: '#9C8763',
    walk: '#D8CDB6',
    cycle: '#9CC7A2',
    square: '#E4DAC4',
    trail: '#B5A47F',
    tram: '#7A4FA0',
    rail: '#5B5B63',
    railTies: '#F4F1EA',
    platform: '#C9BDA4',
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
    background: '#17171A',
    roads: { trunk: '#F0503F', primary: '#F5A04A', secondary: '#F3C640', tertiary: '#55B45F', residential: '#5FA3D6', living: '#EE5C9C', service: '#7E7B76' },
    casing: '#08080A',
    bridgeCasing: '#F1E6CB',
    bridgeShadow: 'rgba(0, 0, 0, 0.7)',
    arrow: '#F1E6CB',
    building: '#34343A',
    buildingLine: '#4C4C54',
    building3d: '#4A4A52',
    bridgeSide: '#5C5C66',
    bridgeParapet: '#D9D9E0',
    embankment: '#3E4437',
    schemeMain: '#E0A93A',
    schemeMainEdge: '#8C6420',
    schemeDistrict: '#8E8E98',
    schemeLocal: '#5C5C66',
    schemeEdge: '#2A2A30',
    asphalt: '#3E3E46',
    asphaltEdge: '#A3A3AD',
    lane: '#E8E2D4',
    laneMark: '#F7F5EF',
    laneMarkCasing: '#0E0E10',
    path: '#6A6A72',
    walk: '#8C867B',
    cycle: '#3F6B4A',
    square: '#7E786E',
    trail: '#55503F',
    tram: '#B48ADB',
    rail: '#8E8E9A',
    railTies: '#2A2A30',
    platform: '#55555E',
    nodeFill: '#28282D',
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
