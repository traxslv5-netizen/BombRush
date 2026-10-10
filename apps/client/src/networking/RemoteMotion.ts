import type { Actor, Player, Snapshot } from '../../../../shared/src/types';

type Sample = Actor & { time: number };
type Track = {
  samples: Sample[];
  view: Actor;
  lives: number;
  connected: boolean;
};

/** Render-only history. Never writes an interpolated position into game state. */
export class RemoteMotion {
  private tracks = new Map<string, Track>();
  private room = '';
  private revision = -1;
  private latest = -1;
  private receivedAt = 0;
  private cursor = 0;
  private frameAt = 0;
  private jitter = 0;
  delayMs = 100;

  reset(): void {
    this.tracks.clear();
    this.room = '';
    this.revision = -1;
    this.latest = -1;
    this.frameAt = 0;
    this.jitter = 0;
  }

  push(s: Snapshot, now: number, authority = false): void {
    if (
      s.code !== this.room ||
      s.stageRevision !== this.revision ||
      now - this.receivedAt > 1000
    )
      this.reset();
    if (s.time < this.latest) return;
    this.room = s.code;
    this.revision = s.stageRevision;
    const fresh = this.latest < 0;
    if (!fresh && s.time > this.latest) {
      const deviation = Math.abs(
        now - this.receivedAt - (s.time - this.latest) * 1000,
      );
      this.jitter += (Math.min(80, deviation) - this.jitter) * 0.08;
    }
    // 30 Hz authority; transport is 15/10/7.5 Hz for 2/3/4 participants.
    // One packet interval plus jitter margin, capped to avoid hiding real lag.
    const interval = authority
      ? 1000 / 30
      : (Math.max(2, s.players.length) * 1000) / 30;
    this.delayMs = Math.min(
      180,
      Math.max(100, interval + 20 + this.jitter * 2),
    );
    if (s.time > this.latest || fresh) {
      this.latest = s.time;
      this.receivedAt = now;
    }
    if (fresh) {
      this.cursor = s.time - this.delayMs / 1000;
      this.frameAt = now;
    }
    for (const p of s.players)
      this.pushPlayer(p, s.time, s.phase !== 'PLAYING');
    for (const id of this.tracks.keys())
      if (!s.players.some((p) => p.id === id)) this.tracks.delete(id);
  }

  private pushPlayer(p: Player, time: number, reset: boolean): void {
    let track = this.tracks.get(p.id);
    const last = track?.samples.at(-1);
    const sample: Sample = {
      id: p.id,
      x: p.x,
      y: p.y,
      direction: p.direction,
      action: p.action,
      actionUntil: p.actionUntil,
      alive: p.alive,
      time,
    };
    if (
      !track ||
      !last ||
      reset ||
      last.alive !== p.alive ||
      track.lives !== p.lives ||
      track.connected !== p.connected ||
      Math.hypot(last.x - p.x, last.y - p.y) > 3
    ) {
      track = {
        samples: [sample],
        view: { ...sample },
        lives: p.lives,
        connected: p.connected,
      };
      this.tracks.set(p.id, track);
      return;
    }
    if (last.time === time) track.samples[track.samples.length - 1] = sample;
    else track.samples.push(sample);
    if (track.samples.length > 32) track.samples.shift();
  }

  beginFrame(now: number): void {
    if (this.latest < 0) return;
    const gap = now - this.frameAt;
    const dt = Math.min(0.25, Math.max(0, gap / 1000));
    this.frameAt = now;
    const desired = this.latest + (now - this.receivedAt - this.delayMs) / 1000;
    if (gap > 250) {
      this.cursor = Math.min(this.latest, desired);
      return;
    }
    // Slew the presentation clock instead of passing arrival jitter into x/y.
    const rate = Math.max(
      0.95,
      Math.min(1.05, 1 + (desired - this.cursor) * 2),
    );
    this.cursor += dt * rate;
    // No extrapolation through walls, bombs or a lost connection.
    this.cursor = Math.min(this.cursor, this.latest);
  }

  sample(id: string): Actor | undefined {
    const track = this.tracks.get(id);
    if (!track) return;
    const history = track.samples;
    while (history.length > 2 && history[1].time <= this.cursor)
      history.shift();
    const a = history[0],
      b = history[1] ?? a;
    const t =
      b.time === a.time
        ? 0
        : Math.max(0, Math.min(1, (this.cursor - a.time) / (b.time - a.time)));
    Object.assign(track.view, t >= 1 ? b : a);
    track.view.x = a.x + (b.x - a.x) * t;
    track.view.y = a.y + (b.y - a.y) * t;
    return track.view;
  }
}
