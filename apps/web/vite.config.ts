import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { IS_LITE_BUILD } from './scripts/lite-flag'

// Dev-only: rewrite @phosphor-icons/react barrel imports to per-icon modules.
//
// The barrel drags the whole icon library into Vite's dep pre-bundle — a
// 6.8 MB module whose evaluation blocks the main thread for ~5s on every cold
// dev load, which is most of the time the boot splash spends on screen in dev.
// The production build is unaffected either way (Rollup tree-shakes the
// barrel), so this only runs under `serve` and app code keeps the idiomatic
// barrel imports.
//
// Only the shapes actually used in this app are rewritten: plain named value
// imports (`import { XIcon, YIcon } from '@phosphor-icons/react'`). Anything
// else — aliases, type imports, namespace imports — falls back to the barrel
// untouched rather than risking a bad rewrite.
function phosphorPerIconDev(): Plugin {
  const barrelImportPattern = /import\s*\{([^}]*)\}\s*from\s*(['"])@phosphor-icons\/react\2/g
  const plainSpecifierPattern = /^([A-Za-z][A-Za-z0-9]*?)(Icon)?$/

  return {
    name: 'phosphor-per-icon-dev',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('node_modules')) return null
      if (!/\.[cm]?[jt]sx?$/.test(id.split('?')[0])) return null
      if (!code.includes('@phosphor-icons/react')) return null

      const rewritten = code.replace(barrelImportPattern, (statement, specifierList: string, quote: string) => {
        const specifiers = specifierList.split(',').map(s => s.trim()).filter(Boolean)
        const perIconImports: string[] = []

        for (const specifier of specifiers) {
          const match = plainSpecifierPattern.exec(specifier)
          if (!match) return statement
          // `CaretRightIcon` and `CaretRight` both live in dist/icons/CaretRight,
          // which exports both names.
          perIconImports.push(`import { ${specifier} } from ${quote}@phosphor-icons/react/dist/icons/${match[1]}${quote}`)
        }
        if (perIconImports.length === 0) return statement

        // Same line count as the original statement, so sourcemap-less
        // replacement doesn't shift line numbers.
        const originalLineBreaks = statement.split('\n').length - 1
        return perIconImports.join('; ') + '\n'.repeat(originalLineBreaks)
      })

      if (rewritten === code) return null
      return { code: rewritten, map: null }
    }
  }
}

export default defineConfig({
  plugins: [
    phosphorPerIconDev(),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    // The Cloudflare plugin reads wrangler.toml and emits
    // build/client/wrangler.json, which tells Workers Assets how to serve the
    // SPA. The lite bundle is a zip served by Apache/LiteSpeed — there is no
    // Worker to configure, the file is dead weight in the archive, and keeping
    // the plugin would make packaging depend on Cloudflare tooling for nothing.
    ...(IS_LITE_BUILD ? [] : [cloudflare()])
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version)
  }
})
