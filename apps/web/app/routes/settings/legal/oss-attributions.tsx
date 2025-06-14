/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { ChevronLeftIcon } from '@heroicons/react/20/solid'

export function meta() {
  return [
    { title: 'Atribusi Kode Sumber Terbuka - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

const webDependencies = [
  { name: '@headlessui/react', license: 'MIT', url: 'https://github.com/tailwindlabs/headlessui' },
  { name: '@heroicons/react', license: 'MIT', url: 'https://github.com/tailwindlabs/heroicons' },
  { name: '@react-router/node', license: 'MIT', url: 'https://github.com/remix-run/react-router' },
  { name: '@react-router/serve', license: 'MIT', url: 'https://github.com/remix-run/react-router' },
  { name: 'idb-keyval', license: 'Apache-2.0', url: 'https://github.com/jakearchibald/idb-keyval' },
  { name: 'isbot', license: 'Unlicense', url: 'https://github.com/omrilotan/isbot' },
  { name: 'react', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'react-dom', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'react-router', license: 'MIT', url: 'https://github.com/remix-run/react-router' },
  { name: 'swr', license: 'MIT', url: 'https://github.com/vercel/swr' }
]

const webDevDependencies = [
  { name: '@react-router/dev', license: 'MIT', url: 'https://github.com/remix-run/react-router' },
  { name: '@tailwindcss/vite', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss' },
  { name: '@types/node', license: 'MIT', url: 'https://github.com/DefinitelyTyped/DefinitelyTyped' },
  { name: '@types/react', license: 'MIT', url: 'https://github.com/DefinitelyTyped/DefinitelyTyped' },
  { name: '@types/react-dom', license: 'MIT', url: 'https://github.com/DefinitelyTyped/DefinitelyTyped' },
  { name: 'react-router-devtools', license: 'MIT', url: 'https://github.com/remix-run/react-router' },
  { name: 'tailwindcss', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss' },
  { name: 'typescript', license: 'Apache-2.0', url: 'https://github.com/microsoft/TypeScript' },
  { name: 'vite', license: 'MIT', url: 'https://github.com/vitejs/vite' },
  { name: 'vite-tsconfig-paths', license: 'MIT', url: 'https://github.com/aleclarson/vite-tsconfig-paths' }
]

const apiDependencies = [
  { name: 'hono', license: 'MIT', url: 'https://github.com/honojs/hono' },
  { name: 'kysely', license: 'MIT', url: 'https://github.com/kysely-org/kysely' },
  { name: 'kysely-d1', license: 'MIT', url: 'https://github.com/aidenwallis/kysely-d1' },
  { name: 'linkedom', license: 'ISC', url: 'https://github.com/WebReflection/linkedom' }
]

const apiDevDependencies = [
  { name: '@cloudflare/workers-types', license: 'Apache-2.0', url: 'https://github.com/cloudflare/workerd' },
  { name: '@types/node', license: 'MIT', url: 'https://github.com/DefinitelyTyped/DefinitelyTyped' },
  { name: 'tsc-alias', license: 'MIT', url: 'https://github.com/justkey007/tsc-alias' },
  { name: 'tsx', license: 'MIT', url: 'https://github.com/esbuild-kit/tsx' },
  { name: 'wrangler', license: 'Apache-2.0', url: 'https://github.com/cloudflare/workers-sdk' }
]

const rootDevDependencies = [
  { name: '@eslint/js', license: 'MIT', url: 'https://github.com/eslint/eslint' },
  { name: '@stylistic/eslint-plugin', license: 'MIT', url: 'https://github.com/eslint-stylistic/eslint-stylistic' },
  { name: 'eslint', license: 'MIT', url: 'https://github.com/eslint/eslint' },
  { name: 'globals', license: 'MIT', url: 'https://github.com/sindresorhus/globals' },
  { name: 'typescript-eslint', license: 'MIT', url: 'https://github.com/typescript-eslint/typescript-eslint' }
]

export default function OSSAttributionsSettingsPage() {
  return (
    <main className="overflow-x-hidden">
      <article className="bg-white w-screen h-full overflow-y-auto pb-8 overflow-x-hidden">
        <div className="p-8 sticky w-full top-0 max-w-3xl mx-auto bg-white">
          <div className="flex gap-3 items-center -ml-2">
            <button
              aria-label="Kembali"
              className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              onClick={() => history.back()}
            >
              <ChevronLeftIcon />
            </button>
            <h1 className="font-bold text-2xl">Atribusi Kode Sumber Terbuka</h1>
          </div>
        </div>
        <div className="mt-8 px-8 text-sm max-w-3xl mx-auto">
          <p>
            <b>Commute</b> menggunakan berbagai <i>library open-source</i> ajaib untuk membuat <b>Commute</b> menjadi sebuah Aplikasi yang nyata.
            Kami berterimakasih kepada <i>library-library</i> tersebut dan mengakui kerja keras para pengembang dan komunitasnya. <br /><br />
            Berikut ini adalah daftar <i>library</i> yang Kami gunakan untuk membuat <b>Commute</b> menjadi nyata:
          </p><br />
          <h2 className="font-mono text-base font-semibold">@commute/web</h2>
          <ul className="mt-4 flex flex-col gap-2">
            <li>Runtime Dependencies</li>
            {webDependencies.map(deps => (
              <li key={deps.url}>
                <article>
                  <h1 className="font-mono font-semibold">{deps.name}</h1>
                  <h2>Lisensi: <span className="font-mono font-semibold">{deps.license}</span></h2>
                  <a href={deps.url} target="_blank" className="font-mono text-blue-600">{deps.url}</a>
                </article>
              </li>
            ))}
            <li>Development Dependencies</li>
            {webDevDependencies.map(deps => (
              <li key={deps.url}>
                <article>
                  <h1 className="font-mono font-semibold">{deps.name}</h1>
                  <h2>Lisensi: <span className="font-mono font-semibold">{deps.license}</span></h2>
                  <a href={deps.url} target="_blank" className="font-mono text-blue-600">{deps.url}</a>
                </article>
              </li>
            ))}
          </ul><br />
          <h2 className="font-mono text-base font-semibold">@commute/api</h2>
          <ul className="mt-4 flex flex-col gap-2">
            <li>Runtime Dependencies</li>
            {apiDependencies.map(deps => (
              <li key={deps.url}>
                <article>
                  <h1 className="font-mono font-semibold">{deps.name}</h1>
                  <h2>Lisensi: <span className="font-mono font-semibold">{deps.license}</span></h2>
                  <a href={deps.url} target="_blank" className="font-mono text-blue-600">{deps.url}</a>
                </article>
              </li>
            ))}
            <li>Development Dependencies</li>
            {apiDevDependencies.map(deps => (
              <li key={deps.url}>
                <article>
                  <h1 className="font-mono font-semibold">{deps.name}</h1>
                  <h2>Lisensi: <span className="font-mono font-semibold">{deps.license}</span></h2>
                  <a href={deps.url} target="_blank" className="font-mono text-blue-600">{deps.url}</a>
                </article>
              </li>
            ))}
          </ul><br />
          <h2 className="font-mono text-base font-semibold">Root Dependencies</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {rootDevDependencies.map(deps => (
              <li key={deps.url}>
                <article>
                  <h1 className="font-mono font-semibold">{deps.name}</h1>
                  <h2>Lisensi: <span className="font-mono font-semibold">{deps.license}</span></h2>
                  <a href={deps.url} target="_blank" className="font-mono text-blue-600">{deps.url}</a>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </article>
    </main>
  )
}
