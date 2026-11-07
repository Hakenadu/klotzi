import * as THREE from 'three';
import type { AnimationName } from '@klotzi/shared';
import { ANIMATION_DEFS, BASE_POSE, type AnimationDef, type Fx, type Pose } from './animations.ts';
import { buildKlotzi, type KlotziRig } from './model.ts';
import { FlameSystem, IconSystem } from './particles.ts';
import type { Sounds } from '../audio.ts';

interface Running {
  name: AnimationName;
  def: AnimationDef;
  time: number;
  intensity: number;
  firedCues: number;
  nextEvery: number;
}

/** Wie schnell jeder Kanal seinem Ziel folgt (größer = schneller). */
const STIFFNESS: Partial<Record<keyof Pose, number>> = {
  x: 5, z: 6, turn: 7, jaw: 18, eyes: 16, lift: 16, shake: 20, gait: 8, crouch: 5,
};
const DEFAULT_STIFFNESS = 8;
/** Nach so vielen Sekunden ohne Ereignis schläft Klotzi ein. */
const SLEEP_AFTER = 180;

/**
 * Steuert den 3D-Klotzi: spielt Animationen, blendet Posen,
 * erzeugt Effekte (Feuer, Symbole, Töne) und reagiert auf den Mauszeiger.
 */
export class Klotzi {
  readonly rig: KlotziRig;
  readonly flames = new FlameSystem();
  readonly icons = new IconSystem();

  private readonly pose: Pose = { ...BASE_POSE };
  private readonly target: Pose = { ...BASE_POSE };
  private action: Running | undefined;
  private base: Running;
  private time = 0;
  private idleTime = 0;
  private thinkRun: Running | undefined;
  private talk = 0;
  private perk = 0;
  private blink = { next: 2, t: -1 };
  private tailPhase = 0;
  private gaitPhase = 0;
  private readonly look = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly fx: Fx;

  constructor(private readonly sounds?: Sounds) {
    this.rig = buildKlotzi();
    this.base = this.start('idle');
    this.fx = this.createFx();

    const { anchors } = this.rig;
    this.flames.addEmitter({
      anchor: anchors.tailTip, rate: 55, size: 0.3, spread: 0.06, rise: 0.9, life: 0.55,
      intensity: () => this.pose.flame, mood: () => this.pose.flameMood,
    });
    this.flames.addEmitter({
      anchor: anchors.headTop, rate: 16, size: 0.16, spread: 0.12, rise: 0.6, life: 0.4,
      intensity: () => this.pose.flame * 0.6, mood: () => this.pose.flameMood,
    });
    for (const spike of anchors.back) {
      this.flames.addEmitter({
        anchor: spike, rate: 14, size: 0.15, spread: 0.05, rise: 0.7, life: 0.35,
        intensity: () => Math.max(0, this.pose.flame - 1.15), mood: () => this.pose.flameMood,
      });
    }
  }

  /** Alles, was zur Szene hinzugefügt werden muss. */
  get objects(): THREE.Object3D[] {
    return [this.rig.root, this.flames.points, this.icons.group];
  }

  get currentAnimation(): AnimationName {
    return this.action?.name ?? this.base.name;
  }

  get isTalking(): boolean {
    return this.talk > 0.5;
  }

  private start(name: AnimationName, intensity = 1): Running {
    return { name, def: ANIMATION_DEFS[name], time: 0, intensity, firedCues: 0, nextEvery: 0 };
  }

  /** Eine Animation abspielen. Wiederholte Auslöser derselben Animation werden kurz ignoriert. */
  play(name: AnimationName, intensity = 1): void {
    this.wake();
    if (name === 'idle') {
      this.action = undefined;
      return;
    }
    if (this.action?.name === name && this.action.time < 0.8) return;
    if (this.action?.name === 'fetch') this.rig.stick.visible = false;
    this.action = this.start(name, Math.min(1.5, Math.max(0.3, intensity)));
  }

  /** Klotzi denkt nach, solange eine Anfrage läuft. */
  setThinking(active: boolean): void {
    if (active && !this.thinkRun) this.thinkRun = this.start('think');
    if (!active) this.thinkRun = undefined;
    this.wake();
  }

