import * as vscode from 'vscode';

export type Log = vscode.LogOutputChannel;

export const LOG_NAME = 'sqlc-plus';

/**
 * The log of the extension. The user reads it in the output panel with the
 * channel "sqlc-plus".
 */
export function createLog(): Log {
  return vscode.window.createOutputChannel(LOG_NAME, { log: true });
}
