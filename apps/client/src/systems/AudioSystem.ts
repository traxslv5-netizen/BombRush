// Original synthesized WebAudio cues, no external audio assets required.
import { settings } from './Settings';
export class AudioSystem {
  private context: AudioContext | null = null;
  muted = false;
  private musicTimer: ReturnType<typeof setInterval> | undefined;
  private beat = 0;
  unlock(): void {
    this.context ??= new AudioContext();
    void this.context.resume();
    if (!this.musicTimer)
      this.musicTimer = setInterval(() => this.music(), 350);
  }
  private music(): void {
    if (
      this.muted ||
      !this.context ||
      this.context.state !== 'running' ||
      document.hidden ||
      settings.music === 0
    )
      return;
    const ctx = this.context,
      o = ctx.createOscillator(),
      g = ctx.createGain(),
      notes = [130.81, 196, 261.63, 196, 146.83, 220, 293.66, 220];
    o.type = 'sine';
    o.frequency.value = notes[this.beat++ % notes.length];
    g.gain.setValueAtTime(
      0.018 * settings.master * settings.music,
      ctx.currentTime,
    );
    g.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.32);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.33);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  play(kind: string): void {
    if (
      this.muted ||
      !this.context ||
      this.context.state !== 'running' ||
      settings.master === 0 ||
      settings.sfx === 0
    )
      return;
    const cues: Record<string, [number, number, OscillatorType]> = {
      bomb_place: [180, 0.08, 'sine'],
      bomb_tick: [600, 0.03, 'sine'],
      explosion: [65, 0.23, 'sawtooth'],
      pickup: [880, 0.12, 'sine'],
      block_break: [110, 0.1, 'triangle'],
      player_hit: [240, 0.1, 'square'],
      player_death: [160, 0.3, 'triangle'],
      enemy_hit: [190, 0.1, 'triangle'],
      enemy_death: [220, 0.12, 'triangle'],
      boss_hit: [90, 0.17, 'sawtooth'],
      boss_death: [45, 0.6, 'sawtooth'],
      stage_clear: [1047, 0.5, 'sine'],
      shield_break: [1300, 0.2, 'sine'],
      objective_pickup: [1100, 0.25, 'sine'],
      objective_reveal: [520, 0.15, 'sine'],
      exit_reveal: [740, 0.4, 'sine'],
      core_hit: [100, 0.14, 'triangle'],
      core_break: [75, 0.3, 'sawtooth'],
      vent: [85, 0.2, 'triangle'],
      ui_click: [400, 0.05, 'sine'],
      stage_start: [330, 0.3, 'sine'],
    };
    const cue = cues[kind];
    if (!cue) return;
    const [frequency, duration, type] = cue,
      ctx = this.context,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(frequency, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(
      Math.max(30, frequency * (kind === 'pickup' ? 1.7 : 0.45)),
      ctx.currentTime + duration,
    );
    g.gain.setValueAtTime(
      Math.max(0.00001, 0.075 * settings.master * settings.sfx),
      ctx.currentTime,
    );
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + duration);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
}
export const audio = new AudioSystem();
