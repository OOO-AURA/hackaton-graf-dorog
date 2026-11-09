import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import { STRIDE, type Scene3dMesh } from './mesh3d';

/**
 * 3D buildings, bridges and tunnel portals drawn with our own WebGL, so that a building standing
 * in front of a road can be cut away. The cut works in screen space, in four passes:
 *
 * 1. building depth into a texture;
 * 2. road ribbons into a mask, keeping only pixels a building hides;
 * 3. per screen column, the lowest hidden road pixel and its depth;
 * 4. buildings on screen: in a column with a hidden road, a building fragment nearer than the road
 *    is removed from its top down to the road's lower edge, and fades back in just below it.
 */

export const SCENE3D_LAYER = 'scene-3d';
/** The cutaway fades in between these zooms and is off when the map is further out. */
const CUT_ZOOM_FROM = 16.5;
const CUT_ZOOM_FULL = 17.2;
/** Length of the fade below the cut, in CSS pixels. */
const FADE_PX = 26;
/** The column pass samples at most this many rows; taller canvases are sampled with a step. */
const COLUMN_SAMPLES = 1024;

const PACK = `
vec4 packDepth(float v) {
  vec4 e = fract(v * vec4(1.0, 255.0, 65025.0, 16581375.0));
  return e - e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
}
float unpackDepth(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
vec2 pack16(float v) { float h = floor(v * 255.0) / 255.0; return vec2(h, fract(v * 255.0)); }
float unpack16(vec2 c) { return c.x + c.y / 255.0; }
`;

const VS_POS = `
attribute vec3 a_pos;
uniform mat4 u_matrix;
void main() { gl_Position = u_matrix * vec4(a_pos, 1.0); }
`;

const FS_DEPTH = `
precision highp float;
${PACK}
void main() { gl_FragColor = packDepth(gl_FragCoord.z); }
`;

const FS_MASK = `
precision highp float;
${PACK}
uniform sampler2D u_depth;
uniform vec2 u_size;
void main() {
  float building = unpackDepth(texture2D(u_depth, gl_FragCoord.xy / u_size));
  if (building >= gl_FragCoord.z - 0.00002) discard;
  gl_FragColor = packDepth(max(gl_FragCoord.z, 0.000001));
}
`;

const VS_QUAD = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FS_COLUMN = `
precision highp float;
${PACK}
uniform sampler2D u_mask;
uniform vec2 u_size;
uniform float u_step;
void main() {
  float x = gl_FragCoord.x / u_size.x;
  vec4 outColor = vec4(0.0);
  for (int i = 0; i < ${COLUMN_SAMPLES}; i++) {
    float y = float(i) * u_step + 0.5;
    if (y > u_size.y) break;
    vec4 m = texture2D(u_mask, vec2(x, y / u_size.y));
    if (m != vec4(0.0)) {
      // Lowest hidden road pixel in this column, and the road depth there.
      outColor = vec4(pack16(y / (u_size.y + 1.0)), pack16(unpackDepth(m)));
      break;
    }
  }
  gl_FragColor = outColor;
}
`;

const VS_COLOR = `
attribute vec3 a_pos;
attribute vec3 a_color;
attribute float a_cut;
uniform mat4 u_matrix;
varying vec3 v_color;
varying float v_cut;
void main() {
  v_color = a_color;
  v_cut = a_cut;
  gl_Position = u_matrix * vec4(a_pos, 1.0);
}
`;

