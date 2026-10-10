import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'Sift',
  version: pkg.version,
  description: "Ask questions about the page you're on.",
  // Broad host_permissions instead of activeTab: re-clicking the toolbar icon while
  // the panel was already open was found, empirically, not to reliably re-grant
  // activeTab for the tab being clicked on (executeScript failed with a
  // host-permission error even on an explicit re-click). The panel is tab-scoped now
  // (#14, ADR 0008), which changes *when* a click happens relative to the tab it
  // opens for, but that combination hasn't been re-verified against activeTab, so
  // this stays broad rather than risking a regression on a guess.
  permissions: ['sidePanel', 'storage', 'scripting', 'contextMenus'],
  host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  // No default_path (#14): declaring one makes Chrome fall back to a single global
  // panel shared by every tab even when the background script also configures a
  // tab-specific one, confirmed against GoogleChrome/chrome-extensions-samples#987.
  // crxjs still needs an entry point for src/sidepanel/index.html without it —
  // see vite.config.ts.
  options_page: 'src/options/index.html',
  action: { default_title: 'Sift' },
  icons: {
    16: 'public/icons/16.png',
    48: 'public/icons/48.png',
    128: 'public/icons/128.png',
  },
})
