import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { TranslationProvider } from './i18n/TranslationProvider.jsx'

if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegistered(registration) {
      if (registration) {
        setInterval(() => {
          registration.update().catch((error) => {
            console.warn('Service worker update check failed:', error)
          })
        }, 60 * 60 * 1000)
      }
    },
  })
}
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TranslationProvider>
      <App />
    </TranslationProvider>
  </StrictMode>,
)
