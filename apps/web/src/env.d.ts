/** Bun bundles the CSS that main.tsx imports for its side effects; this tells TypeScript such imports exist. */
declare module "*.css";

/** Bun's hot reload API, as main.tsx uses it: only in dev, where `data` survives a module's reruns. */
interface ImportMeta {
  readonly hot?: { data: { root?: import("react-dom/client").Root } };
}
