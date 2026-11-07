import { EventEmitter } from 'node:events';
import type { AnimationName, StageEvent } from '@klotzi/shared';

export interface StageViewer {
  send(event: StageEvent): void;
}

interface StageEvents {
  /** Jemand hat Klotzi in der Activity gestreichelt. */
  pet: [guildId: string, userId: string | null];
  /** Ein Zuschauer hat die Bühne betreten. */
  join: [guildId: string, userId: string | null];
  /** Klotzi spielt eine Animation (z. B. damit der Voice-Skill das passende Geräusch abspielt). */
  animate: [guildId: string, animation: AnimationName, intensity: number | undefined];
}

/**
 * Die Bühne verteilt Klotzis Auftritte an alle Activities (und Overlays),
 * die gerade in einer Guild zuschauen.
 */
export class Stage extends EventEmitter<StageEvents> {
  private readonly viewers = new Map<string, Set<StageViewer>>();

  add(guildId: string, viewer: StageViewer): () => void {
    let set = this.viewers.get(guildId);
    if (!set) this.viewers.set(guildId, (set = new Set()));
    set.add(viewer);
    return () => {
      set.delete(viewer);
      if (set.size === 0) this.viewers.delete(guildId);
    };
  }

  /** Anzahl der Zuschauer in einer Guild. */
  audience(guildId: string): number {
    return this.viewers.get(guildId)?.size ?? 0;
  }

  /** Ein Event an alle Zuschauer einer Guild schicken. */
  broadcast(guildId: string | null | undefined, event: StageEvent): void {
    if (!guildId) return;
    for (const viewer of this.viewers.get(guildId) ?? []) {
      try {
        viewer.send(event);
      } catch {
        // kaputte Verbindung – wird vom Server aufgeräumt
      }
    }
  }

  animate(guildId: string | null | undefined, animation: AnimationName, intensity?: number): void {
    this.broadcast(guildId, { type: 'animate', animation, intensity });
    if (guildId) this.emit('animate', guildId, animation, intensity);
  }

  say(guildId: string | null | undefined, text: string, replyTo?: string): void {
    this.broadcast(guildId, { type: 'say', text, replyTo });
  }

  thinking(guildId: string | null | undefined, active: boolean): void {
    this.broadcast(guildId, { type: 'thinking', active });
  }
}
