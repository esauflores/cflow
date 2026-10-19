import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces the layout rules: core never imports plugins, plugins (one folder
// each under plugins/) reach each other only through `index.ts`, and their
// dependency graph has no cycles.

const SRC = join(import.meta.dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  imports: [...readFileSync(path, "utf8").matchAll(/(?:from|import) "@api\/([^"]+)"/g)].map((m) => m[1]!),
}));

// Each folder under plugins/ is one plugin; api.ts and loader.ts are the shared plugin layer.
const moduleOf = (path: string) => /^plugins\/([^/]+)\//.exec(path)?.[1];

describe("architecture", () => {
  it("keeps core independent of plugins", () => {
    const offenders = files
      .filter((f) => f.path.startsWith("core/"))
      .flatMap((f) => f.imports.filter((i) => !i.startsWith("core/")).map((i) => `${f.path} -> ${i}`));
    expect(offenders).toEqual([]);
  });

  it("only crosses plugin boundaries through index.ts", () => {
    const offenders = files.flatMap((f) => {
      const own = moduleOf(f.path);
      return f.imports
        .filter((i) => {
          const target = moduleOf(i);
          if (!target || target === own) return false;
          return i.split("/").at(-1) !== "index.ts";
        })
        .map((i) => `${f.path} -> ${i}`);
    });
    expect(offenders).toEqual([]);
  });

  it("has an acyclic plugin dependency graph", () => {
    const graph = new Map<string, Set<string>>();
    for (const f of files) {
      const own = moduleOf(f.path);
      if (!own) continue;
      const deps = graph.get(own) ?? new Set();
      for (const i of f.imports) {
        const target = moduleOf(i);
        if (target && target !== own) deps.add(target);
      }
      graph.set(own, deps);
    }
    const cycles: string[] = [];
    const visit = (node: string, trail: string[]) => {
      if (trail.includes(node)) return void cycles.push([...trail.slice(trail.indexOf(node)), node].join(" -> "));
      for (const next of graph.get(node) ?? []) visit(next, [...trail, node]);
    };
    for (const node of graph.keys()) visit(node, []);
    expect(cycles).toEqual([]);
  });
});
