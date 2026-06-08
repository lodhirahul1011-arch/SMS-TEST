import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    proxy: {
      '/api/sms-provider': {
        target: 'https://smsfortius.org',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/sms-provider/, '/V2/apikey.php')
      }
    }
  }
});
