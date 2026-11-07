import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANIMATION_NAMES } from '@klotzi/shared';
import { pickVoiceChannel } from '../src/skills/voice.ts';
import { ANIMATION_SOUNDS, renderAnimation, SAMPLE_RATE, toPcmStereo } from '../src/skills/_sounds.ts';

test('Klotzi geht dorthin, wo die meisten Leute sind', () => {
  const channels = [
    { id: 'a', humans: 1 },
    { id: 'b', humans: 3 },
    { id: 'c', humans: 0 },
  ];
  assert.equal(pickVoiceChannel(channels, null), 'b');
});

test('Klotzi bleibt in seinem Channel, solange dort noch jemand ist', () => {
  const channels = [
    { id: 'a', humans: 1 },
    { id: 'b', humans: 5 },
  ];
  assert.equal(pickVoiceChannel(channels, 'a'), 'a');
});

test('Klotzi folgt den Leuten, wenn sein Channel leer wird', () => {
  const channels = [
    { id: 'a', humans: 0 },
    { id: 'b', humans: 2 },
  ];
  assert.equal(pickVoiceChannel(channels, 'a'), 'b');
});

test('Klotzi verlässt den Sprach-Chat, wenn niemand mehr da ist', () => {
  assert.equal(pickVoiceChannel([{ id: 'a', humans: 0 }], 'a'), null);
  assert.equal(pickVoiceChannel([], null), null);
});

test('jede Animation mit Geräusch erzeugt hörbares, unverzerrtes Audio', () => {
  for (const animation of ANIMATION_NAMES) {
    const track = renderAnimation(animation);
    if (!ANIMATION_SOUNDS[animation]) {
      assert.equal(track, undefined, `${animation} sollte stumm sein`);
      continue;
    }
    assert.ok(track, `${animation} hat kein Geräusch`);
    const lastCue = Math.max(...ANIMATION_SOUNDS[animation]!.map(([at]) => at));
    assert.ok(track.length >= lastCue * SAMPLE_RATE, `${animation} ist zu kurz`);
    let peak = 0;
    for (const s of track) {
      assert.ok(Number.isFinite(s), `${animation} enthält ungültige Samples`);
      peak = Math.max(peak, Math.abs(s));
    }
    assert.ok(peak > 0.01, `${animation} ist praktisch stumm (Spitze ${peak})`);
    assert.ok(peak <= 1, `${animation} übersteuert`);
  }
});

test('PCM ist 16 bit Stereo im Format von @discordjs/voice', () => {
  const pcm = toPcmStereo(new Float32Array([0, 1, -1]));
  assert.equal(pcm.length, 3 * 4);
  assert.equal(pcm.readInt16LE(4), 32767);
  assert.equal(pcm.readInt16LE(6), 32767);
  assert.equal(pcm.readInt16LE(8), -32767);
});
