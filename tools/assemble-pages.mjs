import { cp, copyFile, mkdir, writeFile } from 'node:fs/promises';

// Both branch Pages and Actions must expose the same /BombRush/docs/ URLs.
// Preserve existing hashed bundles so cached documents survive deployment.
await mkdir('dist/pages', { recursive: true });
await cp('docs', 'dist/pages/docs', { recursive: true });
await cp('dist/client', 'dist/pages/docs', { recursive: true });
await copyFile('dist/client/index.html', 'dist/pages/index.html');
await writeFile('dist/pages/.nojekyll', '');
