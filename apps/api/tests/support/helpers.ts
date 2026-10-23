import { createApp } from "@api/app.ts";

export const PASSWORD = "correct horse battery staple";

/** Boots a fresh app and returns an owner token, bootstrapping the password when the database has none. */
export async function ownerSession() {
  const app = createApp();
  const status = (await (await app.request("/api/auth/status")).json()) as {
    data: { bootstrapped: boolean };
  };
  const path = status.data.bootstrapped ? "/api/auth/login" : "/api/auth/bootstrap";
  const response = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const body = (await response.json()) as { data: { token: string } };
  return { app, token: body.data.token };
}

/** A JSON request with the bearer token, returning the parsed body and status. */
export async function call(
  app: ReturnType<typeof createApp>,
  token: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

export const today = () => new Date().toISOString().slice(0, 10);