const FS_COLOR = `
precision highp float;
${PACK}
uniform sampler2D u_columns;
uniform vec2 u_size;
uniform float u_fade;
uniform float u_cutaway;
varying vec3 v_color;
varying float v_cut;
void main() {
  float alpha = 1.0;
  if (v_cut > 0.5 && u_cutaway > 0.0) {
    vec4 c = texture2D(u_columns, vec2(gl_FragCoord.x / u_size.x, 0.5));
    float y = unpack16(c.rg) * (u_size.y + 1.0);
    float road = unpack16(c.ba);
    if (y > 0.0 && gl_FragCoord.z < road) alpha = mix(1.0, clamp((y - gl_FragCoord.y) / u_fade, 0.0, 1.0), u_cutaway);
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

type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; depth: WebGLRenderbuffer | null; w: number; h: number };

function makeTarget(gl: GL, w: number, h: number, withDepth: boolean): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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

type Buffers = { solid: WebGLBuffer; solidCount: number; structures: WebGLBuffer; structuresCount: number; edges: WebGLBuffer; edgesCount: number; mask: WebGLBuffer; maskCount: number };

export class Scene3dLayer implements CustomLayerInterface {
  readonly id = SCENE3D_LAYER;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MapLibreMap | null = null;
  private mesh: Scene3dMesh | null = null;
  private dirty = true;
  private buffers: Buffers | null = null;
  private progDepth: WebGLProgram | null = null;
  private progMask: WebGLProgram | null = null;
  private progColumn: WebGLProgram | null = null;
  private progColor: WebGLProgram | null = null;
  private quad: WebGLBuffer | null = null;
  private depthTarget: Target | null = null;
  private maskTarget: Target | null = null;
  private columnTarget: Target | null = null;
  private showBuildings = true;
  private showStructures = true;
  private cutaway = true;

  setMesh(mesh: Scene3dMesh | null): void {
    this.mesh = mesh;
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  setVisible(buildings: boolean, structures: boolean): void {
    this.showBuildings = buildings;
    this.showStructures = structures;
    this.map?.triggerRepaint();
  }

  setCutaway(on: boolean): void {
    this.cutaway = on;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: GL): void {
    this.map = map;
    this.progDepth = compile(gl, VS_POS, FS_DEPTH);
    this.progMask = compile(gl, VS_POS, FS_MASK);
    this.progColumn = compile(gl, VS_QUAD, FS_COLUMN);
    this.progColor = compile(gl, VS_COLOR, FS_COLOR);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  onRemove(_map: MapLibreMap, gl: GL): void {
    this.dropBuffers(gl);
    [this.depthTarget, this.maskTarget, this.columnTarget].forEach((t) => dropTarget(gl, t));
    this.depthTarget = this.maskTarget = this.columnTarget = null;
    [this.progDepth, this.progMask, this.progColumn, this.progColor].forEach((p) => p && gl.deleteProgram(p));
    if (this.quad) gl.deleteBuffer(this.quad);
    this.map = null;
  }

  private dropBuffers(gl: GL) {
    if (!this.buffers) return;
    const b = this.buffers;
    [b.solid, b.structures, b.edges, b.mask].forEach((x) => gl.deleteBuffer(x));
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
      edges: make(m.edges), edgesCount: m.edges.length / STRIDE,
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
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (this.depthTarget?.w === w && this.depthTarget.h === h) return;
    [this.depthTarget, this.maskTarget, this.columnTarget].forEach((t) => dropTarget(gl, t));
    this.depthTarget = makeTarget(gl, w, h, true);
    this.maskTarget = makeTarget(gl, w, h, false);
    this.columnTarget = makeTarget(gl, w, 1, false);
  }

  private bindPos(gl: GL, program: WebGLProgram, buffer: WebGLBuffer, stride: number) {
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, stride * 4, 0);
    return loc;
  }

  /** 0 when zoomed out, 1 close in. */
  private cutStrength(): number {
    if (!this.cutaway || !this.map) return 0;
    const k = (this.map.getZoom() - CUT_ZOOM_FROM) / (CUT_ZOOM_FULL - CUT_ZOOM_FROM);
    return Math.min(1, Math.max(0, k));
  }

  prerender(gl: GL, matrix: ArrayLike<number>): void {
    this.upload(gl);
    const b = this.buffers;
    if (!b || !this.mesh || !this.cutStrength() || !this.showBuildings || !b.solidCount) return;
    this.ensureTargets(gl);
    const m = this.matrix(matrix);
    const { w, h } = this.depthTarget!;

    // 1. Building depth.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthTarget!.fb);
    gl.viewport(0, 0, w, h);
    gl.clearColor(1, 1, 1, 1);
    gl.clearDepth(1);
    gl.depthRange(0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.progDepth);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progDepth!, 'u_matrix'), false, m);
    let loc = this.bindPos(gl, this.progDepth!, b.solid, STRIDE);
    gl.drawArrays(gl.TRIANGLES, 0, b.solidCount);
    gl.disableVertexAttribArray(loc);

    // 2. Road pixels that a building hides.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskTarget!.fb);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.progMask);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progMask!, 'u_matrix'), false, m);
    gl.uniform2f(gl.getUniformLocation(this.progMask!, 'u_size'), w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTarget!.tex);
    gl.uniform1i(gl.getUniformLocation(this.progMask!, 'u_depth'), 0);
    if (b.maskCount) {
      loc = this.bindPos(gl, this.progMask!, b.mask, 3);
      gl.drawArrays(gl.TRIANGLES, 0, b.maskCount);
      gl.disableVertexAttribArray(loc);
    }

    // 3. Lowest hidden road pixel per column.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.columnTarget!.fb);
    gl.viewport(0, 0, w, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.progColumn);
    gl.uniform2f(gl.getUniformLocation(this.progColumn!, 'u_size'), w, h);
    gl.uniform1f(gl.getUniformLocation(this.progColumn!, 'u_step'), Math.max(1, Math.ceil(h / COLUMN_SAMPLES)));
    gl.bindTexture(gl.TEXTURE_2D, this.maskTarget!.tex);
    gl.uniform1i(gl.getUniformLocation(this.progColumn!, 'u_mask'), 0);
    loc = gl.getAttribLocation(this.progColumn!, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(loc);

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
    const strength = this.columnTarget ? this.cutStrength() : 0;
    const cut = strength > 0;
    gl.uniform1f(gl.getUniformLocation(p, 'u_cutaway'), strength);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cut ? this.columnTarget!.tex : null);
    gl.uniform1i(gl.getUniformLocation(p, 'u_columns'), 0);

    // Same depth range as the offscreen passes, so depths read from them compare directly.
    gl.depthRange(0, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const draw = (buffer: WebGLBuffer, mode: number, count: number) => {
      if (!count) return;
      const pos = gl.getAttribLocation(p, 'a_pos');
      const col = gl.getAttribLocation(p, 'a_color');
      const cutLoc = gl.getAttribLocation(p, 'a_cut');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, STRIDE * 4, 0);
      gl.enableVertexAttribArray(col);
      gl.vertexAttribPointer(col, 3, gl.FLOAT, false, STRIDE * 4, 12);
      gl.enableVertexAttribArray(cutLoc);
      gl.vertexAttribPointer(cutLoc, 1, gl.FLOAT, false, STRIDE * 4, 24);
      gl.drawArrays(mode, 0, count);
      gl.disableVertexAttribArray(pos);
      gl.disableVertexAttribArray(col);
      gl.disableVertexAttribArray(cutLoc);
    };

    // Opaque structures first, so cut buildings blend over them.
    gl.disable(gl.CULL_FACE);
    if (this.showStructures) draw(b.structures, gl.TRIANGLES, b.structuresCount);
    if (this.showBuildings) {
      // Back faces are culled so the fade shows the road, not the far wall of the same building.
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      // Mercator y grows southwards, which mirrors the winding on screen.
      gl.frontFace(gl.CW);
      // Depth first, then colour only where a fragment is the nearest one. A faded wall then
      // shows the road behind it, never the courtyard walls or edges of the same building.
      gl.colorMask(false, false, false, false);
      draw(b.solid, gl.TRIANGLES, b.solidCount);
      gl.colorMask(true, true, true, true);
      gl.depthMask(false);
      draw(b.solid, gl.TRIANGLES, b.solidCount);
      gl.disable(gl.CULL_FACE);
      draw(b.edges, gl.LINES, b.edgesCount);
      gl.depthMask(true);
    }
    gl.disable(gl.BLEND);
  }
}
