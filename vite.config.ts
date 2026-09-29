import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { lucasApi } from './server/lucas'

export default defineConfig(({ mode }) => {
  // Make .env values (e.g. ANTHROPIC_API_KEY) visible to the server-side API only.
  const env = loadEnv(mode, process.cwd(), '')
  if (env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
  return {
    base: './',
    plugins: [react(), tailwindcss(), lucasApi()],
    server: { port: 5173 },
  }
})
