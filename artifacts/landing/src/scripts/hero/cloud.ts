// The particle cloud: positions live in a float texture and are advanced by one fullscreen simulation pass per
// frame (curl noise, swirl along the surface, pull onto the SDF, a weak spring to each point's origin, and the
// cursor fluid's push in screen space). A Points mesh reads the texture in its vertex shader.
import * as THREE from "three";
import { SDF_GLSL, sampleSurface } from "./shape";

const SIM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const SIM_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tPos, tOrigin, tVel, tDen;
  uniform float time, hz, fluidOn, pull, spring, flowGain;
  uniform mat4 uViewProj, uModel;
  uniform mat3 uFlowToLocal;
  varying vec2 vUv;
  ${SDF_GLSL}
  // Analytic curl of three sine-sum potentials.
  vec3 curlNoise(vec3 p) {
    vec3 c = vec3(
      5.7 * cos(5.7 * p.y) - 4.3 * cos(4.3 * p.z),
      3.7 * cos(3.7 * p.z) - 3.3 * cos(3.3 * p.x),
      6.1 * cos(6.1 * p.x) - 5.1 * cos(5.1 * p.y));
    return c / (length(c) + 1e-5);
  }
  void main() {
    vec3 pos = texture2D(tPos, vUv).xyz;
    vec3 origin = texture2D(tOrigin, vUv).xyz;
    if (length(pos) > 0.7) pos /= 2.0;
    pos += curlNoise(pos * 0.1 + time * 0.05) * 0.0002 * hz;
    vec3 g = sdfNormal(pos);
    float sdf = sdfShape(pos);
    pos += cross(normalize(pos), normalize(g + 1e-6)) * 0.0005 * hz;
    pos += -g * sdf * pull * hz;
    pos += (origin - pos) * spring * hz;
    if (fluidOn > 0.5) {
      vec4 clip = uViewProj * uModel * vec4(pos, 1.0);
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
        vec3 flow = uFlowToLocal * vec3(texture2D(tVel, suv).xy, 0.0);
        pos += flow * 0.0001 * hz * 0.4 * flowGain * texture2D(tDen, suv).r;
      }
    }
    gl_FragColor = vec4(pos, 1.0);
  }`;

const POINT_VERT = /* glsl */ `
  uniform sampler2D tPos;
  uniform float dpr;
  attribute vec4 rnd;
  varying vec4 vRnd;
  varying float vScale;
  void main() {
    vec3 pos = texture2D(tPos, position.xy).xyz;
    pos *= mix(1.0, 1.5, pow(rnd.y, 150.0));
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mv.z;
    float scale = smoothstep(3.0, 15.0, dist) * mix(0.5, 1.0, rnd.z);
    vRnd = rnd;
    vScale = scale;
    gl_PointSize = 0.04 * dpr * 2.0 * scale * (1000.0 / dist);
    gl_Position = projectionMatrix * mv;
  }`;

const POINT_FRAG = /* glsl */ `
  uniform float time, gain;
  varying vec4 vRnd;
  varying float vScale;
  vec3 softLight(vec3 b, vec3 l) { return mix(2.0 * b * l + b * b * (1.0 - 2.0 * l), sqrt(b) * (2.0 * l - 1.0) + 2.0 * b * (1.0 - l), step(0.5, l)); }
  vec3 overlay(vec3 b, vec3 l) { return mix(2.0 * b * l, 1.0 - 2.0 * (1.0 - b) * (1.0 - l), step(0.5, b)); }
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25 || vScale < 0.1) discard;
    vec3 col = vec3(mix(0.0, 0.2, vRnd.x));
    col = mix(col, vec3(0.6, 0.45, 1.0), pow(vRnd.z, 100.0));
    col *= 0.5 + (0.4 + sin(time * 4.0 + vRnd.y * 20.0)) * pow(vRnd.z, 10.0) * 2.5;
    // Matcap: a soft grey sphere lit from the upper left, turned slowly per point.
    float a = sin(time + vRnd.z * 20.0) * 0.5 + 1.0;
    vec2 uv = mat2(cos(a), -sin(a), sin(a), cos(a)) * c * 2.0;
    vec3 n = vec3(uv, sqrt(max(0.0, 1.0 - dot(uv, uv))));
    vec3 m = vec3(clamp(0.25 + 0.75 * dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0));
    col = mix(col, softLight(col, m), 0.8);
    col = mix(col, overlay(col, m), 0.2);
    gl_FragColor = vec4(col * gain, 1.0);
  }`;

const DEG = Math.PI / 180;

export class Cloud {
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  readonly scene = new THREE.Scene();
  private group = new THREE.Group();
  private renderer: THREE.WebGLRenderer;
  private simScene = new THREE.Scene();
  private simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private simMat: THREE.ShaderMaterial;
  private pointMat: THREE.ShaderMaterial;
  private rt: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private initial: THREE.DataTexture;
  private origin: THREE.DataTexture;
  private first = true;
  private base = new THREE.Vector3(-1.17, 0, 6);
  private gaze = new THREE.Vector3(-1.17, 0, 6);
  private flowToLocal = new THREE.Matrix3();
  private viewProj = new THREE.Matrix4();

  constructor(renderer: THREE.WebGLRenderer, side: number, dpr: number) {
    this.renderer = renderer;
    const count = side * side;
    const pos = new Float32Array(count * 4);
    const rnd = new Float32Array(count * 4);
    const uvs = new Float32Array(count * 3);
    // Origins: most points get a home on the mark's surface, so the form heals evenly after a stir; one in ten
    // keeps a random origin and becomes the haze around it. Every point starts at a random spot and flies home.
    const origin = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 4] = Math.random() * 2 - 1;
      pos[i * 4 + 1] = Math.random() * 2 - 1;
      pos[i * 4 + 2] = Math.random() * 2 - 1;
      pos[i * 4 + 3] = 1;
      const home = Math.random() < 0.1 ? [pos[i * 4] * 0.8, pos[i * 4 + 1] * 0.8, pos[i * 4 + 2] * 0.8] : sampleSurface();
      origin.set([home[0], home[1], home[2], 1], i * 4);
      for (let k = 0; k < 4; k++) rnd[i * 4 + k] = Math.random();
      uvs[i * 3] = ((i % side) + 0.5) / side;
      uvs[i * 3 + 1] = (Math.floor(i / side) + 0.5) / side;
    }
    const tex = (data: Float32Array<ArrayBuffer>) => {
      const t = new THREE.DataTexture(data, side, side, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    this.initial = tex(pos);
    this.origin = tex(origin);
    const target = () => new THREE.WebGLRenderTarget(side, side, {
      type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    this.rt = [target(), target()];

    this.simMat = new THREE.ShaderMaterial({
      vertexShader: SIM_VERT, fragmentShader: SIM_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tPos: { value: this.initial }, tOrigin: { value: this.origin }, tVel: { value: null }, tDen: { value: null },
        time: { value: 0 }, hz: { value: 1 }, fluidOn: { value: 0 }, pull: { value: 0.018 }, spring: { value: 0.012 }, flowGain: { value: 0.7 },
        uViewProj: { value: this.viewProj }, uModel: { value: this.group.matrixWorld }, uFlowToLocal: { value: this.flowToLocal },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMat);
    quad.frustumCulled = false;
    this.simScene.add(quad);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(uvs, 3));
    geo.setAttribute("rnd", new THREE.BufferAttribute(rnd, 4));
    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      uniforms: { tPos: { value: this.initial }, dpr: { value: dpr }, time: { value: 0 }, gain: { value: 1 } },
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, this.pointMat);
    points.frustumCulled = false;
    this.group.add(points);
    this.group.rotation.set(-12 * DEG, 10 * DEG, 2 * DEG);
    this.scene.add(this.group);
    this.camera.position.copy(this.base);
    this.camera.lookAt(0, 0, 0);
  }

  /** Fit the mark to the viewport: centred between the hero columns on wide screens, higher up on portrait. */
  resize(width: number, height: number) {
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const dist = 7;
    const visH = 2 * dist * Math.tan(15 * DEG);
    const visW = visH * aspect;
    const portrait = aspect < 0.9;
    const s = portrait ? Math.min(visW * 0.72, 2.2) : Math.min(2.4, visW * 0.37, visH * 0.72);
    this.group.scale.set(s, s, s * 1.2);
    // Wide screens: centre the mark in the gap between the card column (left) and the text column (right).
    this.group.position.set(portrait ? 0.22 : 0.04, portrait ? visH * 0.2 : 0.08, -1);
  }

  /** pointer in -1..1 (y up); null keeps the camera at rest. */
  step(o: { dt: number; time: number; fluid: { velocity: THREE.Texture; density: THREE.Texture } | null; pointer: THREE.Vector2 | null; gain: number }) {
    const hz = Math.min(o.dt * 60, 3);
    const target = this.base.clone();
    if (o.pointer) { target.x += o.pointer.x * -0.35; target.y += o.pointer.y * 0.3; }
    this.gaze.lerp(target, 0.05);
    this.camera.position.copy(this.gaze);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.group.updateMatrixWorld();
    this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    // Screen-space flow -> camera world rotation -> the group's local space.
    const camRot = new THREE.Matrix3().setFromMatrix4(this.camera.matrixWorld);
    this.flowToLocal.setFromMatrix4(this.group.matrixWorld).invert().multiply(camRot);

    const u = this.simMat.uniforms;
    u.tPos.value = this.first ? this.initial : this.rt[0].texture;
    u.time.value = o.time;
    u.hz.value = hz;
    u.fluidOn.value = o.fluid ? 1 : 0;
    if (o.fluid) { u.tVel.value = o.fluid.velocity; u.tDen.value = o.fluid.density; }
    this.renderer.setRenderTarget(this.rt[1]);
    this.renderer.render(this.simScene, this.simCamera);
    this.renderer.setRenderTarget(null);
    this.rt.reverse();
    this.first = false;

    this.pointMat.uniforms.tPos.value = this.rt[0].texture;
    this.pointMat.uniforms.time.value = o.time;
    this.pointMat.uniforms.gain.value = o.gain;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  setDpr(dpr: number) { this.pointMat.uniforms.dpr.value = dpr; }

  dispose() {
    this.rt.forEach((r) => r.dispose());
    this.initial.dispose(); this.origin.dispose();
    this.simMat.dispose(); this.pointMat.dispose();
    this.scene.traverse((o) => { if (o instanceof THREE.Points || o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.simScene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}
