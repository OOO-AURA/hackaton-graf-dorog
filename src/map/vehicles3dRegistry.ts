import type { Map as MapLibreMap } from 'maplibre-gl';

/** The 3D vehicle layer of a map, once three.js has loaded (vehicles3d.ts is a lazy chunk). */
export interface VehicleSink { update(points: Array<{ lon: number; lat: number; angle: number; sprite: string }>): void }

const sinks = new WeakMap<MapLibreMap, VehicleSink>();
export const registerVehicles3d = (map: MapLibreMap, sink: VehicleSink) => sinks.set(map, sink);
export const vehicles3dOf = (map: MapLibreMap): VehicleSink | undefined => sinks.get(map);
export const VEHICLES3D_LAYER = 'vehicles-3d';
