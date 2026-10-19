# API

## Authentication

There are no user accounts. One server password protects the instance:

1. `GET /api/auth/status` returns `{ bootstrapped, allowGuest, plugins }`, where `plugins` lists the
   enabled ones.
2. `POST /api/auth/bootstrap { password }` runs once: it sets the password and returns a session.
3. `POST /api/auth/login { password }` returns `{ token, expiresAt, guest }`. After 5 failed attempts
   in 15 minutes from one client it answers 429 with `Retry-After`.
4. `POST /api/auth/guest` returns a read-only session when `ALLOW_GUEST` is on (10 per client every
   15 minutes). Guests can read everything and change nothing.
5. Send `Authorization: Bearer <token>` on every other request.
6. `POST /api/auth/logout` ends the session. `POST /api/auth/change-password
   { currentPassword, newPassword }` changes the password and ends every other session.

Passwords are hashed with scrypt, and only the SHA-256 of each token is stored. Behind a reverse
proxy, set `TRUST_PROXY=true` so the limits apply per client (the last `X-Forwarded-For` address)
rather than to the proxy.

## Format

Successful responses are `{ success: true, data }`. Errors are
`{ success: false, message, code, timestamp, path }`, plus, for validation failures,
`errors: [{ field, code, message }]`. Deletes answer 204 with no body.

`message` is English. When it holds values, the error (or field error) also carries `template` and
`params`, e.g. `"There is already an {type} category named \"{name}\""` with
`{ "type": "expense", "name": "Food" }`, so a client can show it in another language.

Lists take `page`, `size` and `sort=field,asc|desc` and return
`{ content, page: { size, number, totalElements, totalPages } }`.

Amounts are decimal numbers, signed: negative is money out. Requests may also send them as strings
such as `"-12.50"`. Dates are `YYYY-MM-DD`.

## Routes

Everything under `/api` except `/api/auth` needs a session. `GET /health` is open.

| Route                                    | Does                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /balance`                           | The sum of every transaction                                                                                                             |
| `GET /summary?month=YYYY-MM`             | The dashboard: balance, the month's totals and the previous month's, every month of its year, spending by category (default: this month) |
| `GET /transactions`                      | Paged list; filters `query` (title, category or amount), `type` (`INCOME`/`EXPENSE`), `categoryId`; sorts `date`, `amount`, `createdAt`  |
| `POST /transactions`                     | `{ title, amount, date, categoryId }`                                                                                                    |
| `GET`, `PUT`, `DELETE /transactions/:id` | One transaction                                                                                                                          |
| `GET /categories`                        | Every category, with `usage` (how many transactions use it)                                                                              |
| `POST /categories`                       | `{ name, type, color? }`                                                                                                                 |
| `PATCH /categories/:id`                  | `{ name?, color? }`; "Other" can't be renamed                                                                                            |
| `DELETE /categories/:id`                 | Moves its transactions to that type's "Other"                                                                                            |
