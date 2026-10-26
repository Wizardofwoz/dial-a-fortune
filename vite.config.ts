import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error plain ESM server module
import { handle } from './server/sos.mjs'

// The dev server listens on all interfaces and accepts any Host header so it
// works behind a tunnel (ngrok etc.) when Twilio needs to reach /api/sms.
// The SOS API (/api/*) runs inside the same server; Twilio credentials are
// read from env vars (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER).
const sosApi = {
  name: 'sos-api',
  configureServer(server: any) { server.middlewares.use(handle) },
  configurePreviewServer(server: any) { server.middlewares.use(handle) },
}

export default defineConfig({
  plugins: [react(), sosApi],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    watch: { ignored: ['**/.data/**'] },
  },
})
