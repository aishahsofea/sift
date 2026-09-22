import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'Sift',
  version: pkg.version,
  description: "Ask questions about the page you're on.",
  permissions: ['sidePanel', 'storage', 'activeTab', 'scripting'],
  host_permissions: [
    'https://api.tokenfactory.nebius.com/*',
    'https://api.tavily.com/*',
  ],
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  options_page: 'src/options/index.html',
  action: { default_title: 'Sift' },
})
