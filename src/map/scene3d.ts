import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import { mercatorX, mercatorY, STRIDE, type Rgb, type Scene3dMesh } from './mesh3d';

/**
 * 3D buildings, bridges and tunnel portals drawn with our own WebGL, so that a building standing
 * in front of a road can be cut away. Each building is cut as a whole:
 *
 * 1. at a quarter of the screen resolution, the nearest building's depth and number per pixel;
 * 2. road ribbons on top, keeping the pixels a building hides inside the central 90 % of the
 *    screen, each marked with the number of the building that hides it;
 * 3. on the CPU, the lowest such road pixel of every building: its cut line;
 * 4. buildings on screen: everything of a building above its cut line is removed, and it fades
 *    back in just below it.
 */

export const SCENE3D_LAYER = 'scene-3d';
/**
 * The cutaway switches on past this zoom and off a little below it, so it does not flicker at
 * the threshold; either way it animates in or out over CUT_ANIM_MS, whatever the zoom does.
 */
const CUT_ZOOM_ON = 17;
const CUT_ZOOM_OFF = 16.8;
const CUT_ANIM_MS = 180;
/** Roads hidden only in this share of the screen at each edge do not start a cut. */
export const CUT_MARGIN = 0.1;
/** The cut is worked out at the screen resolution divided by this. */
const CUT_DOWNSCALE = 4;
/** Cut lines are kept in a texture this wide, one texel per building. */
const CUT_TEX_WIDTH = 2048;

/** Opacity of extruded buildings, as the old fill-extrusion layer had it. */
const BUILDING_OPACITY = 0.85;
/** Length of the fade below the cut, in CSS pixels. */
const FADE_PX = 26;

/**
 * MapLibre's default light: position [1.15, 210°, 30°] anchored to the viewport, so it turns with
 * the map bearing.
 */
export function lightPosition(bearing: number): [number, number, number] {
  const az = ((210 + 90) * Math.PI) / 180;
  const polar = (30 * Math.PI) / 180;
  const x = 1.15 * Math.cos(az) * Math.sin(polar);
  const y = 1.15 * Math.sin(az) * Math.sin(polar);
  const z = 1.15 * Math.cos(polar);
  const a = (bearing * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
}

/**
 * Cut line of every building from the road mask: the lowest row (from the bottom) at which a road
 * hidden by that building shows. Pixels are RGBA, the building number in RGB, alpha 255 where set.
 */
export function cutLines(pixels: Uint8Array, width: number, height: number, buildings: number): Int32Array {
  const rows = new Int32Array(buildings + 1).fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 128) continue;
      const id = pixels[i] + pixels[i + 1] * 256 + pixels[i + 2] * 65536;
      if (id > 0 && id <= buildings && rows[id] < 0) rows[id] = y;
    }
  }
  return rows;
}

const PACK = `
vec4 packDepth(float v) {
  vec4 e = fract(v * vec4(1.0, 255.0, 65025.0, 16581375.0));
  return e - e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
}
float unpackDepth(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
// Distance from the camera (clip w) on a log scale in 0..1. Window depth is too flat this far
// from the near plane to tell a wall from the road just behind it.
float linearDepth(float w) { return clamp(log2(max(w, 1e-6)) / 48.0 + 0.5, 0.0, 0.999999); }
`;

const VS_POS = `
attribute vec3 a_pos;
attribute float a_id;
uniform mat4 u_matrix;
varying float v_w;
varying float v_id;
void main() { gl_Position = u_matrix * vec4(a_pos, 1.0); v_w = gl_Position.w; v_id = a_id; }
`;

const FS_DEPTH = `
precision highp float;
${PACK}
varying float v_w;
varying float v_id;
void main() { gl_FragColor = packDepth(linearDepth(v_w)); }
`;

const FS_ID = `
precision highp float;
varying float v_w;
varying float v_id;
void main() {
  float id = floor(v_id + 0.5);
  gl_FragColor = vec4(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0), 255.0) / 255.0;
}
`;

const VS_PICK = `
attribute vec3 a_pos;
attribute float a_pick;
uniform mat4 u_matrix;
varying float v_pick;
void main() { gl_Position = u_matrix * vec4(a_pos, 1.0); v_pick = a_pick; }
`;

