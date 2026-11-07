import type { AnimationName } from '@klotzi/shared';

/**
 * Klotzis Geräusche für den Sprach-Channel – dieselben Klänge wie in der
 * Activity (activity/src/audio.ts), hier aber offline als PCM berechnet,
 * damit der Bot sie per @discordjs/voice abspielen kann. Keine Audiodateien,
 * kein FFmpeg.
 *
 * (Der Unterstrich im Dateinamen sorgt dafür, dass der Skill-Lader die Datei überspringt.)
 */
export type SoundName = 'bark' | 'yip' | 'whine' | 'growl' | 'chomp' | 'happy' | 'yelp';

/** Abtastrate, die Discord erwartet. */
export const SAMPLE_RATE = 48_000;

/**
 * Wann in einer Animation welches Geräusch kommt (Sekunden ab Start) –
 * gespiegelt von den `cues` in activity/src/klotzi/animations.ts.
 */
export const ANIMATION_SOUNDS: Partial<Record<AnimationName, Array<[number, SoundName]>>> = {
  happy: [[0.1, 'yip']],
  excited: [
    [0.2, 'yip'],
    [1.6, 'yip'],
  ],
  bark: [
    [0.3, 'bark'],
    [0.9, 'bark'],
  ],
  sad: [[0.4, 'whine']],
  angry: [[0.1, 'growl']],
  eat: [
    [0.5, 'chomp'],
    [1.2, 'chomp'],
    [2.6, 'yip'],
  ],
  love: [[0.1, 'happy']],
  fetch: [
    [0.2, 'yip'],
    [4.2, 'yip'],
  ],
  dance: [[0.1, 'happy']],
  confused: [[0.15, 'whine']],
  scared: [[0.02, 'yelp']],
};

type Wave = 'sine' | 'triangle' | 'sawtooth';
interface VoiceOptions {
  from: number;
  to: number;
  dur: number;
  type: Wave;
  filter: number;
  q: number;
  gain: number;
  vibrato?: number;
  tremolo?: number;
}

/** Eine Mono-Spur, in die Klänge hineingemischt werden. */
class Track {
  readonly data: Float32Array;
  constructor(seconds: number) {
    this.data = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  }

  /** Gleitender Ton mit Hüllkurve, Bandpass und optional Vibrato/Tremolo – wie `Sounds.voice` in der Activity. */
  voice(at: number, o: VoiceOptions): void {
    const start = Math.round(at * SAMPLE_RATE);
    const length = Math.ceil((o.dur + 0.02) * SAMPLE_RATE);
    const filter = bandpass(o.filter, o.q);
    const attack = 0.015;
    let phase = 0;
    for (let n = 0; n < length && start + n < this.data.length; n++) {
      const t = n / SAMPLE_RATE;
      const ramp = Math.min(t, o.dur) / o.dur;
      let freq = o.from * (o.to / o.from) ** ramp;
      if (o.vibrato) freq += 25 * Math.sin(2 * Math.PI * o.vibrato * t);
      phase = (phase + freq / SAMPLE_RATE) % 1;

      let env =
        t < attack
          ? 0.0001 * (o.gain / 0.0001) ** (t / attack)
          : o.gain * (0.0001 / o.gain) ** (Math.min(t - attack, o.dur - attack) / (o.dur - attack));
      if (o.tremolo) env += o.gain * 0.6 * Math.sin(2 * Math.PI * o.tremolo * t);

      this.data[start + n]! += filter(wave(o.type, phase)) * env;
    }
  }

  /** Gefiltertes, abklingendes Rauschen – wie `Sounds.noise` in der Activity. */
  noise(at: number, dur: number, freq: number, level: number): void {
    const start = Math.round(at * SAMPLE_RATE);
    const length = Math.ceil(dur * SAMPLE_RATE);
    const filter = bandpass(freq, 1);
    for (let n = 0; n < length && start + n < this.data.length; n++) {
      this.data[start + n]! += filter((Math.random() * 2 - 1) * (1 - n / length)) * level;
    }
  }

  sound(name: SoundName, at: number): void {
    switch (name) {
      case 'bark':
        this.voice(at, { from: 620, to: 260, dur: 0.16, type: 'sawtooth', filter: 1100, q: 4, gain: 0.9 });
        this.noise(at, 0.08, 1800, 0.35);
        break;
      case 'yip':
        this.voice(at, { from: 900, to: 1300, dur: 0.09, type: 'triangle', filter: 2200, q: 2, gain: 0.6 });
        this.voice(at + 0.11, { from: 1000, to: 1500, dur: 0.08, type: 'triangle', filter: 2400, q: 2, gain: 0.5 });
        break;
      case 'yelp':
        this.voice(at, { from: 1400, to: 700, dur: 0.22, type: 'sawtooth', filter: 2000, q: 3, gain: 0.6 });
        break;
      case 'whine':
        this.voice(at, { from: 1100, to: 750, dur: 0.6, type: 'sine', filter: 3000, q: 1, gain: 0.45, vibrato: 9 });
        break;
      case 'growl':
        this.voice(at, { from: 95, to: 80, dur: 0.9, type: 'sawtooth', filter: 420, q: 6, gain: 0.9, tremolo: 28 });
        break;
      case 'chomp':
        for (let i = 0; i < 3; i++) this.noise(at + i * 0.13, 0.05, 900, 0.5);
        break;
      case 'happy':
        [0, 0.09, 0.18].forEach((d, i) =>
          this.voice(at + d, { from: 700 + i * 180, to: 900 + i * 180, dur: 0.08, type: 'triangle', filter: 2500, q: 1, gain: 0.4 }),
        );
        break;
    }
  }
}

function wave(type: Wave, phase: number): number {
  switch (type) {
    case 'sine':
      return Math.sin(2 * Math.PI * phase);
    case 'triangle':
      return 1 - 4 * Math.abs(((phase + 0.25) % 1) - 0.5);
    case 'sawtooth':
      return 2 * phase - 1;
  }
}

/** Biquad-Bandpass (RBJ-Kochbuch, 0 dB Spitze) – entspricht dem "bandpass" der Web-Audio-API. */
function bandpass(freq: number, q: number): (x: number) => number {
  const w0 = (2 * Math.PI * freq) / SAMPLE_RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/** Längstes Einzelgeräusch (Knurren) plus etwas Luft. */
const TAIL_SECONDS = 1;

/** Berechnet die Geräusche einer Animation als Mono-Spur (−1…1) – oder `undefined`, wenn sie stumm ist. */
export function renderAnimation(animation: AnimationName, volume = 0.35): Float32Array | undefined {
  const cues = ANIMATION_SOUNDS[animation];
  if (!cues?.length) return undefined;
  const track = new Track(Math.max(...cues.map(([at]) => at)) + TAIL_SECONDS);
  for (const [at, sound] of cues) track.sound(sound, at);
  for (let i = 0; i < track.data.length; i++) {
    track.data[i] = Math.max(-1, Math.min(1, track.data[i]! * volume));
  }
  return track.data;
}

/** Wandelt eine Mono-Spur in das Rohformat von @discordjs/voice: 48 kHz, Stereo, signed 16 bit little endian. */
export function toPcmStereo(mono: Float32Array): Buffer {
  const pcm = Buffer.alloc(mono.length * 4);
  for (let i = 0; i < mono.length; i++) {
    const sample = Math.round(mono[i]! * 32767);
    pcm.writeInt16LE(sample, i * 4);
    pcm.writeInt16LE(sample, i * 4 + 2);
  }
  return pcm;
}
