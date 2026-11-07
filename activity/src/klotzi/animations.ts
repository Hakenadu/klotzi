import type { AnimationName } from '@klotzi/shared';
import type { IconKind } from './particles.ts';
import type { SoundName } from '../audio.ts';

/**
 * Eine Pose beschreibt Klotzis Körperhaltung über einfache Zahlen-Kanäle.
 * Animationen liefern pro Frame eine Ziel-Pose; der Animator blendet weich dorthin.
 */
export interface Pose {
  /** Position und Blickrichtung in der Welt */
  x: number;
  z: number;
  turn: number;
  /** Körper */
  lift: number;
  crouch: number;
  pitch: number;
  roll: number;
  yaw: number;
  squash: number;
  shake: number;
  /** Kopf */
  headPitch: number;
  headYaw: number;
  headTilt: number;
  jaw: number;
  /** 0 = aufgestellt, 1 = hängend, negativ = extra gespitzt */
  ears: number;
  /** Ohren nach hinten angelegt (wütend/ängstlich) */
  earsBack: number;
  /** Augen: 1 offen, 0 zu, >1 aufgerissen */
  eyes: number;
  pupils: number;
  lookX: number;
  lookY: number;
  blush: number;
  /** Schwanz */
  tailAmp: number;
  tailSpeed: number;
  tailLift: number;
  /** Laufbewegung der Beine */
  gait: number;
  gaitSpeed: number;
  legsFront: number;
  legsBack: number;
  /** Feuer */
  flame: number;
  /** -1 verliebt (pink), 0 normal, 1 wütend (rot) */
  flameMood: number;
  /** Wie sehr Klotzi dem Mauszeiger folgt */
  attention: number;
}

export const BASE_POSE: Pose = {
  x: 0, z: 0, turn: 0,
  lift: 0, crouch: 0, pitch: 0, roll: 0, yaw: 0, squash: 1, shake: 0,
  headPitch: 0, headYaw: 0, headTilt: 0, jaw: 0.08,
  ears: 0, earsBack: 0, eyes: 1, pupils: 1, lookX: 0, lookY: 0, blush: 0.45,
  tailAmp: 0.35, tailSpeed: 5, tailLift: 0,
  gait: 0, gaitSpeed: 10, legsFront: 0, legsBack: 0,
  flame: 1, flameMood: 0, attention: 1,
};

/** Effekte, die eine Animation auslösen kann. */
export interface Fx {
  icon(kind: IconKind, where?: 'head' | 'mouth' | 'body', opts?: { size?: number; life?: number }): void;
  fire(where: 'mouth' | 'back' | 'tail', count: number, opts?: { speed?: number; mood?: number }): void;
  sound(name: SoundName): void;
  stick(visible: boolean): void;
}

export interface AnimationDef {
  duration: number;
  /** Basis-Zustände laufen endlos */
  loop?: boolean;
  /** t = Sekunden seit Start, p = Fortschritt 0..1, i = Intensität */
  pose(t: number, p: number, i: number): Partial<Pose>;
  /** Einmalige Effekte zu bestimmten Zeitpunkten (Sekunden) */
  cues?: Array<[number, (fx: Fx, i: number) => void]>;
  /** Wiederkehrende Effekte: alle n Sekunden */
  every?: [number, (fx: Fx, i: number) => void];
}

