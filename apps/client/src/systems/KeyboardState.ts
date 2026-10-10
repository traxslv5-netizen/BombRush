const directions: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
export class KeyboardState {
  private held = new Set<string>();
  bomb = false;
  remote = false;
  accepts(code: string): boolean {
    return code in directions || code === 'Space' || code === 'KeyE';
  }
  down(code: string): void {
    if (this.held.has(code)) return;
    this.held.add(code);
    if (code === 'Space') this.bomb = true;
    if (code === 'KeyE') this.remote = true;
  }
  up(code: string): void {
    this.held.delete(code);
  }
  clear(): void {
    this.held.clear();
    this.bomb = false;
    this.remote = false;
  }
  direction(): { dx: number; dy: number } {
    // Most recently pressed physical direction wins; releasing it restores the held key.
    for (const code of [...this.held].reverse()) {
      if (directions[code])
        return { dx: directions[code][0], dy: directions[code][1] };
    }
    return { dx: 0, dy: 0 };
  }
}
