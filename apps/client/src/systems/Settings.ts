export interface Settings {
  master: number;
  music: number;
  sfx: number;
}
let stored: Partial<Settings> = {};
try {
  stored = JSON.parse(localStorage.getItem('bombrush-settings') || '{}');
} catch {
  /* Ignore invalid local preferences. */
}
export const settings: Settings = {
  master: stored.master ?? 0.7,
  music: stored.music ?? 0.28,
  sfx: stored.sfx ?? 0.8,
};
export function setVolume(key: keyof Settings, value: number): void {
  settings[key] = Math.min(1, Math.max(0, value));
  localStorage.setItem('bombrush-settings', JSON.stringify(settings));
}
