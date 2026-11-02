import * as vscode from 'vscode';

import { CteResult, transformSqlcQueryWithValues } from './cte';
import { Log, createLog } from './log';
import { PlaceholderStyle, TransformResult, transformSqlcQuery } from './transformer';
import { Scanner, postgresDialect } from './sql-lexer';

export const COMMAND_ID = 'sqlc-plus.convert';
export const COMMAND_ID_WITH_VALUES = 'sqlc-plus.convertWithValues';
export const CONFIGURATION_SECTION = 'sqlc-plus';

export interface ConvertOptions {
  /** The editor of the query. The active editor is used when it is empty. */
  readonly editor?: vscode.TextEditor;
  /** The placeholder syntax. The setting is used when it is empty. */
  readonly placeholderStyle?: PlaceholderStyle;
  /** The value of each parameter. The setting is used when it is empty. */
  readonly parameterValues?: Record<string, string>;
}

export function activate(context: vscode.ExtensionContext): void {
  const log = createLog();
  const convert = vscode.commands.registerCommand(COMMAND_ID, (options?: ConvertOptions) =>
    convertActiveQuery(options, log)
  );
  const convertWithValues = vscode.commands.registerCommand(
    COMMAND_ID_WITH_VALUES,
    (options?: ConvertOptions) => convertActiveQueryWithValues(options, log)
  );
  context.subscriptions.push(log, convert, convertWithValues);
}

export function deactivate(): void {}

/**
 * The editor of the query.
 *
 * The result is undefined when the query has no editor.
 */
function editorOf(options?: ConvertOptions): vscode.TextEditor | undefined {
  if (options?.editor) {
    return options.editor;
  }
  return vscode.window.activeTextEditor;
}

/**
 * The query of the editor.
 *
 * The result is the selection of the editor, or the statement at the cursor
 * when the selection is empty. The statement is one query of the document,
 * with its comments, so the command does not copy the other statements.
 */
function queryOf(editor: vscode.TextEditor): string {
  const selection = editor.selection;
  if (!selection.isEmpty) {
    return editor.document.getText(selection);
  }
  const scanner = new Scanner(editor.document.getText(), postgresDialect);
  const span = scanner.statementAt(editor.document.offsetAt(selection.active));
  if (!span) {
    return '';
  }
  const start = editor.document.positionAt(span[0]);
  const end = editor.document.positionAt(span[1]);
  return editor.document.getText(new vscode.Range(start, end)).trim();
}

/**
 * The clearing of the clipboard after a failed attempt to copy, with the
 * report in the log and in a dialog.
 *
 * The result is always undefined for the command to return.
 */
async function failCopy(log: Log, level: 'warn' | 'error', detail: string): Promise<undefined> {
  await vscode.env.clipboard.writeText('');
  log[level](`sqlc-plus: ${detail}`);
  log.info('sqlc-plus: the clipboard is cleared.');
  const dialog = `sqlc-plus: ${detail} The clipboard is empty.`;
  if (level === 'warn') {
    vscode.window.showWarningMessage(dialog);
  } else {
    vscode.window.showErrorMessage(dialog);
  }
  return undefined;
}

/**
 * Converts the statement at the cursor of the active editor and copies the
 * result to the clipboard.
 */
async function convertActiveQuery(
  options?: ConvertOptions,
  log: Log = createLog()
): Promise<TransformResult | undefined> {
  const active = editorOf(options);
  if (!active) {
    return failCopy(log, 'error', 'no active editor found.');
  }

  const text = queryOf(active);
  if (text.trim() === '') {
    return failCopy(log, 'warn', 'the query is empty.');
  }

  const style = options?.placeholderStyle ?? placeholderStyle();
  const result = transformSqlcQuery(text, { placeholderStyle: style });
  if (result.sql === '') {
    return failCopy(log, 'warn', 'the query is empty.');
  }

  await vscode.env.clipboard.writeText(result.sql);
  log.info(
    `sqlc-plus: copied the query to the clipboard. Parameters: ${result.parameters.length}.`
  );
  vscode.window.showInformationMessage(message(result));
  return result;
}

/**
 * Converts the statement at the cursor of the active editor, with the values
 * of the parameters written in a CTE, and copies the result to the clipboard.
 */
async function convertActiveQueryWithValues(
  options?: ConvertOptions,
  log: Log = createLog()
): Promise<CteResult | undefined> {
  const active = editorOf(options);
  if (!active) {
    return failCopy(log, 'error', 'no active editor found.');
  }

  const text = queryOf(active);
  if (text.trim() === '') {
    return failCopy(log, 'warn', 'the query is empty.');
  }

  let result: CteResult;
  try {
    const style = options?.placeholderStyle ?? placeholderStyle();
    const values = options?.parameterValues ?? parameterValues();
    result = transformSqlcQueryWithValues(text, values, { placeholderStyle: style });
  } catch (error) {
    return failCopy(log, 'error', messageOf(error));
  }

  if (result.sql === '') {
    return failCopy(log, 'warn', 'the query is empty.');
  }

  await vscode.env.clipboard.writeText(result.sql);
  log.info(
    `sqlc-plus: copied the query with values to the clipboard. Parameters: ${result.parameters.length}.`
  );
  vscode.window.showInformationMessage(message(result));
  return result;
}

/**
 * The placeholder syntax that the user selected in the settings.
 */
function placeholderStyle(): PlaceholderStyle {
  const style = vscode.workspace
    .getConfiguration(CONFIGURATION_SECTION)
    .get<PlaceholderStyle>('placeholderStyle', 'postgres');
  return style === 'mysql' || style === 'sqlite' ? style : 'postgres';
}

/**
 * The value of each parameter, by parameter name.
 */
function parameterValues(): Record<string, string> {
  const values = vscode.workspace
    .getConfiguration(CONFIGURATION_SECTION)
    .get<Record<string, string>>('parameterValues', {});
  return values ?? {};
}

/**
 * The message that tells the user what was copied.
 */
function message(result: TransformResult): string {
  if (result.parameters.length === 0) {
    return 'sqlc-plus: copied the query to the clipboard.';
  }
  const names = result.parameters.map((parameter) => parameter.name || parameter.placeholder);
  return `sqlc-plus: copied the query to the clipboard. Parameters: ${names.join(', ')}.`;
}

/**
 * The text of an error.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
