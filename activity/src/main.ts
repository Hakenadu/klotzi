import './style.css';
import { ANIMATION_NAMES, type AnimationName, type StageEvent } from '@klotzi/shared';
import * as THREE from 'three';
import { Sounds } from './audio.ts';
import { createSession, StageConnection, type ConnectionState } from './connection.ts';
import { Klotzi } from './klotzi/klotzi.ts';
import { Stage3D } from './scene.ts';
import { SpeechBubble } from './ui/speech.ts';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const sounds = new Sounds();
const klotzi = new Klotzi(sounds);
const transparent = params.get('transparent') === '1';
if (transparent) document.documentElement.classList.add('transparent');
if (params.get('hud') === '0') document.body.classList.add('no-hud');

let stage = new Stage3D($<HTMLCanvasElement>('stage'), klotzi, {
  transparent,
  lowQuality: params.get('quality') === 'low',
});
const bubble = new SpeechBubble($('bubble'));
let connection: StageConnection | undefined;

// ── Statusanzeige & Ton ───────────────────────────────────────
function setStatus(state: ConnectionState | 'demo', detail?: string) {
  const el = $('status');
  el.dataset.state = state;
  const labels: Record<string, string> = {
    connecting: 'verbinde…',
    online: 'live',
    offline: 'Verbindung verloren – versuche erneut…',
    denied: detail ?? 'kein Zugriff',
    demo: 'Demo-Modus',
  };
  el.querySelector('b')!.textContent = labels[state] ?? state;
}

function toast(text: string, ms = 4000) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), ms);
}

$('sound').addEventListener('click', async (e) => {
  e.stopPropagation();
  const on = await sounds.toggle();
  $('sound').textContent = on ? '🔊' : '🔇';
});

// ── Ereignisse von der Bühne ──────────────────────────────────
function handle(event: StageEvent) {
  switch (event.type) {
    case 'animate':
      klotzi.play(event.animation, event.intensity);
      break;
    case 'say':
      bubble.say(event.text);
      break;
    case 'thinking':
      klotzi.setThinking(event.active);
      break;
    case 'notice':
      klotzi.notice();
      break;
    case 'error':
      toast(event.message, 8000);
      break;
  }
}

// ── Interaktion: Maus folgen, Streicheln per Klick ────────────
const ndc = (e: PointerEvent) => ({ x: (e.clientX / innerWidth) * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 });
window.addEventListener('pointermove', (e) => {
  const p = ndc(e);
  klotzi.lookAt(p.x, p.y - 0.2);
});
window.addEventListener('pointerleave', () => klotzi.lookAt(0, 0));
window.addEventListener('pointerdown', (e) => {
  const p = ndc(e);
  if (!stage.hitsKlotzi(p.x, p.y)) return;
  klotzi.play('love');
  connection?.send({ type: 'pet' });
});

// Tastenkürzel zum Ausprobieren: 1–9, 0, q, w, e, r
const keys = '1234567890qwer';
window.addEventListener('keydown', (e) => {
  const index = keys.indexOf(e.key);
  if (index >= 0 && ANIMATION_NAMES[index]) klotzi.play(ANIMATION_NAMES[index]);
  if (e.key === 't') klotzi.setThinking(!(klotzi.currentAnimation === 'think'));
  if (e.key === 's') bubble.say('Wuff! Ich bin Klotzi, der flauschigste Höllenhund der ganzen Unterwelt! 🔥');
});

// ── Demo-Modus: Klotzi zeigt, was er kann ─────────────────────
const DEMO_LINES = [
  'Wuff! Ich bin Klotzi! 🔥',
  'Hat hier jemand Leckerli gesagt?',
  'Ich bin ein gefürchteter Wächter der Unterwelt. Grrr… *wedelt*',
  'Wirf das Stöckchen! Bitte bitte bitte!',
  'Lava-Bad gefällig? Nein? Schade. 🐾',
];
function startDemo() {
  setStatus('demo');
  if (params.get('demo') === '0') return;
  const showcase: AnimationName[] = ['happy', 'bark', 'think', 'love', 'fetch', 'dance', 'confused', 'eat', 'excited', 'sad', 'angry', 'scared'];
  let i = 0;
  setInterval(() => {
    const anim = showcase[i++ % showcase.length]!;
    klotzi.play(anim);
    if (i % 2 === 1) bubble.say(DEMO_LINES[(i >> 1) % DEMO_LINES.length]!);
  }, 6000);
  setTimeout(() => bubble.say(DEMO_LINES[0]!), 800);
}

// Debug-Zugriff für Tests / Konsole: ?debug=1
if (params.get('debug') === '1') Object.assign(window, { klotzi, stage: () => stage, bubble });

// ── Render-Schleife ───────────────────────────────────────────
const timer = new THREE.Timer();
const head = new THREE.Vector3();
function frame(time: number) {
  timer.update(time);
  const dt = Math.min(0.05, timer.getDelta());
  klotzi.setTalking(bubble.talking);
  klotzi.update(dt);
  stage.render(dt);
  bubble.update(dt, stage.toScreen(klotzi.bubbleAnchor(head)));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Start ─────────────────────────────────────────────────────
async function boot() {
  setStatus('connecting');
  try {
    const session = await createSession();
    if (session.mode === 'demo' || !session.subscription) {
      startDemo();
      return;
    }
    if (session.platform === 'mobile' && params.get('quality') !== 'high') {
      // auf Handys Bloom & hohe Auflösung sparen
      stage.renderer.dispose();
      const old = $<HTMLCanvasElement>('stage');
      const fresh = old.cloneNode() as HTMLCanvasElement;
      old.replaceWith(fresh);
      stage = new Stage3D(fresh, klotzi, { transparent, lowQuality: true });
    }
    connection = new StageConnection(session.subscription, handle, setStatus);
    if (session.userName) setTimeout(() => bubble.say(`Wuff! Hallo ${session.userName}! 🔥`), 1200);
    klotzi.play('excited');
  } catch (err) {
    console.error(err);
    setStatus('denied', 'Anmeldung fehlgeschlagen');
    toast(err instanceof Error ? err.message : String(err), 10000);
    klotzi.play('confused');
  }
}
void boot();
