import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: false,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api69': {
        target: 'https://10.2.1.69',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api69/, '/api'),
      },
      '/api100': {
        target: 'https://10.2.1.100',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api100/, '/api'),
      },
    },

  },
})
