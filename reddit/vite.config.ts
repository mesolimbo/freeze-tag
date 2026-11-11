import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {devvit} from '@devvit/start/vite';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), devvit()],
  // The game source lives in ../game, so force one copy of each shared library.
  resolve: {dedupe: ['react', 'react-dom', 'three', '@react-three/fiber']},
});
