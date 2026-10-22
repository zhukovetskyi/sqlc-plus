# sqlc-plus

**sqlc-plus** is a VS Code extension that converts [sqlc](https://sqlc.dev/) queries into editor-ready, executable SQL, copied straight to your clipboard.

## Overview

Write queries with `sqlc` annotations, select them in the editor, run one command, and get clean parameterized SQL you can paste into any database client — no manual cleanup required.

## Features

- **`sqlc.embed(table)`** → expanded to `table.*`, with the schema and the quoting kept
- **`sqlc.arg('name')` / `sqlc.narg('name')`** → numbered placeholders (`$1`, `$2`, ...)
- **`@name`** → the same as `sqlc.arg(name)`
- **`sqlc.slice('name')`** → one placeholder for a list of values
- **Strips sqlc metadata annotations** (e.g. `-- name: GetUserById :one`)
- Works on the **current selection** or the **entire document**
- Available via the **Command Palette** and the **editor right-click context menu**
- The result matches the query that `sqlc` compiles: the parameters are numbered per statement, and a name that occurs twice uses one number
- **Writes the values in a CTE**, so the query runs as it is, without binding parameters

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

The message of the command names the parameters to bind: `user_id`, `status`.

## Usage

1. Open a file that holds `sqlc` queries.
2. Select the query, or place the cursor in the file to convert the whole document.
3. Run **sqlc: Copy sqlc Query as Executable SQL** from the Command Palette or from the right-click menu.

The converted query is in the clipboard. Paste it into your database client and bind the named parameters.

## Values in a CTE

The command **sqlc: Copy sqlc Query as Executable SQL with Values** writes the values of the parameters in a CTE, so the query runs as it is. The values come from the setting `sqlc-plus.parameterValues`.

Input:

```sql
SELECT u.* FROM users u WHERE u.id = sqlc.arg('id') OR u.username = sqlc.arg('name');
```

With the values `{ "id": "'111'", "name": "'John Doe'" }` the output is:

```sql
WITH params AS (SELECT '111' AS id, 'John Doe' AS name) SELECT u.* FROM users u, params p WHERE u.id = p.id OR u.username = p.name;
```

Each value is a SQL literal, so the quotes belong to the value. The command reports the parameters that have no value, and it copies nothing in that case.

The command supports the statements `SELECT` and `INSERT ... SELECT`. A statement `UPDATE` or `DELETE` is not supported, because the CTE needs the `USING` clause of PostgreSQL.

### The type of the values

The column of the CTE takes the type of the literal. The value `'111'` is a text, so a query that compares it with a column of the type `integer` fails with a type error. Write a cast in the value when the column is not a text:

```json
{ "id": "'111'::bigint" }
```

## Settings

| Setting                      | Values                        | Default    | Description                                                         |
| ---------------------------- | ----------------------------- | ---------- | ------------------------------------------------------------------- |
| `sqlc-plus.placeholderStyle` | `postgres`, `mysql`, `sqlite` | `postgres` | The placeholder syntax of the database the queries are written for. |
| `sqlc-plus.parameterValues`  | object                        | `{}`       | The value of each parameter, by parameter name.                     |

The setting changes the placeholders of the result:

| Style      | Placeholder |
| ---------- | ----------- |
| `postgres` | `$1`, `$2`  |
| `mysql`    | `?`         |
| `sqlite`   | `?1`, `?2`  |

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

The project uses [Prettier](https://prettier.io) for the format. Run `npm run format` to format the files, and `npm run lint` to check the lint and the format.

### Project layout

| Path                 | Content                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `src/sql-lexer.ts`   | A scanner that finds the sqlc syntax in SQL text.                 |
| `src/transformer.ts` | The conversion of a sqlc query into an executable query.          |
| `src/cte.ts`         | The conversion that writes the values of the parameters in a CTE. |
| `src/extension.ts`   | The VS Code commands, the clipboard and the messages.             |
| `src/test/`          | The unit tests and the test of the commands.                      |

The scanner, the transformer and the CTE do not use the `vscode` module, so they can be tested on their own.

## Implementation Roadmap by Gemma4:31b

### Phase 1: Infrastructure (Completed)

- [x] Extension recommendations (`extensions.json`)
- [x] Agent verification contract (`AGENTS.md`)
- [x] GitHub Actions CI with headlessly running tests (`xvfb`)

### Phase 2: Domain Logic (The Brain)

- [x] Create `src/transformer.ts` for pure SQL transformation.
- [x] Implement `stripMetadata()`, `expandEmbeds()`, and `parameterizeArgs()`.
- [x] Write comprehensive unit tests in `src/test/transformer.test.ts`.

### Phase 3: VS Code Integration (The Bridge)

- [x] Replace `helloWorld` with `sqlc-plus.convert` command.
- [x] Integrate `Transformer` with `vscode.window.activeTextEditor`.
- [x] Implement clipboard output via `vscode.env.clipboard`.
- [x] Add command to the editor right-click context menu.

### Phase 4: Values in a CTE

- [x] Add the scanner that finds the top level keywords of a query.
- [x] Create `src/cte.ts` for the conversion that writes the values in a CTE.
- [x] Add the `sqlc-plus.convertWithValues` command.
- [x] Add the setting `sqlc-plus.parameterValues`.
- [x] Write unit tests in `src/test/cte.test.ts`.

## License

[GPL-3.0](LICENSE) © Bohdan Zhukovetskyi
