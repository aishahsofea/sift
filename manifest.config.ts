import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'Sift',
  version: pkg.version,
  description: "Ask questions about the page you're on.",
  // Broad host_permissions instead of activeTab: the side panel persists across tab
  // switches, and re-clicking the toolbar icon while it's already open does not
  // reliably re-grant activeTab for the newly active tab (verified empirically —
  // executeScript fails with a host-permission error even on an explicit re-click).
  permissions: ['sidePanel', 'storage', 'scripting'],
  host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  options_page: 'src/options/index.html',
  action: { default_title: 'Sift' },
  icons: {
    16: 'public/icons/16.png',
    48: 'public/icons/48.png',
    128: 'public/icons/128.png',
  },
})
