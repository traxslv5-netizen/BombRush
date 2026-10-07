const paths: Record<string, string> = {
  play: 'M8 4 21 12 8 20Z',
  back: 'm14 5-7 7 7 7M7 12h15',
  arrow: 'm13 5 7 7-7 7M3 12h17',
  check: 'm4 12 5 5L21 5',
  close: 'm6 6 12 12M6 18 18 6',
  pause: 'M8 5v14M16 5v14',
  sound: 'M4 9h4l6-5v16l-6-5H4ZM18 8q6 4 0 8',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  crown: 'm3 7 4 4 5-7 5 7 4-4-2 12H5Z',
  copy: 'M8 8h13v13H8ZM3 16V3h13',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 3v6l4 3',
  life: 'M12 20 3 11C-2 3 8 0 12 7c4-7 14-4 9 4Z',
  key: 'M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10m3 9 9 9m-5-5 3-3m0 6 3-3',
  totem: 'M7 4h10v16H7ZM4 8h16M4 16h16M12 7v10',
  core: 'm12 2 9 5v10l-9 5-9-5V7Zm0 5 4 5-4 5-4-5Z',
  crystal: 'm12 2 8 7-8 13L4 9Zm-8 7h16M12 2v20',
  enemy: 'M5 9a7 7 0 0 1 14 0v11l-4-3-3 3-3-3-4 3ZM8 10v3m8-3v3',
  lock: 'M6 11h12v10H6ZM8 11V7a4 4 0 0 1 8 0v4',
  network: 'M3 9q9-9 18 0M6 13q6-6 12 0m-8 4q2-2 4 0',
  fullscreen: 'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6',
};
export function svg(name: string, cls = ''): string {
  return `<svg class="ui-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.play}"/></svg>`;
}
