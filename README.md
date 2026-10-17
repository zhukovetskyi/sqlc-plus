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

To contribute to the project:

1. Install the **Extension Test Runner** by Microsoft from the VS Code Marketplace to run and debug tests visually.
2. Setup environment:

```bash
npm install -g yo generator-code vsce
yo code   # scaffold (already structured for TypeScript)
npm install
```

Press **F5** in VS Code to launch the Extension Development Host, and run `npm test` for unit tests.

## Implementation Roadmap by Gemma4:31b

### Phase 1: Infrastructure (Completed)

- [x] Extension recommendations (`extensions.json`)
- [x] Agent verification contract (`AGENTS.md`)
- [x] GitHub Actions CI with headlessly running tests (`xvfb`)

### Phase 2: Domain Logic (The Brain)

- [ ] Create `src/transformer.ts` for pure SQL transformation.
- [ ] Implement `stripMetadata()`, `expandEmbeds()`, and `parameterizeArgs()`.
- [ ] Write comprehensive unit tests in `src/test/transformer.test.ts`.

### Phase 3: VS Code Integration (The Bridge)

- [ ] Replace `helloWorld` with `sqlc-plus.convert` command.
- [ ] Integrate `Transformer` with `vscode.window.activeTextEditor`.
- [ ] Implement clipboard output via `vscode.env.clipboard`.
- [ ] Add command to the editor right-click context menu.

## License

[GPL-3.0](LICENSE) © Bohdan Zhukovetskyi
