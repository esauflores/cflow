import { describe, expect, it } from "vite-plus/test";

import { buildOptions } from "../build.ts";

describe("the production build", () => {
  it("bundles the server, the page and its CSS through Tailwind", async () => {
    const result = await Bun.build(buildOptions);
    const css = await Promise.all(result.outputs.filter((output) => output.path.endsWith(".css")).map((o) => o.text()));

    expect(result.outputs.map((output) => output.path)).toContain("apps/web/index.html");
    expect(css).toHaveLength(1);
    expect(css[0]).not.toContain("@theme");
  }, 30_000);
});
