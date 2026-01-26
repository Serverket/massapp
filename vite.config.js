import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: [
        'massapp-logo.svg',
        'manifest.webmanifest',
        'icon-192.png',
        'icon-384.png',
        'icon-512.png',
        'icon-512-maskable.png',
        'favicon.ico',
        'favicon-32.png',
        'favicon-16.png',
        'apple-touch-icon.png',
      ],
      manifest: false,
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        enabled: true,
        suppressWarnings: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: true,
    port: 5174,
  },
  preview: {
    host: true,
    port: 5174,
  },
})
