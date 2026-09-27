import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.ts'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // crxjs normally discovers HTML entries from manifest fields (options_page,
  // side_panel.default_path, ...). The sidepanel has no manifest field (#14 — see
  // manifest.config.ts) since chrome.sidePanel.setOptions() opens it by path instead,
  // so it needs to be declared as an ordinary extra Vite entry to still get built.
  build: {
    rollupOptions: {
      input: {
        sidepanel: 'src/sidepanel/index.html',
      },
    },
  },
})
