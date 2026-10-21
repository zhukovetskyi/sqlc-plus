import * as assert from 'assert';

import { transformSqlcQueryWithValues } from '../cte';

suite('cte', () => {
  suite('transformSqlcQueryWithValues', () => {
    test('writes the values in a CTE and uses them in the query', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT u.* FROM users u WHERE u.id = sqlc.arg('id') OR u.username = sqlc.arg('name');",
        { id: "'111'", name: "'John Doe'" }
      );

      assert.strictEqual(
        result.sql,
        "WITH params AS (SELECT '111' AS id, 'John Doe' AS name) SELECT u.* FROM users u, params p WHERE u.id = p.id OR u.username = p.name;"
      );
    });

    test('writes the values of a query with a join', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT u.* FROM users u JOIN profiles pr ON pr.user_id = u.id WHERE u.id = sqlc.arg('id');",
        { id: "'111'" }
      );

      assert.strictEqual(
        result.sql,
        "WITH params AS (SELECT '111' AS id) SELECT u.* FROM users u JOIN profiles pr ON pr.user_id = u.id, params p WHERE u.id = p.id;"
      );
    });

    test('writes the values of a query without a FROM clause', () => {
      const result = transformSqlcQueryWithValues("SELECT sqlc.arg('id');", { id: '1' });

      assert.strictEqual(result.sql, 'WITH params AS (SELECT 1 AS id) SELECT p.id FROM params p;');
    });

    test('keeps the annotation out of the result', () => {
      const result = transformSqlcQueryWithValues(
        "-- name: GetUser :one\nSELECT * FROM users WHERE id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users, params p WHERE id = p.id;'
      );
    });

    test('uses one column for a name that occurs twice', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id') OR parent_id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users, params p WHERE id = p.id OR parent_id = p.id;'
      );
    });

    test('quotes a name that is a keyword', () => {
      const result = transformSqlcQueryWithValues(
        'SELECT * FROM orders WHERE "order" = sqlc.arg(\'order\');',
        { order: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS "order") SELECT * FROM orders, params p WHERE "order" = p."order";'
      );
    });

    test('quotes a name that has mixed case', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('userId');",
        { userId: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS "userId") SELECT * FROM users, params p WHERE id = p."userId";'
      );
    });

    test('writes only the parameters that the query uses', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id');",
        { id: '1', unused: "'x'" }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users, params p WHERE id = p.id;'
      );
    });

    test('adds the CTE to a query that has a WITH clause', () => {
      const result = transformSqlcQueryWithValues(
        "WITH recent AS (SELECT * FROM logs) SELECT * FROM recent WHERE id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id), recent AS (SELECT * FROM logs) SELECT * FROM recent, params p WHERE id = p.id;'
      );
    });

    test('keeps the value of a cast', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id');",
        { id: "'111'::bigint" }
      );

      assert.strictEqual(
        result.sql,
        "WITH params AS (SELECT '111'::bigint AS id) SELECT * FROM users, params p WHERE id = p.id;"
      );
    });

    test('keeps a null value', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE name = sqlc.narg('name');",
        { name: 'NULL' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT NULL AS name) SELECT * FROM users, params p WHERE name = p.name;'
      );
    });

    test('reports a parameter that has no value', () => {
      assert.throws(
        () => transformSqlcQueryWithValues("SELECT * FROM users WHERE id = sqlc.arg('id');", {}),
        /id/
      );
    });

    test('reports a parameter that has no value among others', () => {
      assert.throws(
        () =>
          transformSqlcQueryWithValues(
            "SELECT * FROM users WHERE id = sqlc.arg('id') AND name = sqlc.arg('name');",
            { id: '1' }
          ),
        /name/
      );
    });

    test('reports a placeholder that has no name', () => {
      assert.throws(
        () => transformSqlcQueryWithValues('SELECT * FROM users WHERE id = $1;', { id: '1' }),
        /\$1/
      );
    });

    test('reports an update statement', () => {
      assert.throws(
        () =>
          transformSqlcQueryWithValues(
            "UPDATE users SET name = sqlc.arg('name') WHERE id = sqlc.arg('id');",
            { id: '1', name: "'x'" }
          ),
        /UPDATE/
      );
    });

    test('reports a delete statement', () => {
      assert.throws(
        () =>
          transformSqlcQueryWithValues("DELETE FROM users WHERE id = sqlc.arg('id');", {
            id: '1',
          }),
        /DELETE/
      );
    });

    test('keeps a query that has no parameters', () => {
      const result = transformSqlcQueryWithValues('SELECT * FROM users;', {});

      assert.strictEqual(result.sql, 'SELECT * FROM users;');
    });

    test('keeps a query that has no parameters and no values', () => {
      const result = transformSqlcQueryWithValues('SELECT 1;', { id: '1' });

      assert.strictEqual(result.sql, 'SELECT 1;');
    });

    test('writes the values of an insert with a select', () => {
      const result = transformSqlcQueryWithValues(
        "INSERT INTO logs (id) SELECT id FROM users WHERE id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) INSERT INTO logs (id) SELECT id FROM users, params p WHERE id = p.id;'
      );
    });

    test('keeps a group by clause after the from list', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT count(*) FROM users WHERE id = sqlc.arg('id') GROUP BY name;",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT count(*) FROM users, params p WHERE id = p.id GROUP BY name;'
      );
    });

    test('keeps an order by clause after the from list', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id') ORDER BY name;",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users, params p WHERE id = p.id ORDER BY name;'
      );
    });

    test('keeps a limit clause after the from list', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id') LIMIT 10;",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users, params p WHERE id = p.id LIMIT 10;'
      );
    });

    test('does not add a from item to a sub-query', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id IN (SELECT user_id FROM links WHERE user_id = sqlc.arg('id'));",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users, params p WHERE id IN (SELECT user_id FROM links WHERE user_id = p.id);'
      );
    });

    test('does not change a keyword inside a string', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE name = 'from' AND id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        "WITH params AS (SELECT 1 AS id) SELECT * FROM users, params p WHERE name = 'from' AND id = p.id;"
      );
    });

    test('reports the parameters of the result', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id') AND name = sqlc.arg('name');",
        { id: '1', name: "'x'" }
      );

      assert.deepStrictEqual(
        result.parameters.map((parameter) => parameter.name),
        ['id', 'name']
      );
    });

    test('reports the CTE of the result', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id');",
        {
          id: '1',
        }
      );

      assert.strictEqual(result.cte, 'params AS (SELECT 1 AS id)');
    });
  });
});
