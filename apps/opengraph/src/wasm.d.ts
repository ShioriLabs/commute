// Wrangler bundles .wasm imports as WebAssembly.Module (see the CompiledWasm
// rule in wrangler.toml).
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