const FS_PICK = `
precision highp float;
varying float v_pick;
void main() {
  float id = floor(v_pick + 0.5);
  gl_FragColor = vec4(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0), 255.0) / 255.0;
}
`;

const FS_MASK = `
precision highp float;
${PACK}
uniform sampler2D u_depth;
uniform sampler2D u_ids;
uniform vec2 u_size;
uniform float u_margin;
varying float v_w;
varying float v_id;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  if (uv.x < u_margin || uv.x > 1.0 - u_margin || uv.y < u_margin || uv.y > 1.0 - u_margin) discard;
  float building = unpackDepth(texture2D(u_depth, uv));
  if (building >= linearDepth(v_w) - 0.00002) discard;
  gl_FragColor = texture2D(u_ids, uv);
}
`;

/** MapLibre's fill-extrusion lighting with its default light (intensity 0.5, white). */
const VS_COLOR = `
attribute vec3 a_pos;
attribute vec3 a_color;
attribute float a_id;
attribute vec3 a_normal;
attribute float a_shade;
attribute float a_pick;
uniform mat4 u_matrix;
uniform vec3 u_lightpos;
uniform sampler2D u_selected;
uniform float u_selRows;
uniform vec3 u_selColor;
varying vec3 v_color;
varying float v_id;
void main() {
  v_id = a_id;
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  float colorvalue = dot(a_color, vec3(0.2126, 0.7152, 0.0722));
  vec3 color = a_color + 0.03;
  float d = dot(a_normal, u_lightpos);
  // Bridges and portals are lit from both sides; their winding is not kept outward.
  if (a_id < 0.5) d = abs(d);
  float directional = mix(0.5, max(1.5 - colorvalue, 1.0), clamp(d, 0.0, 1.0));
  if (abs(a_normal.z) < 0.5) directional *= a_shade;
  v_color = clamp(color * directional, 0.0, 1.0);
  if (a_pick > 0.5) {
    float id = floor(a_pick + 0.5);
    vec2 uv = vec2((mod(id, ${CUT_TEX_WIDTH}.0) + 0.5) / ${CUT_TEX_WIDTH}.0, (floor(id / ${CUT_TEX_WIDTH}.0) + 0.5) / u_selRows);
    if (texture2D(u_selected, uv).a > 0.5) v_color = mix(v_color, u_selColor, 0.55);
  }
}
`;

const FS_COLOR = `
precision highp float;
uniform sampler2D u_cuts;
uniform float u_cutRows;
uniform vec2 u_size;
uniform float u_fade;
uniform float u_cutaway;
uniform float u_opacity;
varying vec3 v_color;
varying float v_id;
void main() {
  float alpha = 1.0;
  if (v_id > 0.5 && u_cutaway > 0.0) {
    float id = floor(v_id + 0.5);
    vec2 uv = vec2((mod(id, ${CUT_TEX_WIDTH}.0) + 0.5) / ${CUT_TEX_WIDTH}.0, (floor(id / ${CUT_TEX_WIDTH}.0) + 0.5) / u_cutRows);
    vec4 c = texture2D(u_cuts, uv);
    if (c.a > 0.5) {
      float cutY = (c.r + c.g / 255.0) * (u_size.y + 1.0);
      alpha = mix(1.0, clamp((cutY - gl_FragCoord.y) / u_fade, 0.0, 1.0), u_cutaway);
    }
    alpha *= u_opacity;
  }
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(v_color * alpha, alpha);
}
`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

