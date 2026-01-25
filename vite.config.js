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
        'icon-192.png',
        'icon-384.png',
        'icon-512.png',
        'icon-512-maskable.png',
        'favicon.ico',
        'favicon-32.png',
        'favicon-16.png',
        'apple-touch-icon.png',
      ],
      manifest: {
        id: '/massapp',
        name: 'MassApp',
        short_name: 'MassApp',
        description: 'MassApp launches prefilled WhatsApp chats from curated recipient lists.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0B1D2C',
        theme_color: '#1F2933',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-384.png', sizes: '384x384', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
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