  /** Mundbewegung, während die Sprechblase tippt. */
  setTalking(active: boolean): void {
    this.talk = active ? 1 : 0;
    if (active) this.wake();
  }

  /** Ohren spitzen, weil im Chat etwas passiert ist. */
  notice(): void {
    this.perk = 1;
    if (this.base.name === 'sleep' && Math.random() < 0.3) this.wake();
  }

  /** Mauszeiger in normalisierten Koordinaten (-1..1). */
  lookAt(x: number, y: number): void {
    this.look.set(x, y);
  }

  private wake(): void {
    this.idleTime = 0;
    if (this.base.name !== 'idle') this.base = this.start('idle');
  }

  update(dt: number): void {
    this.time += dt;
    this.idleTime += dt;
    if (this.idleTime > SLEEP_AFTER && this.base.name !== 'sleep' && !this.action) this.base = this.start('sleep');

    // ── Ziel-Pose bestimmen ──
    Object.assign(this.target, BASE_POSE);
    const baseRun = this.thinkRun ?? this.base;
    baseRun.time += dt;
    // Nicht-schleifende Animationen als Dauerzustand (Schlafen, Nachdenken): in der Mitte verharren
    Object.assign(this.target, baseRun.def.pose(baseRun.time, baseRun.def.loop ? 0 : 0.5, 1));
    this.runEffects(baseRun, true);

    if (this.action) {
      const a = this.action;
      a.time += dt;
      const p = a.time / a.def.duration;
      if (p >= 1) {
        this.action = undefined;
        this.rig.stick.visible = false;
      } else {
        Object.assign(this.target, a.def.pose(a.time, p, a.intensity));
        this.runEffects(a, false);
      }
    }

    // ── weich überblenden ──
    for (const key of Object.keys(this.target) as (keyof Pose)[]) {
      const k = STIFFNESS[key] ?? DEFAULT_STIFFNESS;
      this.pose[key] += (this.target[key] - this.pose[key]) * (1 - Math.exp(-k * dt));
    }

    this.perk = Math.max(0, this.perk - dt * 0.8);
    this.tailPhase += dt * this.pose.tailSpeed;
    this.gaitPhase += dt * this.pose.gaitSpeed;

    // Blinzeln
    this.blink.next -= dt;
    if (this.blink.next <= 0) {
      this.blink = { next: 2 + Math.random() * 4, t: 0 };
    }
    let blink = 1;
    if (this.blink.t >= 0) {
      this.blink.t += dt;
      blink = Math.abs(this.blink.t - 0.07) / 0.07;
      if (this.blink.t > 0.14) this.blink.t = -1;
    }

    this.applyPose(Math.min(1, blink));
    this.flames.update(dt);
    this.icons.update(dt);
  }

  private runEffects(run: Running, isBase: boolean): void {
    const { cues, every } = run.def;
    if (cues && !isBase) {
      while (run.firedCues < cues.length && cues[run.firedCues]![0] <= run.time) {
        cues[run.firedCues]![1](this.fx, run.intensity);
        run.firedCues++;
      }
    }
    if (every && (!isBase || run.def !== ANIMATION_DEFS.idle)) {
      if (run.time >= run.nextEvery) {
        run.nextEvery = run.time + every[0];
        every[1](this.fx, run.intensity);
      }
    }
  }

