import * as assert from 'assert';

import { expandEmbeds, parameterizeArgs, stripMetadata, transformSqlcQuery } from '../transformer';

suite('transformer', () => {
  suite('transformSqlcQuery', () => {
    test('expands sqlc.embed into a star reference', () => {
      const result = transformSqlcQuery(
        'SELECT sqlc.embed(users), sqlc.embed(profiles) FROM users;'
      );

      assert.strictEqual(result.sql, 'SELECT users.*, profiles.* FROM users;');
    });

    test('replaces sqlc.arg with numbered placeholders', () => {
      const result = transformSqlcQuery(
        "SELECT * FROM users WHERE id = sqlc.arg('user_id') AND status = sqlc.arg('status');"
      );

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = $1 AND status = $2;');
    });

    test('replaces sqlc.narg with a numbered placeholder', () => {
      const result = transformSqlcQuery("SELECT * FROM users WHERE status = sqlc.narg('status');");

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE status = $1;');
    });

    test('accepts an unquoted parameter name', () => {
      const result = transformSqlcQuery('SELECT * FROM users WHERE id = sqlc.arg(user_id);');

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = $1;');
    });

    test('replaces the @name shorthand', () => {
      const result = transformSqlcQuery('SELECT * FROM users WHERE id = @user_id;');

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = $1;');
      assert.deepStrictEqual(result.parameters, [
        {
          number: 1,
          name: 'user_id',
          placeholder: '$1',
          slice: false,
          nullable: false,
          statement: 1,
        },
      ]);
    });

    test('keeps the @ operator of other expressions', () => {
      const result = transformSqlcQuery("SELECT * FROM docs WHERE body @> 'sqlc';");

      assert.strictEqual(result.sql, "SELECT * FROM docs WHERE body @> 'sqlc';");
    });

    test('uses one number for a repeated parameter name', () => {
      const result = transformSqlcQuery(
        "SELECT * FROM users WHERE id = sqlc.arg('id') OR parent_id = sqlc.arg('id');"
      );

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = $1 OR parent_id = $1;');
      assert.strictEqual(result.parameters.length, 1);
    });

    test('gives every parameter name its own number', () => {
      const result = transformSqlcQuery(
        "SELECT * FROM users WHERE id = sqlc.arg('id') AND tenant = sqlc.arg('tenant');"
      );

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = $1 AND tenant = $2;');
    });

    test('restarts the numbering for every statement', () => {
      const result = transformSqlcQuery(
        "SELECT * FROM a WHERE id = sqlc.arg('id');\nSELECT * FROM b WHERE id = sqlc.arg('id');"
      );

      assert.strictEqual(
        result.sql,
        'SELECT * FROM a WHERE id = $1;\nSELECT * FROM b WHERE id = $1;'
      );
    });

    test('keeps the numbers of native placeholders', () => {
      const result = transformSqlcQuery(
        "SELECT * FROM users WHERE id = $1 AND tenant = sqlc.arg('t');"
      );

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = $1 AND tenant = $2;');
    });

    test('does not rewrite a macro inside a string literal', () => {
      const result = transformSqlcQuery("SELECT 'sqlc.arg(x)' FROM users;");

      assert.strictEqual(result.sql, "SELECT 'sqlc.arg(x)' FROM users;");
    });

    test('does not rewrite a macro inside a comment', () => {
      const result = transformSqlcQuery('-- see sqlc.arg(x)\nSELECT 1;');

      assert.strictEqual(result.sql, '-- see sqlc.arg(x)\nSELECT 1;');
    });

    test('does not rewrite a macro inside a dollar quoted string', () => {
      const result = transformSqlcQuery('SELECT $tag$ sqlc.arg(x) $tag$ FROM users;');

      assert.strictEqual(result.sql, 'SELECT $tag$ sqlc.arg(x) $tag$ FROM users;');
    });

    test('removes the query annotation', () => {
      const result = transformSqlcQuery('-- name: GetUserById :one\nSELECT * FROM users;');

      assert.strictEqual(result.sql, 'SELECT * FROM users;');
    });

    test('removes a block query annotation', () => {
      const result = transformSqlcQuery('/* name: GetUserById :one */\nSELECT * FROM users;');

      assert.strictEqual(result.sql, 'SELECT * FROM users;');
    });

    test('keeps a comment that is not an annotation', () => {
      const result = transformSqlcQuery('-- name: users table\nSELECT * FROM users;');

      assert.strictEqual(result.sql, '-- name: users table\nSELECT * FROM users;');
    });

    test('keeps the other comments of a query', () => {
      const result = transformSqlcQuery('-- name: GetUser :one\n-- the user table\nSELECT 1;');

      assert.strictEqual(result.sql, '-- the user table\nSELECT 1;');
    });

    test('reports the parameters to bind', () => {
      const result = transformSqlcQuery(
        "SELECT * FROM users WHERE id = sqlc.arg('id') AND status = sqlc.narg('status');"
      );

      assert.deepStrictEqual(result.parameters, [
        {
          number: 1,
          name: 'id',
          placeholder: '$1',
          slice: false,
          nullable: false,
          statement: 1,
        },
        {
          number: 2,
          name: 'status',
          placeholder: '$2',
          slice: false,
          nullable: true,
          statement: 1,
        },
      ]);
    });

    test('reports a native placeholder as a parameter', () => {
      const result = transformSqlcQuery('SELECT * FROM users WHERE id = $1;');

      assert.deepStrictEqual(result.parameters, [
        {
          number: 1,
          name: '',
          placeholder: '$1',
          slice: false,
          nullable: false,
          statement: 1,
        },
      ]);
    });

    test('reports the statement of every parameter', () => {
      const result = transformSqlcQuery(
        "SELECT * FROM a WHERE id = sqlc.arg('id');\nSELECT * FROM b WHERE id = sqlc.arg('id');"
      );

      assert.strictEqual(result.statementCount, 2);
      assert.deepStrictEqual(
        result.parameters.map((parameter) => parameter.statement),
        [1, 2]
      );
    });

    test('converts the documented example', () => {
      const input = [
        '-- name: GetUserById :one',
        'SELECT sqlc.embed(users), sqlc.embed(profiles)',
        'FROM users',
        'JOIN profiles ON users.id = profiles.user_id',
        "WHERE users.id = sqlc.arg('user_id') AND users.status = sqlc.narg('status');",
      ].join('\n');

      const result = transformSqlcQuery(input);

      assert.strictEqual(
        result.sql,
        [
          'SELECT users.*, profiles.*',
          'FROM users',
          'JOIN profiles ON users.id = profiles.user_id',
          'WHERE users.id = $1 AND users.status = $2;',
        ].join('\n')
      );
    });

    test('converts a query to the mysql style', () => {
      const result = transformSqlcQuery("SELECT * FROM users WHERE id = sqlc.arg('id');", {
        placeholderStyle: 'mysql',
      });

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = ?;');
    });

    test('converts a query to the sqlite style', () => {
      const result = transformSqlcQuery("SELECT * FROM users WHERE id = sqlc.arg('id');", {
        placeholderStyle: 'sqlite',
      });

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = ?1;');
    });

    test('returns an empty result for an empty query', () => {
      const result = transformSqlcQuery('   \n  ');

      assert.strictEqual(result.sql, '');
      assert.deepStrictEqual(result.parameters, []);
    });

    test('leaves a call with an empty name alone', () => {
      const result = transformSqlcQuery("SELECT * FROM users WHERE id = sqlc.arg('');");

      assert.strictEqual(result.sql, "SELECT * FROM users WHERE id = sqlc.arg('');");
      assert.deepStrictEqual(result.parameters, []);
    });

    test('leaves a call with a wrong argument count alone', () => {
      const result = transformSqlcQuery('SELECT * FROM users WHERE id = sqlc.arg();');

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id = sqlc.arg();');
    });

    test('leaves an unknown sqlc function alone', () => {
      const result = transformSqlcQuery('SELECT sqlc.unknown(users);');

      assert.strictEqual(result.sql, 'SELECT sqlc.unknown(users);');
    });

    test('leaves a macro with an open parenthesis alone', () => {
      const result = transformSqlcQuery('SELECT sqlc.arg(id;');

      assert.strictEqual(result.sql, 'SELECT sqlc.arg(id;');
    });

    test('keeps a nested block comment', () => {
      const result = transformSqlcQuery("/* a /* b */ c */\nSELECT sqlc.arg('id');");

      assert.strictEqual(result.sql, '/* a /* b */ c */\nSELECT $1;');
    });
  });

  suite('expandEmbeds', () => {
    test('expands an embed', () => {
      assert.strictEqual(expandEmbeds('SELECT sqlc.embed(users);'), 'SELECT users.*;');
    });

    test('keeps the quotes of a quoted table name', () => {
      assert.strictEqual(expandEmbeds('SELECT sqlc.embed("Users");'), 'SELECT "Users".*;');
    });

    test('keeps the schema of a qualified table name', () => {
      assert.strictEqual(
        expandEmbeds('SELECT sqlc.embed(public.users);'),
        'SELECT public.users.*;'
      );
    });

    test('leaves an embed with a wrong argument count alone', () => {
      assert.strictEqual(
        expandEmbeds('SELECT sqlc.embed(users, orders);'),
        'SELECT sqlc.embed(users, orders);'
      );
    });
  });

  suite('parameterizeArgs', () => {
    test('numbers the parameters from one', () => {
      const result = parameterizeArgs("SELECT sqlc.arg('a'), sqlc.narg('b');");

      assert.strictEqual(result.sql, 'SELECT $1, $2;');
    });

    test('marks a slice parameter', () => {
      const result = parameterizeArgs("SELECT * FROM users WHERE id IN (sqlc.slice('ids'));");

      assert.strictEqual(result.sql, 'SELECT * FROM users WHERE id IN ($1);');
      assert.deepStrictEqual(result.parameters, [
        {
          number: 1,
          name: 'ids',
          placeholder: '$1',
          slice: true,
          nullable: false,
          statement: 1,
        },
      ]);
    });
  });

  suite('stripMetadata', () => {
    test('removes the annotation line', () => {
      assert.strictEqual(stripMetadata('-- name: GetUser :one\nSELECT 1;'), 'SELECT 1;');
    });

    test('removes the annotation and keeps the other comments', () => {
      assert.strictEqual(
        stripMetadata('-- name: GetUser :one\n-- a comment\nSELECT 1;'),
        '-- a comment\nSELECT 1;'
      );
    });

    test('removes a trailing annotation', () => {
      assert.strictEqual(stripMetadata('SELECT 1; -- name: GetUser :one'), 'SELECT 1;');
    });
  });
});
