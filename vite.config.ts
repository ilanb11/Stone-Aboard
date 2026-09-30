import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { lucasApi } from './server/lucas'

export default defineConfig(({ mode }) => {
  // Make .env values (API keys, the test inbox) visible to the server-side API only, never to the page.
  const env = loadEnv(mode, process.cwd(), '')
  for (const k of ['ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'MAIL_TEST_TO', 'MAIL_MAX_SENDS', 'MAIL_FROM']) if (env[k] && !process.env[k]) process.env[k] = env[k]
  return {
    base: './',
    plugins: [react(), tailwindcss(), lucasApi()],
    server: { port: 5173 },
  }
})
