import { definePluginFor } from "@esauflores/plugin-sdk";
import type { Hono } from "hono";

import type { Client } from "@api/core/db.ts";
import type { Clock, CoreHooks } from "@api/core/deps.ts";

export interface Mount {
  path: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Hono app is accepted
  app: Hono<any, any, any>;
}

/** Collects the routes plugins register during setup; `app.ts` mounts them under /api, behind auth. */
export class Routes {
  readonly #mounts: Mount[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Hono app is accepted
  mount(path: string, app: Hono<any, any, any>): void {
    this.#mounts.push({ path, app });
  }

  get mounts(): readonly Mount[] {
    return this.#mounts;
  }
}

/** Services the host provides to every plugin, without a `dependsOn`. */
export interface KernelServices {
  /** The libSQL client: plain SQL, so plugins can use any query library on top. */
  db: Client;
  clock: Clock;
  routes: Routes;
}

/** `definePlugin` for the built-in modules, which add their own service to `S`. */
export const defineCorePlugin = <S extends object = object>() => definePluginFor<CoreHooks, KernelServices & S>();
