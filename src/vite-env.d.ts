/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare module '*.wgsl?raw' {
  const content: string
  export default content
}