function compile(gl: GL, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`3D: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`3D: ${gl.getProgramInfoLog(program)}`);
  return program;
}

function makeTexture(gl: GL, w: number, h: number, data: Uint8Array | null = null): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; depth: WebGLRenderbuffer | null; w: number; h: number };

function makeTarget(gl: GL, w: number, h: number, withDepth: boolean): Target {
  const tex = makeTexture(gl, w, h);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let depth: WebGLRenderbuffer | null = null;
  if (withDepth) {
    depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }
  return { fb, tex, depth, w, h };
}

function dropTarget(gl: GL, t: Target | null) {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.tex);
  if (t.depth) gl.deleteRenderbuffer(t.depth);
}

/** Column-major 4×4 product a·b in doubles. */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return new Float32Array(out);
}

type Buffers = { solid: WebGLBuffer; solidCount: number; structures: WebGLBuffer; structuresCount: number; mask: WebGLBuffer; maskCount: number };

export class Scene3dLayer implements CustomLayerInterface {
  readonly id = SCENE3D_LAYER;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MapLibreMap | null = null;
  private mesh: Scene3dMesh | null = null;
  private dirty = true;
  private buffers: Buffers | null = null;
  private progDepth: WebGLProgram | null = null;
  private progId: WebGLProgram | null = null;
  private progMask: WebGLProgram | null = null;
  private progColor: WebGLProgram | null = null;
  private progPick: WebGLProgram | null = null;
  private pickTarget: Target | null = null;
  private pending: Array<{ x: number; y: number; resolve: (id: string | null) => void }> = [];
  private lastMatrix: Float32Array | null = null;
  private selected = new Set<string>();
  private selColor: Rgb = [0.93, 0.36, 0.61];
  private selTex: WebGLTexture | null = null;
  private selRows = 1;
  private selDirty = true;
  private depthTarget: Target | null = null;
  private idTarget: Target | null = null;
  private maskTarget: Target | null = null;
  private cutTex: WebGLTexture | null = null;
  private cutRows = 1;
  private hasCuts = false;
  private showBuildings = true;
  private showStructures = true;
  private cutaway = true;
  /** Whether the cutaway is wanted at the current zoom, and how far its animation has got. */
  private cutOn = false;
  private cutAnim = 0;
  private cutTime = 0;

  setMesh(mesh: Scene3dMesh | null): void {
    this.mesh = mesh;
    this.dirty = true;
    this.selDirty = true;
    this.map?.triggerRepaint();
  }

  setVisible(buildings: boolean, structures: boolean): void {
    this.showBuildings = buildings;
    this.showStructures = structures;
    this.map?.triggerRepaint();
  }

  /** Buildings and bridges to highlight, by OSM way id, and the highlight colour. */
  setSelected(ids: Iterable<string>, color: Rgb): void {
    this.selected = new Set(ids);
    this.selColor = color;
    this.selDirty = true;
    this.map?.triggerRepaint();
  }

  /** OSM way of the building or bridge under a point in CSS pixels, worked out on the next frame. */
  pick(x: number, y: number): Promise<string | null> {
    if (!this.map || !this.mesh) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.pending.push({ x, y, resolve });
      this.map!.triggerRepaint();
    });
  }

  /** CSS pixel position of a point given in lon, lat and metres above ground, or null if behind the camera. */
  project(lon: number, lat: number, metres: number): { x: number; y: number } | null {
    const m = this.lastMatrix;
    const o = this.mesh?.origin;
    if (!m || !o || !this.map) return null;
    const x = (mercatorX(lon) - o.x) * o.metersPerUnit;
    const y = (mercatorY(lat) - o.y) * o.metersPerUnit;
    const clip = [0, 1, 2, 3].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * metres + m[12 + r]);
    if (clip[3] <= 0) return null;
    const canvas = this.map.getCanvas();
    return { x: ((clip[0] / clip[3] + 1) / 2) * canvas.clientWidth, y: ((1 - clip[1] / clip[3]) / 2) * canvas.clientHeight };
  }

  setCutaway(on: boolean): void {
    this.cutaway = on;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: GL): void {
    this.map = map;
    this.progDepth = compile(gl, VS_POS, FS_DEPTH);
    this.progId = compile(gl, VS_POS, FS_ID);
    this.progMask = compile(gl, VS_POS, FS_MASK);
    this.progColor = compile(gl, VS_COLOR, FS_COLOR);
    this.progPick = compile(gl, VS_PICK, FS_PICK);
    this.pickTarget = makeTarget(gl, 1, 1, true);
  }

  onRemove(_map: MapLibreMap, gl: GL): void {
    this.dropBuffers(gl);
    [this.depthTarget, this.idTarget, this.maskTarget].forEach((t) => dropTarget(gl, t));
    this.depthTarget = this.idTarget = this.maskTarget = null;
    if (this.cutTex) gl.deleteTexture(this.cutTex);
    this.cutTex = null;
    [this.progDepth, this.progId, this.progMask, this.progColor, this.progPick].forEach((p) => p && gl.deleteProgram(p));
    dropTarget(gl, this.pickTarget);
    this.pickTarget = null;
    if (this.selTex) gl.deleteTexture(this.selTex);
    this.selTex = null;
    this.pending.forEach((p) => p.resolve(null));
    this.pending = [];
    this.map = null;
  }

  private dropBuffers(gl: GL) {
    if (!this.buffers) return;
    const b = this.buffers;
    [b.solid, b.structures, b.mask].forEach((x) => gl.deleteBuffer(x));
    this.buffers = null;
  }

  private upload(gl: GL) {
    if (!this.dirty) return;
    this.dirty = false;
    this.dropBuffers(gl);
    const m = this.mesh;
    if (!m) return;
    const make = (data: Float32Array) => {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return buf;
    };
    this.buffers = {
      solid: make(m.solid), solidCount: m.solid.length / STRIDE,
      structures: make(m.structures), structuresCount: m.structures.length / STRIDE,
      mask: make(m.roadMask), maskCount: m.roadMask.length / 3,
    };
  }

  /** Map matrix times the move from local metres to Mercator units around the mesh origin. */
  private matrix(map: ArrayLike<number>): Float32Array {
    const o = this.mesh!.origin;
    const s = 1 / o.metersPerUnit;
    const local = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, o.x, o.y, 0, 1];
    return mul(map, local);
  }

  private ensureTargets(gl: GL) {
    const w = Math.max(1, Math.ceil(gl.drawingBufferWidth / CUT_DOWNSCALE));
    const h = Math.max(1, Math.ceil(gl.drawingBufferHeight / CUT_DOWNSCALE));
    if (this.depthTarget?.w === w && this.depthTarget.h === h) return;
    [this.depthTarget, this.idTarget, this.maskTarget].forEach((t) => dropTarget(gl, t));
    this.depthTarget = makeTarget(gl, w, h, true);
    this.idTarget = makeTarget(gl, w, h, true);
    this.maskTarget = makeTarget(gl, w, h, false);
  }

  /** Moves the cutaway animation on by the time since the last frame; called once per frame. */
  private stepCut(): void {
    const now = performance.now();
    const dt = this.cutTime ? Math.min(100, now - this.cutTime) : 0;
    this.cutTime = now;
    const zoom = this.map?.getZoom() ?? 0;
    if (zoom >= CUT_ZOOM_ON) this.cutOn = true;
    else if (zoom < CUT_ZOOM_OFF) this.cutOn = false;
    const target = this.cutaway && this.cutOn ? 1 : 0;
    if (this.cutAnim === target) return;
    const step = dt / CUT_ANIM_MS;
    this.cutAnim = target > this.cutAnim ? Math.min(target, this.cutAnim + step) : Math.max(target, this.cutAnim - step);
    this.map?.triggerRepaint();
  }

  /** 0 off, 1 fully on; eased. */
  private cutStrength(): number {
    const t = this.cutAnim;
    return t * t * (3 - 2 * t);
  }

  private bindPos(gl: GL, program: WebGLProgram, buffer: WebGLBuffer, stride: number, withId: boolean): number[] {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, stride * 4, 0);
    const id = gl.getAttribLocation(program, 'a_id');
    if (id >= 0) {
      if (withId) {
        gl.enableVertexAttribArray(id);
        gl.vertexAttribPointer(id, 1, gl.FLOAT, false, stride * 4, 24);
      } else {
        gl.disableVertexAttribArray(id);
        gl.vertexAttrib1f(id, 0);
      }
    }
    return withId && id >= 0 ? [pos, id] : [pos];
  }

  private drawBuildings(gl: GL, program: WebGLProgram, m: Float32Array, target: Target) {
    const b = this.buffers!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_matrix'), false, m);
    const locs = this.bindPos(gl, program, b.solid, STRIDE, true);
    gl.drawArrays(gl.TRIANGLES, 0, b.solidCount);
    locs.forEach((l) => gl.disableVertexAttribArray(l));
  }

  /** Renders the building numbers of one pixel per pending click and resolves them. */
  private runPicks(gl: GL, m: Float32Array) {
    const jobs = this.pending;
    this.pending = [];
    if (!jobs.length) return;
    const b = this.buffers;
    const canvas = this.map!.getCanvas();
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    for (const job of jobs) {
      if (!b || (!b.solidCount && !b.structuresCount)) { job.resolve(null); continue; }
      // Clip space shifted and scaled so that the clicked pixel fills the 1×1 target.
      const nx = ((job.x / canvas.clientWidth) * 2 - 1);
      const ny = (1 - (job.y / canvas.clientHeight) * 2);
      const pickM = new Float32Array(16);
      for (let c = 0; c < 4; c += 1) {
        pickM[c * 4] = W * (m[c * 4] - nx * m[c * 4 + 3]);
        pickM[c * 4 + 1] = H * (m[c * 4 + 1] - ny * m[c * 4 + 3]);
        pickM[c * 4 + 2] = m[c * 4 + 2];
        pickM[c * 4 + 3] = m[c * 4 + 3];
      }
      const t = this.pickTarget!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.viewport(0, 0, 1, 1);
      gl.disable(gl.BLEND);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.colorMask(true, true, true, true);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.depthRange(0, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const p = this.progPick!;
      gl.useProgram(p);
      gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_matrix'), false, pickM);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.solid);
      const pos = gl.getAttribLocation(p, 'a_pos');
      const pick = gl.getAttribLocation(p, 'a_pick');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, STRIDE * 4, 0);
      gl.enableVertexAttribArray(pick);
      gl.vertexAttribPointer(pick, 1, gl.FLOAT, false, STRIDE * 4, 11 * 4);
      if (this.showBuildings) gl.drawArrays(gl.TRIANGLES, 0, b.solidCount);
      if (this.showStructures && b.structuresCount) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b.structures);
        gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, STRIDE * 4, 0);
        gl.vertexAttribPointer(pick, 1, gl.FLOAT, false, STRIDE * 4, 11 * 4);
        gl.drawArrays(gl.TRIANGLES, 0, b.structuresCount);
      }
      gl.disableVertexAttribArray(pos);
      gl.disableVertexAttribArray(pick);
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const id = px[0] + px[1] * 256 + px[2] * 65536;
      job.resolve(px[3] > 128 && id > 0 ? this.mesh!.pickIds[id - 1] ?? null : null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  private uploadSelection(gl: GL) {
    if (!this.selDirty || !this.mesh) return;
    this.selDirty = false;
    const n = this.mesh.pickIds.length;
    const rows = Math.max(1, Math.ceil((n + 1) / CUT_TEX_WIDTH));
    const data = new Uint8Array(CUT_TEX_WIDTH * rows * 4);
    this.mesh.pickIds.forEach((id, i) => { if (this.selected.has(id)) data[(i + 1) * 4 + 3] = 255; });
    if (this.selTex) gl.deleteTexture(this.selTex);
    this.selTex = makeTexture(gl, CUT_TEX_WIDTH, rows, data);
    this.selRows = rows;
  }

  prerender(gl: GL, matrix: ArrayLike<number>): void {
    this.upload(gl);
    this.stepCut();
    if (this.mesh) {
      const pm = this.matrix(matrix);
      this.lastMatrix = pm;
      this.runPicks(gl, pm);
      this.uploadSelection(gl);
    }
    const b = this.buffers;
    this.hasCuts = false;
    if (!b || !this.mesh || !this.cutAnim || !this.showBuildings || !b.solidCount) return;
    this.ensureTargets(gl);
    const m = this.matrix(matrix);
    const { w, h } = this.depthTarget!;

    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.depthRange(0, 1);
    gl.clearDepth(1);

    // 1. Nearest building: its depth, and its number.
    gl.clearColor(1, 1, 1, 1);
    this.drawBuildings(gl, this.progDepth!, m, this.depthTarget!);
    gl.clearColor(0, 0, 0, 0);
    this.drawBuildings(gl, this.progId!, m, this.idTarget!);

    // 2. Road pixels a building hides, marked with that building.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskTarget!.fb);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    const p = this.progMask!;
    gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_matrix'), false, m);
    gl.uniform2f(gl.getUniformLocation(p, 'u_size'), w, h);
    gl.uniform1f(gl.getUniformLocation(p, 'u_margin'), CUT_MARGIN);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTarget!.tex);
    gl.uniform1i(gl.getUniformLocation(p, 'u_depth'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.idTarget!.tex);
    gl.uniform1i(gl.getUniformLocation(p, 'u_ids'), 1);
    gl.activeTexture(gl.TEXTURE0);
    if (b.maskCount) {
      const locs = this.bindPos(gl, p, b.mask, 3, false);
      gl.drawArrays(gl.TRIANGLES, 0, b.maskCount);
      locs.forEach((l) => gl.disableVertexAttribArray(l));
    }

    // 3. Cut line of every building, worked out on the CPU and handed back as a texture.
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const rows = cutLines(pixels, w, h, this.mesh.buildings);
    const fullH = gl.drawingBufferHeight;
    const texRows = Math.max(1, Math.ceil((this.mesh.buildings + 1) / CUT_TEX_WIDTH));
    const data = new Uint8Array(CUT_TEX_WIDTH * texRows * 4);
    for (let id = 1; id < rows.length; id += 1) {
      if (rows[id] < 0) continue;
      const v = Math.min(1, (rows[id] * CUT_DOWNSCALE) / (fullH + 1));
      const hi = Math.floor(v * 255);
      data[id * 4] = hi;
      data[id * 4 + 1] = Math.round((v * 255 - hi) * 255);
      data[id * 4 + 3] = 255;
      this.hasCuts = true;
    }
    if (this.cutTex) gl.deleteTexture(this.cutTex);
    this.cutTex = makeTexture(gl, CUT_TEX_WIDTH, texRows, data);
    this.cutRows = texRows;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  render(gl: GL, matrix: ArrayLike<number>): void {
    this.upload(gl);
    const b = this.buffers;
    if (!b || !this.mesh) return;
    const m = this.matrix(matrix);
    const p = this.progColor!;
    gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_matrix'), false, m);
    gl.uniform2f(gl.getUniformLocation(p, 'u_size'), gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(gl.getUniformLocation(p, 'u_fade'), FADE_PX * (window.devicePixelRatio || 1));
    gl.uniform1f(gl.getUniformLocation(p, 'u_cutaway'), this.hasCuts ? this.cutStrength() : 0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_opacity'), BUILDING_OPACITY);
    gl.uniform3fv(gl.getUniformLocation(p, 'u_lightpos'), lightPosition(this.map?.getBearing() ?? 0));
    gl.uniform1f(gl.getUniformLocation(p, 'u_cutRows'), this.cutRows);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hasCuts ? this.cutTex : null);
    gl.uniform1i(gl.getUniformLocation(p, 'u_cuts'), 0);
    this.uploadSelection(gl);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.selTex);
    gl.uniform1i(gl.getUniformLocation(p, 'u_selected'), 1);
    gl.uniform1f(gl.getUniformLocation(p, 'u_selRows'), this.selRows);
    gl.uniform3fv(gl.getUniformLocation(p, 'u_selColor'), [...this.selColor]);
    gl.activeTexture(gl.TEXTURE0);
    this.lastMatrix = m;

    // Same depth range as the offscreen passes; our own depth, so clear it first.
    gl.depthRange(0, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const draw = (buffer: WebGLBuffer, count: number) => {
      if (!count) return;
      const attr = (name: string, size: number, offset: number) => {
        const loc = gl.getAttribLocation(p, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
        return loc;
      };
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const locs = [attr('a_pos', 3, 0), attr('a_color', 3, 3), attr('a_id', 1, 6), attr('a_normal', 3, 7), attr('a_shade', 1, 10), attr('a_pick', 1, 11)];
      gl.drawArrays(gl.TRIANGLES, 0, count);
      locs.forEach((l) => gl.disableVertexAttribArray(l));
    };

    // Opaque structures first, so cut buildings blend over them.
    gl.disable(gl.CULL_FACE);
    if (this.showStructures) draw(b.structures, b.structuresCount);
    if (this.showBuildings) {
      // Back faces are culled; then depth first and colour only for the nearest fragment, so a
      // faded wall shows the road behind it, never the far walls of the same building.
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CW);
      gl.colorMask(false, false, false, false);
      draw(b.solid, b.solidCount);
      gl.colorMask(true, true, true, true);
      gl.depthMask(false);
      draw(b.solid, b.solidCount);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(true);
    }
    gl.disable(gl.BLEND);
  }
}
