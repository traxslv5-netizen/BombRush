import type Phaser from 'phaser';
import { network } from '../networking/NetworkSystem';
import { gameplayFocused, isEditable } from './Focus';
import { KeyboardState } from './KeyboardState';

export class InputSystem {
  private keyboard = new KeyboardState();
  private seq = 0;
  private lastSent = 0;
  private lastDirection = '';
  private padBomb = false;
  private padRemote = false;
  private blurred = false;
  disabled = false;
  direction = { dx: 0, dy: 0 };
  constructor(scene: Phaser.Scene) {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.blur);
    window.addEventListener('focus', this.focus);
    document.addEventListener('focusin', this.focusIn);
    document.addEventListener('visibilitychange', this.visibility);
    scene.events.once('shutdown', () => {
      this.reset();
      window.removeEventListener('keydown', this.down);
      window.removeEventListener('keyup', this.up);
      window.removeEventListener('blur', this.blur);
      window.removeEventListener('focus', this.focus);
      document.removeEventListener('focusin', this.focusIn);
      document.removeEventListener('visibilitychange', this.visibility);
    });
  }
  private active(): boolean {
    return (
      !this.disabled &&
      !this.blurred &&
      gameplayFocused() &&
      network.status === 'CONNECTED' &&
      network.state?.phase === 'PLAYING'
    );
  }
  private down = (event: KeyboardEvent) => {
    if (isEditable(event.target) || event.isComposing || !this.active()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      this.reset();
      return;
    }
    if (!this.keyboard.accepts(event.code)) return;
    event.preventDefault();
    this.keyboard.down(event.code);
    this.update(0);
  };
  private up = (event: KeyboardEvent) => {
    this.keyboard.up(event.code);
    if (this.active() && !isEditable(event.target)) this.update(0);
  };
  private blur = () => {
    this.blurred = true;
    this.reset();
  };
  private focus = () => {
    this.blurred = false;
  };
  private focusIn = (event: FocusEvent) => {
    if (isEditable(event.target)) this.reset();
  };
  private visibility = () => {
    if (document.hidden) this.blur();
    else this.focus();
  };
  reset(): void {
    const wasMoving = this.direction.dx || this.direction.dy;
    this.keyboard.clear();
    this.direction = { dx: 0, dy: 0 };
    this.lastDirection = '';
    if (wasMoving && network.state?.phase === 'PLAYING')
      this.transmit(false, false);
  }
  private transmit(bomb: boolean, remote: boolean): void {
    network.input({
      ...this.direction,
      bomb,
      remote,
      seq: ++this.seq,
      stageRevision: network.state?.stageRevision,
    });
    this.lastSent = performance.now();
    this.lastDirection = `${this.direction.dx},${this.direction.dy}`;
  }
  update(_dt: number): void {
    if (!this.active()) {
      this.reset();
      return;
    }
    const pad = navigator.getGamepads?.()[0];
    const pb = pad?.buttons[0]?.pressed ?? false;
    const pr = pad?.buttons[1]?.pressed ?? false;
    this.direction = this.keyboard.direction();
    if (!this.direction.dx && !this.direction.dy) {
      const ax = pad?.axes[0] ?? 0,
        ay = pad?.axes[1] ?? 0;
      if (Math.abs(ax) > 0.35) this.direction.dx = Math.sign(ax);
      else if (Math.abs(ay) > 0.35) this.direction.dy = Math.sign(ay);
    }
    const bomb = this.keyboard.bomb || (pb && !this.padBomb);
    const remote = this.keyboard.remote || (pr && !this.padRemote);
    this.keyboard.bomb = this.keyboard.remote = false;
    this.padBomb = pb;
    this.padRemote = pr;
    // Changes/releases are immediate; only held movement needs a heartbeat.
    if (
      bomb ||
      remote ||
      this.lastDirection !== `${this.direction.dx},${this.direction.dy}` ||
      ((this.direction.dx || this.direction.dy) &&
        performance.now() - this.lastSent >= 250)
    )
      this.transmit(bomb, remote);
  }
}
