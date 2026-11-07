/**
 * Sprechblase über Klotzis Kopf mit Schreibmaschinen-Effekt.
 */
export class SpeechBubble {
  private readonly text: HTMLElement;
  private queue: string[] = [];
  private current = '';
  private shown = 0;
  private hold = 0;
  private active = false;

  constructor(private readonly el: HTMLElement) {
    this.text = el.querySelector('.bubble-text')!;
  }

  /** true, solange Klotzi "spricht" (Text wird getippt) */
  get talking(): boolean {
    return this.active && this.shown < this.current.length;
  }

  say(text: string): void {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    this.queue.push(clean.length > 240 ? `${clean.slice(0, 237)}…` : clean);
    if (!this.active) this.next();
  }

  private next(): void {
    const text = this.queue.shift();
    if (!text) {
      this.active = false;
      this.el.classList.add('hidden');
      return;
    }
    this.active = true;
    this.current = text;
    this.shown = 0;
    this.hold = Math.min(9, 2.5 + text.length * 0.045);
    this.text.textContent = '';
    this.el.classList.remove('hidden');
  }

  update(dt: number, screen: { x: number; y: number }): void {
    if (!this.active) return;
    if (this.shown < this.current.length) {
      this.shown = Math.min(this.current.length, this.shown + dt * 38);
      this.text.textContent = this.current.slice(0, Math.ceil(this.shown));
    } else {
      this.hold -= dt;
      if (this.hold <= 0) this.next();
    }
    // über dem Kopf platzieren, aber im Fenster halten
    const rect = this.el.getBoundingClientRect();
    const margin = 8;
    const x = Math.min(window.innerWidth - rect.width / 2 - margin, Math.max(rect.width / 2 + margin, screen.x));
    const y = Math.max(rect.height + margin, screen.y);
    this.el.style.transform = `translate(${x - rect.width / 2}px, ${y - rect.height}px)`;
  }
}
