import tailwind from "bun-plugin-tailwind";
import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * The production build: server.ts with everything it imports, the API and the web app's page included, bundled into
 * dist/. The page's TSX and CSS (through Tailwind) become hashed files next to the server, which serves them from
 * there, so production installs nothing and bundles nothing at runtime.
 * - root is the repo, so dist/ mirrors it (dist/server/src/server.js, dist/apps/web/index.html), and publicPath
 *   makes the page link its files from / on any route.
 * - The built server finds those files from its working directory: run it from dist/ (`bun run start` does).
 * - The web app's public/ is copied as is, for page.ts to answer its files at their own paths, and the API's
 *   migrations into dist/drizzle/, where core/db.ts finds them from the bundled server, to apply at start.
 * - The database is SQLite from Bun itself (bun:sqlite), so dist/ has no addon to carry or load, and it builds for
 *   any platform Bun does.
 * - NODE_ENV is inlined, which turns off the dev server in server.ts and gives React's production build.
 */
export const buildOptions = {
  entrypoints: [fileURLToPath(new URL("./src/server.ts", import.meta.url))],
  root: fileURLToPath(new URL("..", import.meta.url)),
  target: "bun",
  plugins: [tailwind],
  minify: true,
  sourcemap: "linked",
  publicPath: "/",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
} satisfies Bun.BuildConfig;

/** The page's text files, which get a gzip copy; the server's own code (dist/server/) and source maps don't. */
const COMPRESSIBLE = /\.(html|js|css|svg|txt|xml|json)$/;

/** Writes a gzip copy next to a file (file.gz), at the highest level and only when it's smaller, for page.ts. */
export async function compress(path: string) {
  const body = await Bun.file(path).bytes();
  const gzip = Bun.gzipSync(body, { level: 9 });
  if (gzip.length < body.length) await Bun.write(`${path}.gz`, gzip);
}

if (import.meta.main) {
  const outdir = fileURLToPath(new URL("./dist", import.meta.url));
  await rm(outdir, { recursive: true, force: true });
  const result = await Bun.build({ ...buildOptions, outdir });
  const publicDir = `${outdir}/apps/web/public`;
  await cp(fileURLToPath(new URL("../apps/web/public", import.meta.url)), publicDir, { recursive: true });
  await cp(fileURLToPath(new URL("../apps/api/drizzle", import.meta.url)), `${outdir}/drizzle`, { recursive: true });
  const publicFiles = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: publicDir, absolute: true, dot: true }));
  const pageFiles = [...result.outputs.map((output) => output.path), ...publicFiles].filter(
    (path) => COMPRESSIBLE.test(path) && !path.startsWith(`${outdir}/server/`),
  );
  await Promise.all(pageFiles.map(compress));
  console.log(`Built ${result.outputs.length} files into server/dist/, ${pageFiles.length} of them gzipped`);
}
