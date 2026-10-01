import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { logbookFiles } from './vite-plugin-logbook.ts';

export default defineConfig({
  // Relative base so the same build works on GitHub Pages (/repo-name/), Vercel (/) or a USB stick.
  base: './',
  plugins: [react(), logbookFiles({ dataDir: 'data', publishData: process.env.LOGBOOK_PUBLISH_DATA !== 'false' })],
  server: {
    // The app writes data/ itself; don't let the file watcher reload the page when it does.
    watch: { ignored: ['**/data/**'] },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
