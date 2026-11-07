import * as THREE from 'three';

// ═════════════════════════════════════════════════════════════════════════
//  Feuer: additive Punkt-Partikel, auf der CPU simuliert
// ═════════════════════════════════════════════════════════════════════════

const FLAME_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const FLAME_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a *= a;
    gl_FragColor = vec4(vColor * (1.0 + a), a * vAlpha);
  }
`;

interface Particle {
  life: number;
  maxLife: number;
  size: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** 0 = normal, 1 = wütend rot, -1 = verliebt pink */
  mood: number;
}

export interface FlameEmitter {
  anchor: THREE.Object3D;
  /** Partikel pro Sekunde bei Intensität 1 */
  rate: number;
  size: number;
  spread: number;
  rise: number;
  life: number;
  /** wird jedes Frame gelesen: aktuelle Stärke */
  intensity: () => number;
  mood?: () => number;
  /** intern */
  carry?: number;
}

const COLD = new THREE.Color(0x3a0a12);
const PALETTES: Record<'normal' | 'angry' | 'love', THREE.Color[]> = {
  normal: [new THREE.Color(0xfff1a8), new THREE.Color(0xffb02e), new THREE.Color(0xff5a14), COLD],
  angry: [new THREE.Color(0xffd0a0), new THREE.Color(0xff3a14), new THREE.Color(0xc2000f), COLD],
  love: [new THREE.Color(0xffe4f1), new THREE.Color(0xff7ac0), new THREE.Color(0xd63384), COLD],
};

function sampleGradient(stops: THREE.Color[], t: number, out: THREE.Color): THREE.Color {
  const x = Math.min(0.999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return out.copy(stops[i]!).lerp(stops[i + 1]!, x - i);
}

export class FlameSystem {
  readonly points: THREE.Points;
  private readonly particles: Particle[] = [];
  private readonly emitters = new Set<FlameEmitter>();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor(private readonly capacity = 900) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      uniforms: { uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Skaliert die Punktgröße passend zur Canvas-Höhe. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale!.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  addEmitter(emitter: FlameEmitter): FlameEmitter {
    this.emitters.add(emitter);
    return emitter;
  }

  /** Einmaliger Feuerstoß, z. B. beim Bellen. */
  burst(position: THREE.Vector3, direction: THREE.Vector3, count: number, opts: { speed?: number; size?: number; spread?: number; mood?: number } = {}): void {
    const { speed = 2, size = 0.22, spread = 0.6, mood = 0 } = opts;
    for (let i = 0; i < count; i++) {
      const vel = direction
        .clone()
        .normalize()
        .multiplyScalar(speed * (0.6 + Math.random() * 0.6))
        .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread + 0.3, (Math.random() - 0.5) * spread));
      this.spawn(position, vel, size * (0.6 + Math.random() * 0.8), 0.5 + Math.random() * 0.4, mood);
    }
  }

  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, mood: number): void {
    if (this.particles.length >= this.capacity) return;
    this.particles.push({ pos: pos.clone(), vel, size, life: 0, maxLife: life, mood });
  }

  update(dt: number): void {
    for (const e of this.emitters) {
      const intensity = e.intensity();
      if (intensity <= 0.01) continue;
      e.carry = (e.carry ?? 0) + e.rate * intensity * dt;
      e.anchor.getWorldPosition(this.tmp);
      const mood = e.mood?.() ?? 0;
      while (e.carry >= 1) {
        e.carry -= 1;
        const jitter = new THREE.Vector3(
          (Math.random() - 0.5) * e.spread,
          (Math.random() - 0.5) * e.spread * 0.5,
          (Math.random() - 0.5) * e.spread,
        );
        const vel = new THREE.Vector3((Math.random() - 0.5) * 0.25, e.rise * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * 0.25);
        this.spawn(this.tmp.clone().add(jitter), vel, e.size * (0.7 + Math.random() * 0.6) * Math.min(1.8, 0.6 + intensity * 0.4), e.life * (0.7 + Math.random() * 0.6), mood);
      }
    }

    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      // Flammen steigen auf, flackern seitlich und werden gebremst
      p.vel.y += 1.6 * dt;
      p.vel.multiplyScalar(1 - 1.8 * dt);
      p.vel.x += (Math.random() - 0.5) * 2.2 * dt;
      p.vel.z += (Math.random() - 0.5) * 2.2 * dt;
      p.pos.addScaledVector(p.vel, dt);

      const t = p.life / p.maxLife;
      const palette = p.mood > 0.5 ? PALETTES.angry : p.mood < -0.5 ? PALETTES.love : PALETTES.normal;
      sampleGradient(palette, t, this.tmpColor);

      this.positions.set([p.pos.x, p.pos.y, p.pos.z], n * 3);
      this.colors.set([this.tmpColor.r, this.tmpColor.g, this.tmpColor.b], n * 3);
      this.sizes[n] = p.size * (1 - t * 0.7) * (t < 0.15 ? t / 0.15 : 1);
      this.alphas[n] = (1 - t) * 0.9;
      n++;
    }
    this.geometry.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
      (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  Symbole: Herzchen, Zzz, Fragezeichen, Noten … als Sprites
// ═════════════════════════════════════════════════════════════════════════

export type IconKind = 'heart' | 'z' | 'question' | 'exclaim' | 'note' | 'spark' | 'drop' | 'anger' | 'bone' | 'dots' | 'dust';

const textureCache = new Map<IconKind, THREE.Texture>();

function drawIcon(kind: IconKind): THREE.Texture {
  const cached = textureCache.get(kind);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.translate(size / 2, size / 2);
  g.lineJoin = g.lineCap = 'round';
  const outline = (fill: string, stroke = '#1b0f1f', width = 10) => {
    g.lineWidth = width;
    g.strokeStyle = stroke;
    g.stroke();
    g.fillStyle = fill;
    g.fill();
  };
  const text = (t: string, fill: string, px = 92) => {
    g.font = `900 ${px}px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 12;
    g.strokeStyle = '#1b0f1f';
    g.strokeText(t, 0, 6);
    g.fillStyle = fill;
    g.fillText(t, 0, 6);
  };

  switch (kind) {
    case 'heart':
      g.beginPath();
      g.moveTo(0, 40);
      g.bezierCurveTo(-70, -5, -45, -60, 0, -28);
      g.bezierCurveTo(45, -60, 70, -5, 0, 40);
      outline('#ff4f8b');
      break;
    case 'z':
      text('Z', '#b9a7ff');
      break;
    case 'question':
      text('?', '#ffd23d');
      break;
    case 'exclaim':
      text('!', '#ff5a3a');
      break;
    case 'note':
      text('♪', '#7de3ff', 100);
      break;
    case 'dots':
      text('…', '#ffffff', 100);
      break;
    case 'spark': {
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? 50 : 14;
        const a = (i / 8) * Math.PI * 2;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      outline('#fff3a0', '#ff9a1f', 6);
      break;
    }
    case 'drop':
      g.beginPath();
      g.moveTo(0, -48);
      g.bezierCurveTo(30, -5, 38, 15, 30, 30);
      g.arc(0, 22, 30, 0.3, Math.PI - 0.3);
      g.bezierCurveTo(-38, 15, -30, -5, 0, -48);
      outline('#7cc8ff');
      break;
    case 'anger':
      g.strokeStyle = '#ff2e3a';
      g.lineWidth = 16;
      for (let i = 0; i < 4; i++) {
        g.save();
        g.rotate((i * Math.PI) / 2);
        g.beginPath();
        g.arc(32, 32, 26, Math.PI, Math.PI * 1.5);
        g.stroke();
        g.restore();
      }
      break;
    case 'bone':
      g.beginPath();
      g.roundRect(-34, -11, 68, 22, 8);
      for (const [x, y] of [[-38, -14], [-38, 14], [38, -14], [38, 14]] as const) {
        g.moveTo(x + 15, y);
        g.arc(x, y, 15, 0, Math.PI * 2);
      }
      outline('#fff1d6', '#1b0f1f', 8);
      break;
    case 'dust':
      g.beginPath();
      g.arc(0, 0, 40, 0, Math.PI * 2);
      g.fillStyle = 'rgba(200,180,210,0.6)';
      g.fill();
      break;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(kind, texture);
  return texture;
}

