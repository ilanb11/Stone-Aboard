import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, MemoryRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// The published (artifact) build runs inside a sandboxed frame where only plain
// #anchors survive in the URL, so it keeps routes in memory instead.
const Router = import.meta.env.VITE_ARTIFACT ? MemoryRouter : HashRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)