// ── kleine Helfer ──────────────────────────────────────────────
const { sin, abs, max, min, PI } = Math;
const clamp01 = (v: number) => min(1, max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const x = clamp01((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};
/** weicher Impuls um `c` mit Breite `w` */
const pulse = (t: number, c: number, w: number) => Math.exp(-(((t - c) / w) ** 2));
/** Ein- und Ausblenden am Anfang/Ende einer Animation */
const envelope = (p: number, fadeIn = 0.1, fadeOut = 0.15) => smooth(0, fadeIn, p) * (1 - smooth(1 - fadeOut, 1, p));

export const ANIMATION_DEFS: Record<AnimationName, AnimationDef> = {
  idle: {
    duration: 1,
    loop: true,
    pose: (t) => ({
      squash: 1 + 0.018 * sin(t * 2.2),
      headPitch: 0.04 * sin(t * 0.7),
      headTilt: 0.06 * sin(t * 0.43),
      ears: 0.05 + 0.05 * sin(t * 0.9),
      tailAmp: 0.35 + 0.1 * sin(t * 0.3),
    }),
  },

  happy: {
    duration: 2.6,
    pose: (t, p, i) => {
      const e = envelope(p);
      return {
        lift: abs(sin(t * 7)) * 0.16 * i * e,
        squash: 1 + 0.06 * sin(t * 14) * e,
        jaw: 0.45,
        tailAmp: 1,
        tailSpeed: 18,
        tailLift: 0.4,
        ears: -0.15,
        eyes: 0.45,
        headTilt: 0.18 * sin(t * 3.5),
        blush: 0.8,
        attention: 0.3,
      };
    },
    cues: [[0.1, (fx) => fx.sound('yip')]],
    every: [0.45, (fx) => fx.icon('spark', 'head', { size: 0.22 })],
  },

  excited: {
    duration: 3.2,
    pose: (t, p, i) => {
      const e = envelope(p, 0.05, 0.1);
      return {
        lift: max(0, sin(t * 6.5)) * 0.42 * i * e,
        squash: 1 - 0.1 * pulse(sin(t * 6.5), -1, 0.4) * e,
        turn: smooth(0.4, 0.7, p) * PI * 2,
        jaw: 0.55,
        tailAmp: 1.2,
        tailSpeed: 22,
        tailLift: 0.6,
        ears: -0.25,
        eyes: 1.15,
        pupils: 1.25,
        flame: 1.6,
        legsFront: -0.4 * max(0, sin(t * 6.5)) * e,
        legsBack: 0.4 * max(0, sin(t * 6.5)) * e,
        attention: 0,
      };
    },
    cues: [
      [0.2, (fx) => fx.sound('yip')],
      [1.6, (fx) => fx.sound('yip')],
    ],
    every: [0.35, (fx) => fx.icon('spark', 'head', { size: 0.26 })],
  },

  bark: {
    duration: 1.8,
    pose: (t, _p, i) => {
      const b = max(pulse(t, 0.35, 0.12), pulse(t, 0.95, 0.12));
      return {
        jaw: 0.1 + b * 0.95,
        headPitch: -0.28 * b,
        pitch: -0.08 * b,
        lift: 0.05 * b * i,
        ears: -0.3,
        tailAmp: 0.8,
        tailSpeed: 14,
        tailLift: 0.5,
        flame: 1 + b * 1.5 * i,
        eyes: 1.1,
        attention: 0.2,
      };
    },
    cues: [
      [0.3, (fx, i) => (fx.sound('bark'), fx.fire('mouth', Math.round(18 * i)), fx.icon('exclaim', 'head'))],
      [0.9, (fx, i) => (fx.sound('bark'), fx.fire('mouth', Math.round(22 * i)))],
    ],
  },

  sad: {
    duration: 4.5,
    pose: (t) => ({
      ears: 1,
      headPitch: 0.42,
      headTilt: 0.1 * sin(t * 0.8),
      eyes: 0.75,
      pupils: 1.45,
      lookY: 0.7,
      tailAmp: 0.05,
      tailSpeed: 2,
      tailLift: -1,
      squash: 0.96,
      crouch: 0.12,
      flame: 0.35,
      blush: 0.2,
      attention: 0,
    }),
    cues: [
      [0.4, (fx) => fx.sound('whine')],
      [1.0, (fx) => fx.icon('drop', 'head', { size: 0.22, life: 2.2 })],
    ],
  },

  angry: {
    duration: 3,
    pose: (t, p, i) => ({
      flame: 1 + 1.6 * i * envelope(p),
      flameMood: 1,
      earsBack: 1,
      headPitch: 0.15,
      crouch: 0.18,
      pitch: 0.06,
      jaw: 0.25 + 0.08 * abs(sin(t * 20)),
      shake: 0.012 * i,
      eyes: 0.72,
      pupils: 0.6,
      tailAmp: 0.15,
      tailSpeed: 25,
      tailLift: 0.9,
      blush: 0,
      attention: 0,
    }),
    cues: [
      [0.1, (fx) => (fx.sound('growl'), fx.icon('anger', 'head'))],
      [0.6, (fx, i) => fx.fire('back', Math.round(30 * i), { mood: 1, speed: 1.5 })],
      [1.6, (fx) => fx.icon('anger', 'head')],
    ],
  },

  sleep: {
    duration: 9,
    pose: (t, p) => {
      const down = smooth(0, 0.08, p) * (1 - smooth(0.92, 1, p));
      return {
        crouch: down,
        legsFront: -1.35 * down,
        legsBack: 1.2 * down,
        headPitch: 0.3 * down,
        headTilt: 0.2 * down,
        eyes: 1 - down,
        ears: 0.7 * down,
        squash: 1 + 0.04 * sin(t * 1.4) * down,
        tailAmp: 0.05,
        tailSpeed: 1,
        tailLift: -0.6 * down,
        flame: 1 - 0.55 * down,
        attention: 1 - down,
      };
    },
    every: [1.3, (fx) => fx.icon('z', 'head', { size: 0.26, life: 2.4 })],
  },

  think: {
    duration: 3,
    pose: (t) => ({
      headTilt: 0.35,
      headYaw: 0.15 + 0.05 * sin(t * 1.5),
      headPitch: -0.08,
      lookX: 0.6,
      lookY: 0.9,
      eyes: 0.85,
      ears: 0.15,
      tailAmp: 0.2,
      tailSpeed: 3,
      attention: 0,
    }),
    every: [1.1, (fx) => fx.icon('dots', 'head', { size: 0.3, life: 1.3 })],
  },

  eat: {
    duration: 3.2,
    pose: (t, p) => {
      const chew = smooth(0.12, 0.2, p) * (1 - smooth(0.8, 0.9, p));
      return {
        headPitch: 0.45 * chew + 0.12 * sin(t * 13) * chew,
        jaw: 0.2 + abs(sin(t * 13)) * 0.45 * chew,
        tailAmp: 1,
        tailSpeed: 16,
        tailLift: 0.4,
        eyes: 0.4 + 0.6 * (1 - chew),
        ears: -0.1,
        blush: 0.75,
        attention: 0,
      };
    },
    cues: [
      [0.05, (fx) => fx.icon('bone', 'mouth', { size: 0.36, life: 0.6 })],
      [0.5, (fx) => fx.sound('chomp')],
      [1.2, (fx) => fx.sound('chomp')],
      [2.6, (fx) => (fx.icon('heart', 'head'), fx.sound('yip'))],
    ],
  },

  love: {
    duration: 3.2,
    pose: (t, p) => ({
      eyes: 0.28,
      headTilt: 0.25 * sin(t * 2.2),
      roll: 0.08 * sin(t * 2.2),
      squash: 1 + 0.03 * sin(t * 4.4),
      jaw: 0.3,
      tailAmp: 1,
      tailSpeed: 15,
      tailLift: 0.4,
      ears: 0.35,
      blush: 1,
      flame: 1.3,
      flameMood: -1 * envelope(p),
      attention: 0,
    }),
    cues: [[0.1, (fx) => fx.sound('happy')]],
    every: [0.3, (fx) => fx.icon('heart', 'head', { size: 0.3 })],
  },

  fetch: {
    duration: 4.8,
    pose: (t, p) => {
      const out = smooth(0.06, 0.3, p);
      const back = smooth(0.48, 0.72, p);
      const running = (p > 0.06 && p < 0.33) || (p > 0.46 && p < 0.72) ? 1 : 0;
      const home = p > 0.72;
      return {
        x: 6.5 * out * (1 - back),
        turn: home ? 0 : p < 0.45 ? PI / 2 : -PI / 2,
        gait: running,
        gaitSpeed: 18,
        lift: running * abs(sin(t * 18)) * 0.08,
        pitch: running * 0.1,
        jaw: home ? 0.25 : running ? 0.4 : 0.1,
        tailAmp: home ? 1.1 : 0.6,
        tailSpeed: home ? 20 : 12,
        tailLift: 0.5,
        ears: running ? 0.5 : -0.2,
        eyes: home ? 0.5 : 1,
        headPitch: home ? -0.12 : 0,
        attention: 0,
      };
    },
    cues: [
      [0.2, (fx) => fx.sound('yip')],
      [1.5, (fx) => fx.stick(true)],
      [4.2, (fx) => (fx.stick(false), fx.icon('spark', 'mouth'), fx.sound('yip'))],
    ],
    every: [0.25, (fx) => fx.icon('dust', 'body', { size: 0.25, life: 0.6 })],
  },

  dance: {
    duration: 4.4,
    pose: (t, p) => {
      const e = envelope(p);
      const beat = sin(t * 7.5);
      return {
        roll: 0.18 * beat * e,
        lift: abs(beat) * 0.1 * e,
        headTilt: -0.3 * beat * e,
        turn: 0.45 * sin(t * 3.75) * e,
        legsFront: 0.35 * beat * e,
        squash: 1 + 0.05 * abs(sin(t * 15)) * e,
        jaw: 0.35,
        eyes: 0.5,
        tailAmp: 1,
        tailSpeed: 15,
        tailLift: 0.5,
        flame: 1.4,
        attention: 0,
      };
    },
    cues: [[0.1, (fx) => fx.sound('happy')]],
    every: [0.45, (fx) => fx.icon('note', 'head', { size: 0.28 })],
  },

  confused: {
    duration: 2.6,
    pose: (t, p) => ({
      headTilt: p < 0.5 ? 0.4 : -0.4,
      headPitch: -0.05,
      ears: 0.25,
      earsBack: 0.2,
      lookX: p < 0.5 ? -0.6 : 0.6,
      eyes: 1.1,
      jaw: 0.15,
      tailAmp: 0.2,
      tailSpeed: 3,
      squash: 1 + 0.02 * sin(t * 3),
      attention: 0,
    }),
    cues: [
      [0.15, (fx) => (fx.icon('question', 'head', { size: 0.34 }), fx.sound('whine'))],
      [1.3, (fx) => fx.icon('question', 'head', { size: 0.3 })],
    ],
  },

  scared: {
    duration: 2.6,
    pose: (_t, p) => {
      const e = envelope(p, 0.04, 0.25);
      return {
        z: -0.45 * e,
        lift: 0.25 * pulse(p, 0.06, 0.04),
        crouch: 0.35 * e,
        shake: 0.02 * e,
        ears: 1,
        earsBack: 0.6,
        eyes: 1.3,
        pupils: 0.55,
        tailLift: -1,
        tailAmp: 0,
        flame: 0.5,
        blush: 0,
        attention: 0,
      };
    },
    cues: [[0.02, (fx) => (fx.icon('exclaim', 'head', { size: 0.36 }), fx.sound('yelp'))]],
  },
};