  private applyPose(blink: number): void {
    const { rig, pose } = this;
    const t = this.time;
    const attention = pose.attention;
    const talk = this.talk ? 0.12 + 0.4 * Math.abs(Math.sin(t * 15)) * (0.6 + 0.4 * Math.sin(t * 3.1)) : 0;
    const shake = (n: number) => (Math.random() - 0.5) * 2 * pose.shake * n;

    rig.root.position.set(pose.x + shake(1), 0, pose.z);
    rig.root.rotation.y = pose.turn;

    rig.body.position.set(shake(0.5), 0.83 - pose.crouch * 0.45 + Math.max(0, pose.lift), shake(0.5));
    rig.body.rotation.set(pose.pitch, pose.yaw, pose.roll);
    rig.body.scale.set(1 / Math.sqrt(pose.squash), pose.squash, 1 / Math.sqrt(pose.squash));

    rig.head.rotation.set(
      pose.headPitch - this.look.y * 0.25 * attention - this.perk * 0.08,
      pose.headYaw + this.look.x * 0.5 * attention,
      pose.headTilt,
    );
    rig.jaw.rotation.x = Math.min(1.1, pose.jaw + talk) * 0.55;

    rig.ears.forEach((ear, i) => {
      const side = i === 0 ? -1 : 1;
      const droop = pose.ears - this.perk * 0.35;
      ear.rotation.set(-pose.earsBack * 0.9 + droop * 0.25, 0, -side * (0.22 + droop * 1.15));
    });

    const lookX = pose.lookX + this.look.x * attention * 0.6;
    const lookY = pose.lookY + this.look.y * attention * 0.6;
    rig.eyes.forEach((eye) => eye.scale.set(1, Math.max(0.06, pose.eyes * blink), 1));
    rig.pupils.forEach((pupil) => {
      pupil.scale.set(0.85 * pose.pupils, 1.2 * pose.pupils, 0.45);
      pupil.position.set(lookX * 0.04, -0.01 + lookY * 0.04, 0.055);
    });

    // Schwanz: Welle läuft von der Wurzel zur Spitze
    rig.tail.forEach((seg, i) => {
      if (i === 0) seg.rotation.x = -0.75 + pose.tailLift * 0.7;
      else seg.rotation.x = -0.14 - Math.min(0, pose.tailLift) * 0.15;
      seg.rotation.z = Math.sin(this.tailPhase - i * 0.55) * pose.tailAmp * (0.3 + i * 0.07);
    });

    // Beine: Laufzyklus + statische Haltung (Liegen, Springen)
    const swing = Math.sin(this.gaitPhase) * 0.85 * pose.gait;
    rig.legs.fl.rotation.x = pose.legsFront + swing;
    rig.legs.fr.rotation.x = pose.legsFront - swing;
    rig.legs.bl.rotation.x = pose.legsBack - swing;
    rig.legs.br.rotation.x = pose.legsBack + swing;

    // Leuchten
    const flicker = 0.92 + 0.08 * Math.sin(t * 23) * Math.sin(t * 7.3);
    rig.glow.eyes.emissiveIntensity = (0.45 + 0.25 * Math.min(2, pose.flame)) * flicker;
    rig.glow.ember.emissiveIntensity = (0.8 + 0.5 * pose.flame) * flicker;
    rig.glow.ember.emissive.setHex(pose.flameMood > 0.5 ? 0xff2a10 : pose.flameMood < -0.5 ? 0xff5fae : 0xff7a1a);
    rig.glow.blush.opacity = 0.7 * Math.min(1, pose.blush);
  }

  private createFx(): Fx {
    const anchorPos = (where: 'head' | 'mouth' | 'body' | 'tail' | 'back') => {
      const { anchors } = this.rig;
      const obj = where === 'head' ? anchors.headTop : where === 'mouth' ? anchors.mouth : where === 'tail' ? anchors.tailTip : where === 'back' ? anchors.back[1]! : this.rig.body;
      const pos = obj.getWorldPosition(new THREE.Vector3());
      if (where === 'body') pos.y = 0.15;
      return pos;
    };
    return {
      icon: (kind, where = 'head', opts) => this.icons.spawn(kind, anchorPos(where), opts),
      fire: (where, count, opts = {}) => {
        const dir =
          where === 'mouth'
            ? new THREE.Vector3(0, 0.15, 1).applyQuaternion(this.rig.head.getWorldQuaternion(new THREE.Quaternion()))
            : new THREE.Vector3(0, 1, 0);
        this.flames.burst(anchorPos(where), dir, count, { speed: opts.speed ?? 2.4, mood: opts.mood ?? this.pose.flameMood });
      },
      sound: (name) => this.sounds?.play(name),
      stick: (visible) => {
        this.rig.stick.visible = visible;
      },
    };
  }

  /** Bildschirmposition über dem Kopf (für die Sprechblase). */
  bubbleAnchor(target: THREE.Vector3): THREE.Vector3 {
    return this.rig.anchors.bubble.getWorldPosition(target);
  }

  /** Bodenposition (für den Schatten). */
  groundPosition(): { x: number; z: number; height: number } {
    const p = this.rig.body.getWorldPosition(this.tmp);
    return { x: p.x, z: p.z, height: p.y };
  }
}