interface Icon {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  vel: THREE.Vector3;
  wobble: number;
  size: number;
}

export class IconSystem {
  readonly group = new THREE.Group();
  private readonly icons: Icon[] = [];

  spawn(kind: IconKind, position: THREE.Vector3, opts: { size?: number; life?: number; vel?: THREE.Vector3; spread?: number } = {}): void {
    const { size = 0.3, life = 1.8, spread = 0.3 } = opts;
    const material = new THREE.SpriteMaterial({ map: drawIcon(kind), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread * 0.5));
    sprite.renderOrder = 20;
    this.group.add(sprite);
    this.icons.push({
      sprite,
      life: 0,
      maxLife: life,
      vel: opts.vel?.clone() ?? new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.55 + Math.random() * 0.2, 0),
      wobble: Math.random() * Math.PI * 2,
      size,
    });
  }

  update(dt: number): void {
    for (let i = this.icons.length - 1; i >= 0; i--) {
      const icon = this.icons[i]!;
      icon.life += dt;
      const t = icon.life / icon.maxLife;
      if (t >= 1) {
        this.group.remove(icon.sprite);
        icon.sprite.material.dispose();
        this.icons.splice(i, 1);
        continue;
      }
      icon.sprite.position.addScaledVector(icon.vel, dt);
      icon.sprite.position.x += Math.sin(icon.life * 4 + icon.wobble) * 0.15 * dt;
      // Aufploppen, dann ausblenden
      const pop = t < 0.15 ? THREE.MathUtils.smoothstep(t, 0, 0.15) * 1.15 : 1;
      icon.sprite.scale.setScalar(icon.size * pop);
      icon.sprite.material.opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      icon.sprite.material.rotation = Math.sin(icon.life * 3 + icon.wobble) * 0.2;
    }
  }
}
