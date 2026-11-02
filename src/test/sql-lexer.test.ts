import * as assert from 'assert';

import { Scanner, postgresDialect } from '../sql-lexer';

function textAt(text: string, needle: string): number {
  const index = text.indexOf(needle);
  assert.notStrictEqual(index, -1, `the text "${needle}" is not in the text`);
  return index;
}

/**
 * The statement at the offset, without the leading and the trailing spaces.
 */
function statementAt(text: string, offset: number): string {
  const span = new Scanner(text, postgresDialect).statementAt(offset);
  assert.ok(span, 'the statement is not found');
  return text.slice(span[0], span[1]).trim();
}

suite('sql-lexer', () => {
  const TWO_STATEMENTS = [
    '-- name: GetUserById :one',
    'SELECT * FROM users WHERE id = 1;',
    '',
    '-- name: ListUsers :many',
    'SELECT * FROM users;',
  ].join('\n');

  const FIRST = ['-- name: GetUserById :one', 'SELECT * FROM users WHERE id = 1;'].join('\n');

  const SECOND = ['-- name: ListUsers :many', 'SELECT * FROM users;'].join('\n');

  test('the statement at the cursor in the first statement', () => {
    assert.strictEqual(statementAt(TWO_STATEMENTS, textAt(TWO_STATEMENTS, 'FROM users')), FIRST);
  });

  test('the statement at the cursor in the last statement', () => {
    assert.strictEqual(statementAt(TWO_STATEMENTS, textAt(TWO_STATEMENTS, 'ListUsers')), SECOND);
  });

  test('the offset past the text takes the last statement', () => {
    assert.strictEqual(statementAt(TWO_STATEMENTS, TWO_STATEMENTS.length + 10), SECOND);
  });

  test('the cursor past a semicolon keeps the statement before it', () => {
    const cursor = TWO_STATEMENTS.indexOf(';', 0) + 1;
    assert.strictEqual(statementAt(TWO_STATEMENTS, cursor), FIRST);
  });

  test('the cursor in the spaces of the last line keeps the last statement', () => {
    const text = `${TWO_STATEMENTS}\n\n   `;
    assert.strictEqual(statementAt(text, text.length), SECOND);
  });

  test('the semicolon in a string does not split the statement', () => {
    const text = "SELECT ';' AS a FROM t; SELECT 2;";
    assert.strictEqual(statementAt(text, textAt(text, 'AS a')), "SELECT ';' AS a FROM t;");
    assert.strictEqual(statementAt(text, text.length), 'SELECT 2;');
  });

  test('the semicolon in a comment does not split the statement', () => {
    const text = 'SELECT 1 -- the user; found\nFROM t; SELECT 2;';
    assert.strictEqual(
      statementAt(text, textAt(text, 'found')),
      ['SELECT 1 -- the user; found', 'FROM t;'].join('\n')
    );
    assert.strictEqual(statementAt(text, text.length), 'SELECT 2;');
  });

  test('the semicolon in a dollar quoted string does not split the statement', () => {
    const text = 'SELECT $tag$; the value;$tag$ AS a FROM t; SELECT 2;';
    assert.strictEqual(
      statementAt(text, textAt(text, 'the value')),
      'SELECT $tag$; the value;$tag$ AS a FROM t;'
    );
  });

  test('the leading spaces of the first statement belong to it', () => {
    assert.strictEqual(statementAt('\n  SELECT 1;', 0), 'SELECT 1;');
  });

  test('the result is undefined for an empty text', () => {
    assert.strictEqual(new Scanner('', postgresDialect).statementAt(0), undefined);
  });

  test('the result takes a statement that holds spaces only', () => {
    const span = new Scanner('   ', postgresDialect).statementAt(0);
    assert.ok(span, 'the statement is not found');
  });
});
