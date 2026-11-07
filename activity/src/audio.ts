/**
 * Klotzis Geräusche – komplett mit der Web-Audio-API synthetisiert,
 * damit keine Audiodateien nötig sind. Standardmäßig stumm, bis jemand den
 * Lautsprecher-Knopf drückt (Browser erlauben Audio erst nach einer Interaktion).
 */
export type SoundName = 'bark' | 'yip' | 'whine' | 'growl' | 'chomp' | 'happy' | 'yelp';

export class Sounds {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  enabled = false;

  async toggle(): Promise<boolean> {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.ctx ??= new AudioContext();
      if (!this.master) {
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      }
      await this.ctx.resume();
      this.play('yip');
    }
    return this.enabled;
  }

  play(name: SoundName): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    switch (name) {
      case 'bark':
        this.voice(now, { from: 620, to: 260, dur: 0.16, type: 'sawtooth', filter: 1100, q: 4, gain: 0.9 });
        this.noise(now, 0.08, 1800, 0.35);
        break;
      case 'yip':
        this.voice(now, { from: 900, to: 1300, dur: 0.09, type: 'triangle', filter: 2200, q: 2, gain: 0.6 });
        this.voice(now + 0.11, { from: 1000, to: 1500, dur: 0.08, type: 'triangle', filter: 2400, q: 2, gain: 0.5 });
        break;
      case 'yelp':
        this.voice(now, { from: 1400, to: 700, dur: 0.22, type: 'sawtooth', filter: 2000, q: 3, gain: 0.6 });
        break;
      case 'whine':
        this.voice(now, { from: 1100, to: 750, dur: 0.6, type: 'sine', filter: 3000, q: 1, gain: 0.45, vibrato: 9 });
        break;
      case 'growl':
        this.voice(now, { from: 95, to: 80, dur: 0.9, type: 'sawtooth', filter: 420, q: 6, gain: 0.9, tremolo: 28 });
        break;
      case 'chomp':
        for (let i = 0; i < 3; i++) this.noise(now + i * 0.13, 0.05, 900, 0.5);
        break;
      case 'happy':
        [0, 0.09, 0.18].forEach((d, i) =>
          this.voice(now + d, { from: 700 + i * 180, to: 900 + i * 180, dur: 0.08, type: 'triangle', filter: 2500, q: 1, gain: 0.4 }),
        );
        break;
    }
  }

  private voice(
    at: number,
    o: { from: number; to: number; dur: number; type: OscillatorType; filter: number; q: number; gain: number; vibrato?: number; tremolo?: number },
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.from, at);
    osc.frequency.exponentialRampToValueAtTime(o.to, at + o.dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = o.filter;
    filter.Q.value = o.q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(o.gain, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
    osc.connect(filter).connect(gain).connect(this.master!);

    for (const [rate, depth, param] of [
      [o.vibrato, 25, osc.frequency],
      [o.tremolo, o.gain * 0.6, gain.gain],
    ] as const) {
      if (!rate) continue;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = rate;
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain).connect(param);
      lfo.start(at);
      lfo.stop(at + o.dur);
    }
    osc.start(at);
    osc.stop(at + o.dur + 0.02);
  }

  private noise(at: number, dur: number, freq: number, level: number): void {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = level;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(at);
  }
}
