# sqlc-plus

**sqlc-plus** is a VS Code extension that converts [sqlc](https://sqlc.dev/) queries into editor-ready, executable SQL, copied straight to your clipboard.

## Overview

Write queries with `sqlc` annotations, select them in the editor, run one command, and get clean parameterized SQL you can paste into any database client — no manual cleanup required.

## Features

- **`sqlc.embed(table)`** → expanded to `table.*`
- **`sqlc.arg('name')` / `sqlc.narg('name')`** → Postgres-style placeholders (`$1`, `$2`, ...)
- **Strips sqlc metadata annotations** (e.g. `-- name: GetUserById :one`)
- Works on the **current selection** or the **entire document**
- Available via the **Command Palette** and the **editor right-click context menu**

### Example

Input:

```sql
-- name: GetUserById :one
SELECT sqlc.embed(users), sqlc.embed(profiles)
FROM users
JOIN profiles ON users.id = profiles.user_id
WHERE users.id = sqlc.arg('user_id') AND users.status = sqlc.narg('status');
```

Output (copied to clipboard):

```sql
SELECT users.*, profiles.*
FROM users
JOIN profiles ON users.id = profiles.user_id
WHERE users.id = $1 AND users.status = $2;
```

## Status

🚧 **In development.**

## Development

```bash
npm install -g yo generator-code vsce
yo code   # scaffold (already structured for TypeScript)
npm install
```

Press **F5** in VS Code to launch the Extension Development Host, and run `npm test` for unit tests.

## License

[GPL-3.0](LICENSE) © Bohdan Zhukovetskyi
