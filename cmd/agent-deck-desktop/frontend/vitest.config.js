import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react({ fastRefresh: false })],
    test: {
        globals: true,
        environment: 'jsdom',
        include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
        setupFiles: ['./src/__tests__/setup.js'],
    },
});
