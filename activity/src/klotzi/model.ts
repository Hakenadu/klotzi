import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Klotzi wird komplett prozedural aus einfachen Formen gebaut – ganz im Sinne
 * seines Namens aus abgerundeten "Klötzen". Dadurch braucht die Activity keine
 * externen Modelldateien und jedes Körperteil ist ein eigenes, animierbares Gelenk.
 */

export const PALETTE = {
  fur: 0x2c2433,
  furLight: 0x4a3d55,
  muzzle: 0x5b4b66,
  ember: 0xff7a1a,
  emberHot: 0xffc23d,
  eye: 0xffb31a,
  horn: 0xe9dcc9,
  collar: 0xd4202c,
  gold: 0xffc94a,
  nose: 0x140f18,
  tongue: 0xff6f91,
  blush: 0xff5c8a,
  stick: 0x7a4a26,
};

export interface KlotziRig {
  /** Position & Drehung in der Welt */
  root: THREE.Group;
  /** Körper (Hüpfen, Neigen, Stauchen) */
  body: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group;
  ears: [THREE.Group, THREE.Group];
  eyes: [THREE.Group, THREE.Group];
  pupils: [THREE.Mesh, THREE.Mesh];
  tail: THREE.Group[];
  legs: { fl: THREE.Group; fr: THREE.Group; bl: THREE.Group; br: THREE.Group };
  stick: THREE.Mesh;
  /** Punkte, an denen Effekte entstehen */
  anchors: {
    tailTip: THREE.Object3D;
    headTop: THREE.Object3D;
    mouth: THREE.Object3D;
    bubble: THREE.Object3D;
    back: THREE.Object3D[];
  };
  /** Materialien, deren Leuchten animiert wird */
  glow: {
    eyes: THREE.MeshToonMaterial;
    ember: THREE.MeshToonMaterial;
    blush: THREE.MeshBasicMaterial;
  };
  /** Meshes, auf die man klicken kann (Streicheln) */
  pickables: THREE.Object3D[];
}

let gradientMap: THREE.DataTexture | undefined;

/** Stufen-Verlauf für den Cartoon-/Toon-Look. */
function toonGradient(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const steps = new Uint8Array([70, 140, 210, 255]);
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradientMap = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

function toon(color: number, emissive = 0x000000, emissiveIntensity = 1): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, emissive, emissiveIntensity, gradientMap: toonGradient() });
}

function box(w: number, h: number, d: number, r: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), material);
  mesh.castShadow = true;
  return mesh;
}

function sphere(r: number, material: THREE.Material, segments = 20): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, segments, Math.round(segments * 0.75)), material);
}

function at<T extends THREE.Object3D>(obj: T, x: number, y: number, z: number): T {
  obj.position.set(x, y, z);
  return obj;
}

function group(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const g = at(new THREE.Group(), x, y, z);
  parent.add(g);
  return g;
}

