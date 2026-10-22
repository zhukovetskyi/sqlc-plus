import * as assert from 'assert';

import * as vscode from 'vscode';

import { COMMAND_ID, COMMAND_ID_WITH_VALUES } from '../extension';

const QUERY = [
  '-- name: GetUserById :one',
  'SELECT sqlc.embed(users), sqlc.embed(profiles)',
  'FROM users',
  'JOIN profiles ON users.id = profiles.user_id',
  "WHERE users.id = sqlc.arg('user_id') AND users.status = sqlc.narg('status');",
].join('\n');

const EXPECTED = [
  'SELECT users.*, profiles.*',
  'FROM users',
  'JOIN profiles ON users.id = profiles.user_id',
  'WHERE users.id = $1 AND users.status = $2;',
].join('\n');

const CTE_EXPECTED =
  "WITH params AS (SELECT '111' AS id, 'John Doe' AS name) SELECT u.* FROM users u WHERE u.id = (SELECT id FROM params) OR u.username = (SELECT name FROM params);";

suite('extension', function () {
  this.timeout(20000);

  suiteSetup(async () => {
    const extension = vscode.extensions.all.find((item) => item.packageJSON?.name === 'sqlc-plus');
    assert.ok(extension, 'the extension is not installed');
    await extension.activate();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('the command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(COMMAND_ID), 'the command is not registered');
    assert.ok(commands.includes(COMMAND_ID_WITH_VALUES), 'the command is not registered');
  });

  test('the command converts the document and copies it to the clipboard', async () => {
    const editor = await openQuery(QUERY, false);

    const result = await vscode.commands.executeCommand<{
      sql: string;
      parameters: Array<{ name: string; placeholder: string }>;
    }>(COMMAND_ID, { editor, placeholderStyle: 'postgres' });

    assert.ok(result, 'the command returned no result');
    assert.strictEqual(result.sql, EXPECTED);
    assert.deepStrictEqual(
      result.parameters.map((parameter) => parameter.name),
      ['user_id', 'status']
    );
    assert.strictEqual(await vscode.env.clipboard.readText(), EXPECTED);
  });

  test('the command converts the selection', async () => {
    const editor = await openQuery("SELECT * FROM users WHERE id = sqlc.arg('id');", true);

    const result = await vscode.commands.executeCommand<{ sql: string }>(COMMAND_ID, {
      editor,
      placeholderStyle: 'postgres',
    });

    assert.ok(result, 'the command returned no result');
    assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = $1;');
  });

  test('the command uses the placeholder style of the settings', async () => {
    const editor = await openQuery("SELECT * FROM users WHERE id = sqlc.arg('id');", true);

    const result = await vscode.commands.executeCommand<{ sql: string }>(COMMAND_ID, {
      editor,
      placeholderStyle: 'mysql',
    });

    assert.ok(result, 'the command returned no result');
    assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = ?;');
  });

  test('the command with values writes the values in a CTE', async () => {
    const editor = await openQuery(
      "SELECT u.* FROM users u WHERE u.id = sqlc.arg('id') OR u.username = sqlc.arg('name');",
      true
    );

    const result = await vscode.commands.executeCommand<{ sql: string }>(COMMAND_ID_WITH_VALUES, {
      editor,
      placeholderStyle: 'postgres',
      parameterValues: { id: "'111'", name: "'John Doe'" },
    });

    assert.ok(result, 'the command returned no result');
    assert.strictEqual(result.sql, CTE_EXPECTED);
    assert.strictEqual(await vscode.env.clipboard.readText(), CTE_EXPECTED);
  });

  test('the command with values reports a parameter that has no value', async () => {
    const editor = await openQuery("SELECT * FROM users WHERE id = sqlc.arg('id');", true);

    const result = await vscode.commands.executeCommand<{ sql: string }>(COMMAND_ID_WITH_VALUES, {
      editor,
      placeholderStyle: 'postgres',
      parameterValues: {},
    });

    assert.strictEqual(result, undefined);
  });
});

/**
 * Opens a query in an editor.
 *
 * The whole document is selected when the query is not.
 */
async function openQuery(content: string, selectAll: boolean): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({ content, language: 'sql' });
  const editor = await vscode.window.showTextDocument(document);
  const end = document.lineAt(0).text.length;
  editor.selection = selectAll
    ? new vscode.Selection(0, 0, 0, end)
    : new vscode.Selection(0, 0, 0, 0);
  return editor;
}
