// Cursor fluid: the classic GPU stable-fluids pass chain (curl, vorticity, divergence, pressure, gradient subtract,
// advection) on half-float ping-pong targets. The particle simulation samples its velocity and density textures in
// screen space, so the cursor stirs the cloud and the stir fades on its own.
import * as THREE from "three";

const VERT = /* glsl */ `
  uniform vec2 texel;
  varying vec2 vUv, vL, vR, vT, vB;
  void main() {
    vUv = uv;
    vL = uv - vec2(texel.x, 0.0); vR = uv + vec2(texel.x, 0.0);
    vT = uv + vec2(0.0, texel.y); vB = uv - vec2(0.0, texel.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const FRAG = {
  // A soft line from the previous pointer position to the current one, added onto the target.
  splat: `
    uniform sampler2D target; uniform vec3 color; uniform vec2 a; uniform vec2 b; uniform float radius; uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv - a, ba = b - a;
      p.x *= aspect; ba.x *= aspect;
      float h = clamp(dot(p, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
      vec2 d = p - ba * h;
      float f = exp(-dot(d, d) / (radius * radius));
      gl_FragColor = vec4(texture2D(target, vUv).rgb + color * f, 1.0);
    }`,
  curl: `
    uniform sampler2D velocity; varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float c = texture2D(velocity, vR).y - texture2D(velocity, vL).y - texture2D(velocity, vT).x + texture2D(velocity, vB).x;
      gl_FragColor = vec4(0.5 * c, 0.0, 0.0, 1.0);
    }`,
  vorticity: `
    uniform sampler2D velocity; uniform sampler2D curl; uniform float strength; uniform float dt;
    varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float L = texture2D(curl, vL).x, R = texture2D(curl, vR).x, T = texture2D(curl, vT).x, B = texture2D(curl, vB).x;
      float C = texture2D(curl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= strength * C;
      force.y *= -1.0;
      vec2 v = texture2D(velocity, vUv).xy + force * dt;
      gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
    }`,
  divergence: `
    uniform sampler2D velocity; varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float L = texture2D(velocity, vL).x, R = texture2D(velocity, vR).x, T = texture2D(velocity, vT).y, B = texture2D(velocity, vB).y;
      vec2 C = texture2D(velocity, vUv).xy;
      if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x; if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
      gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`,
  fade: `
    uniform sampler2D source; uniform float value; varying vec2 vUv;
    void main() { gl_FragColor = value * texture2D(source, vUv); }`,
  pressure: `
    uniform sampler2D pressure; uniform sampler2D divergence; varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float L = texture2D(pressure, vL).x, R = texture2D(pressure, vR).x, T = texture2D(pressure, vT).x, B = texture2D(pressure, vB).x;
      gl_FragColor = vec4((L + R + B + T - texture2D(divergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
    }`,
  gradient: `
    uniform sampler2D pressure; uniform sampler2D velocity; varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float L = texture2D(pressure, vL).x, R = texture2D(pressure, vR).x, T = texture2D(pressure, vT).x, B = texture2D(pressure, vB).x;
      vec2 v = texture2D(velocity, vUv).xy - vec2(R - L, T - B);
      gl_FragColor = vec4(v, 0.0, 1.0);
    }`,
  advect: `
    uniform sampler2D velocity; uniform sampler2D source; uniform vec2 texel; uniform float dt; uniform float dissipation;
    varying vec2 vUv;
    void main() {
      vec2 coord = vUv - dt * texture2D(velocity, vUv).xy * texel;
      gl_FragColor = vec4(dissipation * texture2D(source, coord).rgb, 1.0);
    }`,
};

type Pass = keyof typeof FRAG;

class PingPong {
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
  constructor(size: number, type: THREE.TextureDataType) {
    const make = () => new THREE.WebGLRenderTarget(size, size, {
      type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.read = make();
    this.write = make();
  }
  swap() { [this.read, this.write] = [this.write, this.read]; }
  dispose() { this.read.dispose(); this.write.dispose(); }
}

export interface FluidOptions { simSize: number; dyeSize: number; type: THREE.TextureDataType }

export class Fluid {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private mats = {} as Record<Pass, THREE.ShaderMaterial>;
  readonly velocity: PingPong;
  readonly density: PingPong;
  private pressure: PingPong;
  private divergenceRT: THREE.WebGLRenderTarget;
  private curlRT: THREE.WebGLRenderTarget;
  private simTexel: THREE.Vector2;
  private dyeTexel: THREE.Vector2;

  constructor(renderer: THREE.WebGLRenderer, o: FluidOptions) {
    this.renderer = renderer;
    this.velocity = new PingPong(o.simSize, o.type);
    this.density = new PingPong(o.dyeSize, o.type);
    this.pressure = new PingPong(o.simSize, o.type);
    this.divergenceRT = new PingPong(o.simSize, o.type).read;
    this.curlRT = new PingPong(o.simSize, o.type).read;
    this.simTexel = new THREE.Vector2(1 / o.simSize, 1 / o.simSize);
    this.dyeTexel = new THREE.Vector2(1 / o.dyeSize, 1 / o.dyeSize);
    for (const k of Object.keys(FRAG) as Pass[]) {
      this.mats[k] = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: `precision highp float;\n${FRAG[k]}`,
        uniforms: { texel: { value: this.simTexel } },
        depthTest: false, depthWrite: false,
      });
    }
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mats.fade);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private run(pass: Pass, uniforms: Record<string, unknown>, target: THREE.WebGLRenderTarget, texel = this.simTexel) {
    const m = this.mats[pass];
    m.uniforms.texel.value = texel;
    for (const [k, v] of Object.entries(uniforms)) {
      if (m.uniforms[k]) m.uniforms[k].value = v;
      else m.uniforms[k] = { value: v };
    }
    this.quad.material = m;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  /** a, b in 0..1 UV (y up); force is the velocity added along the line; radius in UV. */
  splat(a: THREE.Vector2, b: THREE.Vector2, force: THREE.Vector2, radius: number, aspect: number) {
    this.run("splat", { target: this.velocity.read.texture, color: new THREE.Vector3(force.x, force.y, 1), a, b, radius, aspect }, this.velocity.write);
    this.velocity.swap();
    this.run("splat", { target: this.density.read.texture, color: new THREE.Vector3(1, 1, 1), a, b, radius, aspect }, this.density.write, this.dyeTexel);
    this.density.swap();
  }

  step(dt: number) {
    const v = this.velocity;
    this.run("curl", { velocity: v.read.texture }, this.curlRT);
    this.run("vorticity", { velocity: v.read.texture, curl: this.curlRT.texture, strength: 30, dt }, v.write);
    v.swap();
    this.run("divergence", { velocity: v.read.texture }, this.divergenceRT);
    this.run("fade", { source: this.pressure.read.texture, value: 0.95 }, this.pressure.write);
    this.pressure.swap();
    for (let i = 0; i < 5; i++) {
      this.run("pressure", { pressure: this.pressure.read.texture, divergence: this.divergenceRT.texture }, this.pressure.write);
      this.pressure.swap();
    }
    this.run("gradient", { pressure: this.pressure.read.texture, velocity: v.read.texture }, v.write);
    v.swap();
    this.run("advect", { velocity: v.read.texture, source: v.read.texture, dt, dissipation: 0.98 }, v.write);
    v.swap();
    this.run("advect", { velocity: v.read.texture, source: this.density.read.texture, dt, dissipation: 0.97 }, this.density.write);
    this.density.swap();
    this.renderer.setRenderTarget(null);
  }

  dispose() {
    this.velocity.dispose(); this.density.dispose(); this.pressure.dispose();
    this.divergenceRT.dispose(); this.curlRT.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.quad.geometry.dispose();
  }
}