export function buildKlotzi(): KlotziRig {
  const fur = toon(PALETTE.fur);
  const furLight = toon(PALETTE.furLight);
  const muzzle = toon(PALETTE.muzzle);
  const ember = toon(PALETTE.ember, PALETTE.ember, 1.6);
  const eyeMat = toon(PALETTE.eye, PALETTE.eye, 0.6);
  const horn = toon(PALETTE.horn);
  const collar = toon(PALETTE.collar);
  const gold = new THREE.MeshStandardMaterial({ color: PALETTE.gold, metalness: 0.8, roughness: 0.25, emissive: 0x4a2a00 });
  const black = new THREE.MeshStandardMaterial({ color: PALETTE.nose, roughness: 0.15, metalness: 0.1 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const tongue = toon(PALETTE.tongue);
  const mouthMat = toon(0x2a0508, 0xff3300, 0.9);
  const blush = new THREE.MeshBasicMaterial({ color: PALETTE.blush, transparent: true, opacity: 0.45, depthWrite: false });

  const root = new THREE.Group();
  root.name = 'Klotzi';
  const body = group(root, 0, 0.83, 0);
  const pickables: THREE.Object3D[] = [];

  // ── Rumpf ──────────────────────────────────────────────
  const torso = box(0.95, 0.72, 1.15, 0.3, fur);
  body.add(torso);
  const chest = at(sphere(0.33, furLight), 0, -0.04, 0.42);
  chest.scale.set(1.15, 1, 0.75);
  body.add(chest);
  pickables.push(torso, chest);

  // kleine glühende Stacheln auf dem Rücken
  const back: THREE.Object3D[] = [];
  [0.18, -0.12, -0.4].forEach((z, i) => {
    const spike = at(new THREE.Mesh(new THREE.ConeGeometry(0.07 - i * 0.012, 0.2 - i * 0.03, 10), ember), 0, 0.38, z);
    spike.rotation.x = -0.45;
    body.add(spike);
    back.push(spike);
  });

  // ── Halsband mit Marke ─────────────────────────────────
  const collarGroup = group(body, 0, 0.24, 0.3);
  collarGroup.rotation.x = 0.35;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 12, 36), collar);
  ring.rotation.x = Math.PI / 2;
  collarGroup.add(ring);
  for (let i = -2; i <= 2; i++) {
    const a = i * 0.45;
    const spike = at(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 8), gold), Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4);
    // Spitze (+y) zeigt nach außen: erst +z nach außen ausrichten, dann kippen
    spike.lookAt(spike.position.clone().multiplyScalar(2));
    spike.rotateX(Math.PI / 2);
    collarGroup.add(spike);
  }
  const tag = at(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 20), gold), 0, -0.1, 0.4);
  tag.rotation.x = Math.PI / 2 - 0.55;
  collarGroup.add(tag);

  // ── Kopf ───────────────────────────────────────────────
  const head = group(body, 0, 0.32, 0.45);
  const skull = at(box(1.0, 0.85, 0.85, 0.34, fur), 0, 0.38, 0.22);
  head.add(skull);
  pickables.push(skull);

  const snout = at(box(0.52, 0.34, 0.36, 0.15, muzzle), 0, 0.22, 0.68);
  head.add(snout);
  const nose = at(sphere(0.075, black), 0, 0.35, 0.86);
  nose.scale.set(1.35, 0.9, 0.9);
  head.add(nose);
  for (const side of [-1, 1]) {
    const fang = at(new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.08, 8), white), side * 0.11, 0.04, 0.8);
    fang.rotation.x = Math.PI;
    head.add(fang);
    const cheek = at(new THREE.Mesh(new THREE.CircleGeometry(0.08, 20), blush), side * 0.38, 0.27, 0.646);
    head.add(cheek);
  }

  // Maul: dunkles, glühendes Inneres + beweglicher Unterkiefer
  const mouthInside = at(box(0.38, 0.12, 0.26, 0.05, mouthMat), 0, 0.09, 0.66);
  head.add(mouthInside);
  const jaw = group(head, 0, 0.07, 0.55);
  const jawMesh = at(box(0.44, 0.12, 0.3, 0.05, muzzle), 0, -0.03, 0.14);
  jaw.add(jawMesh);
  const tongueMesh = at(sphere(0.09, tongue), 0, 0.02, 0.16);
  tongueMesh.scale.set(1.2, 0.35, 1.3);
  jaw.add(tongueMesh);
  const mouth = at(new THREE.Object3D(), 0, 0.05, 0.36);
  jaw.add(mouth);

  // Stöckchen fürs Apportieren
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.85, 8), toon(PALETTE.stick));
  stick.rotation.z = Math.PI / 2;
  stick.position.set(0.05, 0.03, 0.22);
  stick.visible = false;
  jaw.add(stick);

  // Augen: glühend, mit großen Pupillen und Glanzpunkt
  const eyes = [-1, 1].map((side) => {
    const eye = group(head, side * 0.24, 0.5, 0.62);
    const ball = sphere(0.135, eyeMat);
    ball.scale.set(1, 1.12, 0.5);
    eye.add(ball);
    const pupil = at(sphere(0.075, black), 0, -0.01, 0.055);
    pupil.scale.set(0.85, 1.2, 0.45);
    eye.add(pupil);
    const shine = at(sphere(0.032, white, 10), 0.035, 0.05, 0.07);
    pupil.add(shine);
    shine.scale.set(1 / 0.85, 1 / 1.2, 1 / 0.45);
    return { eye, pupil };
  }) as [{ eye: THREE.Group; pupil: THREE.Mesh }, { eye: THREE.Group; pupil: THREE.Mesh }];

  // Ohren: Basis mit glühender Innenseite
  const ears = [-1, 1].map((side) => {
    const pivot = group(head, side * 0.32, 0.72, 0.16);
    const ear = at(new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 4), fur), 0, 0.19, 0);
    ear.rotation.y = Math.PI / 4;
    ear.scale.z = 0.55;
    pivot.add(ear);
    const inner = at(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.27, 4), ember), 0, 0.14, 0.05);
    inner.rotation.y = Math.PI / 4;
    inner.scale.z = 0.3;
    pivot.add(inner);
    pickables.push(ear);
    return pivot;
  }) as [THREE.Group, THREE.Group];

  // Hörnchen
  for (const side of [-1, 1]) {
    const hornMesh = at(new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.22, 12), horn), side * 0.17, 0.84, 0.36);
    hornMesh.rotation.set(-0.35, 0, -side * 0.45);
    head.add(hornMesh);
  }

  const headTop = at(new THREE.Object3D(), 0, 0.84, 0.2);
  head.add(headTop);
  const bubble = at(new THREE.Object3D(), 0, 1.25, 0.2);
  head.add(bubble);

  // ── Beine ──────────────────────────────────────────────
  const leg = (x: number, z: number) => {
    const hip = group(body, x, -0.2, z);
    hip.add(at(box(0.26, 0.55, 0.26, 0.11, fur), 0, -0.26, 0));
    const paw = at(box(0.32, 0.16, 0.36, 0.07, furLight), 0, -0.55, 0.04);
    hip.add(paw);
    for (const cx of [-0.085, 0, 0.085]) {
      hip.add(at(sphere(0.03, ember, 8), cx, -0.57, 0.225));
    }
    return hip;
  };
  const legs = { fl: leg(-0.29, 0.36), fr: leg(0.29, 0.36), bl: leg(-0.29, -0.38), br: leg(0.29, -0.38) };

  // ── Schwanz mit Flammenspitze ──────────────────────────
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = group(body, 0, 0.1, -0.55);
  for (let i = 0; i < 6; i++) {
    const seg = group(parent, 0, i === 0 ? 0 : 0.11, 0);
    seg.add(sphere(0.105 - i * 0.011, i === 5 ? ember : fur, 14));
    tail.push(seg);
    parent = seg;
  }
  const tailTip = at(new THREE.Object3D(), 0, 0.08, 0);
  parent.add(tailTip);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });

  return {
    root,
    body,
    head,
    jaw,
    ears,
    eyes: [eyes[0].eye, eyes[1].eye],
    pupils: [eyes[0].pupil, eyes[1].pupil],
    tail,
    legs,
    stick,
    anchors: { tailTip, headTop, mouth, bubble, back },
    glow: { eyes: eyeMat, ember, blush },
    pickables,
  };
}
