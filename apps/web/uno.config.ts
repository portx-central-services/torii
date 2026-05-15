import { defineConfig, presetUno, presetIcons } from 'unocss';

export default defineConfig({
  presets: [presetUno(), presetIcons()],
  theme: {
    colors: {
      torii: {
        DEFAULT: '#b91c1c',
        accent: '#dc2626',
        muted: '#f5f3ef',
      },
    },
  },
  shortcuts: {
    'btn': 'inline-flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors',
    'btn-primary': 'btn bg-torii text-white hover:bg-torii-accent',
    'btn-secondary': 'btn bg-white border border-gray-300 text-gray-800 hover:bg-gray-50',
    'btn-ghost': 'btn text-gray-700 hover:bg-gray-100',
    'input': 'border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-torii/30',
    'badge': 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
  },
});
