import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Vehicles of the micro run as their 3D models in the tilted view. One InstancedMesh per part of
 * each model, so hundreds of cars cost a handful of draw calls. Models load on first use.
 * Coordinates are metres east/north of a local origin, which keeps float32 precise.
 */
import { registerVehicles3d, VEHICLES3D_LAYER } from './vehicles3dRegistry';

const MAX_PER_MODEL = 600;

interface Model { parts: THREE.InstancedMesh[] }

export interface VehiclePoint { lon: number; lat: number; angle: number; sprite: string }

export class Vehicles3dLayer implements CustomLayerInterface {
  readonly id: string = VEHICLES3D_LAYER;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map: MapLibreMap | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private models = new Map<string, Model | 'loading'>();
  private loader = new GLTFLoader();
  private points: VehiclePoint[] = [];
  private origin: maplibregl.MercatorCoordinate | null = null;
  private unit = 1;
  private tmp = new THREE.Matrix4();

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.5, -1, 2);
    this.scene.add(sun);
  }

  onRemove(): void {
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  /** Model name from a sprite id: 'veh-car1' → 'car1'. */
  private model(sprite: string): Model | null {
    const name = sprite.replace(/^veh-/, '');
    const have = this.models.get(name);
    if (have === 'loading') return null;
    if (have) return have;
    this.models.set(name, 'loading');
    this.loader.load(`${import.meta.env.BASE_URL}models/${name}.glb`, (gltf) => {
      const parts: THREE.InstancedMesh[] = [];
      gltf.scene.updateMatrixWorld(true);
      // glTF is Y-up with the front along −Z; the local frame here is Z-up with north along +Y.
      const toLocal = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const geo = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld));
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => { const c = m.clone(); c.side = THREE.DoubleSide; return c; });
        const inst = new THREE.InstancedMesh(geo, mats.length === 1 ? mats[0] : mats, MAX_PER_MODEL);
        inst.count = 0;
        inst.frustumCulled = false;
        parts.push(inst);
        this.scene.add(inst);
      });
      this.models.set(name, { parts });
      this.update(this.points);
    }, undefined, () => this.models.set(name, { parts: [] }));
    return null;
  }

  update(points: VehiclePoint[]): void {
    this.points = points;
    if (!this.map) return;
    if (!this.origin && points.length) {
      this.origin = maplibregl.MercatorCoordinate.fromLngLat([points[0].lon, points[0].lat], 0);
      this.unit = this.origin.meterInMercatorCoordinateUnits();
    }
    const counts = new Map<Model, number>();
    for (const m of this.models.values()) if (m !== 'loading') { counts.set(m, 0); m.parts.forEach((p) => { p.count = 0; }); }
    const o = this.origin;
    if (o) {
      for (const p of points) {
        const m = this.model(p.sprite);
        if (!m) continue;
        const i = counts.get(m) ?? 0;
        if (i >= MAX_PER_MODEL) continue;
        const c = maplibregl.MercatorCoordinate.fromLngLat([p.lon, p.lat], 0);
        const x = (c.x - o.x) / this.unit;
        const y = -(c.y - o.y) / this.unit;
        // SUMO angles go clockwise from north.
        this.tmp.makeRotationZ(-THREE.MathUtils.degToRad(p.angle)).setPosition(x, y, 0);
        m.parts.forEach((part) => part.setMatrixAt(i, this.tmp));
        counts.set(m, i + 1);
      }
    }
    for (const [m, n] of counts) m.parts.forEach((part) => { part.count = n; part.instanceMatrix.needsUpdate = true; });
    this.map.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext, args: unknown): void {
    if (!this.renderer || !this.origin) return;
    const matrix = (args as { defaultProjectionData?: { mainMatrix: ArrayLike<number> } }).defaultProjectionData?.mainMatrix ?? (args as ArrayLike<number>);
    const o = this.origin; const s = this.unit;
    const local = new THREE.Matrix4().makeTranslation(o.x, o.y, 0).scale(new THREE.Vector3(s, -s, s));
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(Array.from(matrix as ArrayLike<number>)).multiply(local);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
}

export function addVehicles3d(map: MapLibreMap, visible: boolean): void {
  if (map.getLayer(VEHICLES3D_LAYER)) return;
  const layer = new Vehicles3dLayer();
  map.addLayer(layer);
  map.setLayoutProperty(VEHICLES3D_LAYER, 'visibility', visible ? 'visible' : 'none');
  registerVehicles3d(map, layer);
}
