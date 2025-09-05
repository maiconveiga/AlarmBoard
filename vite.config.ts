import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// AVISO: 'secure: false' ignora certificado inválido APENAS no ambiente de DEV.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/v3': {
        target: 'https://10.2.1.100', // sua API
        changeOrigin: true,
        secure: false, // permitir self-signed em DEV
      },
    },
  },
});
