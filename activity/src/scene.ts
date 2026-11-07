import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Klotzi } from './klotzi/klotzi.ts';
import type { FlameEmitter } from './klotzi/particles.ts';

export interface SceneOptions {
  /** Transparenter Hintergrund (z. B. als OBS-Overlay) */
  transparent: boolean;
  /** Bloom und hohe Auflösung abschalten */
  lowQuality: boolean;
}

/** Leuchtende Höllen-Plattform mit Pfotenabdruck und Runenkreis. */
function platformTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.translate(c, c);
  g.strokeStyle = '#ff6a1a';
  g.fillStyle = '#ff6a1a';
  g.shadowColor = '#ff8a2a';
  g.shadowBlur = 24;
  g.lineCap = 'round';

  // Ringe
  for (const [r, w] of [[470, 10], [420, 4]] as const) {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  // Runen zwischen den Ringen (zufällige, aber feste Striche)
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.lineWidth = 5;
  for (let i = 0; i < 24; i++) {
    g.save();
    g.rotate((i / 24) * Math.PI * 2);
    g.translate(0, -445);
    g.beginPath();
    for (let s = 0; s < 3; s++) {
      g.moveTo((rand() - 0.5) * 22, (rand() - 0.5) * 22);
      g.lineTo((rand() - 0.5) * 22, (rand() - 0.5) * 22);
    }
    g.stroke();
    g.restore();
  }
  // Risse im Stein
  g.lineWidth = 3;
  g.globalAlpha = 0.55;
  for (let i = 0; i < 9; i++) {
    let a = rand() * Math.PI * 2;
    let r = 120 + rand() * 60;
    g.beginPath();
    g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    while (r < 400) {
      r += 30 + rand() * 40;
      a += (rand() - 0.5) * 0.35;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  // Pfotenabdruck in der Mitte
  g.globalAlpha = 0.85;
  g.beginPath();
  g.ellipse(0, 40, 85, 70, 0, 0, Math.PI * 2);
  g.fill();
  for (const [x, y, r] of [[-95, -55, 34], [-35, -105, 36], [35, -105, 36], [95, -55, 34]] as const) {
    g.beginPath();
    g.ellipse(x, y, r, r * 1.2, x * 0.004, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Höllischer Farbverlauf als Hintergrund (glüht von unten). */
function backgroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0d0716');
  grad.addColorStop(0.55, '#23102f');
  grad.addColorStop(0.85, '#4a1630');
  grad.addColorStop(1, '#5c1a24');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class Stage3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private readonly composer: EffectComposer | undefined;
  private readonly bloom: UnrealBloomPass | undefined;
  private readonly runes: THREE.MeshBasicMaterial;
  private readonly shadow: THREE.Mesh;
  private readonly tailLight = new THREE.PointLight(0xff7a1a, 2.5, 4, 1.6);
  private time = 0;
  private readonly moveEmbers: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly klotzi: Klotzi,
    private readonly options: SceneOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !options.lowQuality, alpha: options.transparent });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.lowQuality ? 1 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    if (options.transparent) this.renderer.setClearColor(0x000000, 0);
    else this.scene.background = backgroundTexture();

    // ── Licht ──
    this.scene.add(new THREE.HemisphereLight(0xb9a3ff, 0x2a0a10, 1.4));
    const key = new THREE.DirectionalLight(0xfff1e0, 2.2);
    key.position.set(2.5, 5, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff5a2a, 2.5);
    rim.position.set(-3, 2.5, -4);
    this.scene.add(rim);
    this.klotzi.rig.anchors.tailTip.add(this.tailLight);

    // ── Plattform ──
    const stone = new THREE.MeshToonMaterial({ color: 0x241b2b });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.55, 0.3, 72), stone);
    platform.position.y = -0.15;
    this.scene.add(platform);
    this.runes = new THREE.MeshBasicMaterial({
      map: platformTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0xff8a3a,
    });
    const top = new THREE.Mesh(new THREE.CircleGeometry(2.3, 72), this.runes);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.002;
    this.scene.add(top);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 2),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.006;
    this.scene.add(this.shadow);

    // ── Klotzi & schwebende Glut ──
    this.scene.add(...klotzi.objects);
    const emberAnchor = new THREE.Object3D();
    this.scene.add(emberAnchor);
    const ambient: FlameEmitter = {
      anchor: emberAnchor, rate: 6, size: 0.07, spread: 0, rise: 0.25, life: 3.5, intensity: () => 1,
    };
    klotzi.flames.addEmitter(ambient);
    // der Anker springt jedes Frame an eine zufällige Stelle → verstreute Glutfunken
    this.moveEmbers = () => emberAnchor.position.set((Math.random() - 0.5) * 7, Math.random() * 0.5, (Math.random() - 0.5) * 3 - 0.5);

    // ── Nachbearbeitung: Leuchten (Bloom) ──
    if (!options.lowQuality && !options.transparent) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.88);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Kamera so platzieren, dass Klotzi in jedes Fenster passt (auch Discord-PiP). */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w, h);
    this.camera.aspect = w / h;

    const radius = 1.95; // Klotzi + Platz für Sprechblase/Effekte
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = radius / Math.sin(Math.min(vFov, hFov) / 2);
    const dir = new THREE.Vector3(0, 0.3, 1).normalize();
    const lookAt = new THREE.Vector3(0, 1.05, 0);
    this.camera.position.copy(lookAt).addScaledVector(dir, distance);
    this.camera.lookAt(lookAt);
    this.camera.updateProjectionMatrix();
    this.klotzi.flames.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  render(dt: number): void {
    this.time += dt;
    this.moveEmbers();
    const ground = this.klotzi.groundPosition();
    this.shadow.position.x = ground.x;
    this.shadow.position.z = ground.z + 0.02;
    this.shadow.scale.setScalar(Math.max(0.4, 1.25 - (ground.height - 0.83) * 0.8));
    this.runes.opacity = 0.75 + 0.25 * Math.sin(this.time * 1.7);
    this.tailLight.intensity = 2 + Math.sin(this.time * 17) * 0.4 + Math.sin(this.time * 5.3) * 0.3;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Klick-Test: wurde Klotzi getroffen? */
  hitsKlotzi(ndcX: number, ndcY: number): boolean {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return ray.intersectObjects(this.klotzi.rig.pickables, false).length > 0;
  }

  /** Weltposition → Pixelkoordinaten im Fenster. */
  toScreen(world: THREE.Vector3): { x: number; y: number } {
    const v = world.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }
}
