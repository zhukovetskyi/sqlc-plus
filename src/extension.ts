import * as vscode from 'vscode';

import { CteResult, transformSqlcQueryWithValues } from './cte';
import { PlaceholderStyle, TransformResult, transformSqlcQuery } from './transformer';

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
  const convert = vscode.commands.registerCommand(COMMAND_ID, (options?: ConvertOptions) =>
    convertActiveQuery(options)
  );
  const convertWithValues = vscode.commands.registerCommand(
    COMMAND_ID_WITH_VALUES,
    (options?: ConvertOptions) => convertActiveQueryWithValues(options)
  );
  context.subscriptions.push(convert, convertWithValues);
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
 * The result is the selection of the editor, or the whole document when the
 * selection is empty.
 */
function queryOf(editor: vscode.TextEditor): string {
  const selection = editor.selection;
  return selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
}

/**
 * Converts the query of the active editor and copies the result to the
 * clipboard.
 */
async function convertActiveQuery(options?: ConvertOptions): Promise<TransformResult | undefined> {
  const active = editorOf(options);
  if (!active) {
    vscode.window.showErrorMessage('sqlc-plus: no active editor found.');
    return undefined;
  }

  const text = queryOf(active);
  if (text.trim() === '') {
    vscode.window.showWarningMessage('sqlc-plus: the query is empty.');
    return undefined;
  }

  const style = options?.placeholderStyle ?? placeholderStyle();
  const result = transformSqlcQuery(text, { placeholderStyle: style });
  if (result.sql === '') {
    vscode.window.showWarningMessage('sqlc-plus: the query is empty.');
    return undefined;
  }

  await vscode.env.clipboard.writeText(result.sql);
  vscode.window.showInformationMessage(message(result));
  return result;
}

/**
 * Converts the query of the active editor, with the values of the parameters
 * written in a CTE, and copies the result to the clipboard.
 */
async function convertActiveQueryWithValues(
  options?: ConvertOptions
): Promise<CteResult | undefined> {
  const active = editorOf(options);
  if (!active) {
    vscode.window.showErrorMessage('sqlc-plus: no active editor found.');
    return undefined;
  }

  const text = queryOf(active);
  if (text.trim() === '') {
    vscode.window.showWarningMessage('sqlc-plus: the query is empty.');
    return undefined;
  }

  let result: CteResult;
  try {
    const style = options?.placeholderStyle ?? placeholderStyle();
    const values = options?.parameterValues ?? parameterValues();
    result = transformSqlcQueryWithValues(text, values, { placeholderStyle: style });
  } catch (error) {
    vscode.window.showErrorMessage(`sqlc-plus: ${messageOf(error)}`);
    return undefined;
  }

  if (result.sql === '') {
    vscode.window.showWarningMessage('sqlc-plus: the query is empty.');
    return undefined;
  }

  await vscode.env.clipboard.writeText(result.sql);
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
