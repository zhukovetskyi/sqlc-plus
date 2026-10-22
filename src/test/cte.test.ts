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
        "WITH params AS (SELECT '111' AS id, 'John Doe' AS name) SELECT u.* FROM users u WHERE u.id = (SELECT id FROM params) OR u.username = (SELECT name FROM params);"
      );
    });

    test('does not make a column with the name of a parameter ambiguous', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT id FROM users WHERE id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT id FROM users WHERE id = (SELECT id FROM params);'
      );
    });

    test('keeps SELECT * free of the columns of the CTE', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users WHERE id = (SELECT id FROM params);'
      );
    });

    test('keeps a join usable when the ON clause takes a parameter', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT u.* FROM users u JOIN profiles pr ON pr.user_id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT u.* FROM users u JOIN profiles pr ON pr.user_id = (SELECT id FROM params);'
      );
    });

    test('writes the values of a query with a join', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT u.* FROM users u JOIN profiles pr ON pr.user_id = u.id WHERE u.id = sqlc.arg('id');",
        { id: '111' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 111 AS id) SELECT u.* FROM users u JOIN profiles pr ON pr.user_id = u.id WHERE u.id = (SELECT id FROM params);'
      );
    });

    test('writes the values of a query without a FROM clause', () => {
      const result = transformSqlcQueryWithValues("SELECT sqlc.arg('id');", { id: '1' });

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT (SELECT id FROM params);'
      );
    });

    test('keeps the annotation out of the result', () => {
      const result = transformSqlcQueryWithValues(
        "-- name: GetUser :one\nSELECT * FROM users WHERE id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users WHERE id = (SELECT id FROM params);'
      );
    });

    test('uses one column for a name that occurs twice', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id') OR parent_id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users WHERE id = (SELECT id FROM params) OR parent_id = (SELECT id FROM params);'
      );
    });

    test('quotes a name that is a keyword', () => {
      const result = transformSqlcQueryWithValues(
        'SELECT * FROM orders WHERE "order" = sqlc.arg(\'order\');',
        { order: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS "order") SELECT * FROM orders WHERE "order" = (SELECT "order" FROM params);'
      );
    });

    test('quotes a name that has mixed case', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('userId');",
        { userId: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS "userId") SELECT * FROM users WHERE id = (SELECT "userId" FROM params);'
      );
    });

    test('writes only the parameters that the query uses', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id');",
        { id: '1', unused: "'x'" }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users WHERE id = (SELECT id FROM params);'
      );
    });

    test('adds the CTE to a query that has a WITH clause', () => {
      const result = transformSqlcQueryWithValues(
        "WITH recent AS (SELECT * FROM logs) SELECT * FROM recent WHERE id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id), recent AS (SELECT * FROM logs) SELECT * FROM recent WHERE id = (SELECT id FROM params);'
      );
    });

    test('uses the values inside the CTEs of a WITH clause', () => {
      const result = transformSqlcQueryWithValues(
        "WITH recent AS (SELECT * FROM logs WHERE id = sqlc.arg('id')) SELECT * FROM recent;",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id), recent AS (SELECT * FROM logs WHERE id = (SELECT id FROM params)) SELECT * FROM recent;'
      );
    });

    test('adds the CTE to a recursive query with the modifier in upper case', () => {
      const result = transformSqlcQueryWithValues(
        "WITH RECURSIVE t AS (SELECT 1 AS n) SELECT n FROM t WHERE n = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH RECURSIVE params AS (SELECT 1 AS id), t AS (SELECT 1 AS n) SELECT n FROM t WHERE n = (SELECT id FROM params);'
      );
    });

    test('adds the CTE to a recursive query with the modifier in lower case', () => {
      const result = transformSqlcQueryWithValues(
        "with recursive t as (select 1 as n) select n from t where n = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH RECURSIVE params AS (SELECT 1 AS id), t as (select 1 as n) select n from t where n = (SELECT id FROM params);'
      );
    });

    test('keeps the value of a cast', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id');",
        { id: "'111'::bigint" }
      );

      assert.strictEqual(
        result.sql,
        "WITH params AS (SELECT '111'::bigint AS id) SELECT * FROM users WHERE id = (SELECT id FROM params);"
      );
    });

    test('keeps a null value', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE name = sqlc.narg('name');",
        { name: 'NULL' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT NULL AS name) SELECT * FROM users WHERE name = (SELECT name FROM params);'
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

    test('reports a query that has more than one statement', () => {
      assert.throws(
        () =>
          transformSqlcQueryWithValues("SELECT sqlc.arg('id'); SELECT count(*) FROM users;", {
            id: '1',
          }),
        /more than one statement/
      );
    });

    test('writes the values of an update statement', () => {
      const result = transformSqlcQueryWithValues(
        "UPDATE users SET name = sqlc.arg('name') WHERE id = sqlc.arg('id');",
        { id: '1', name: "'x'" }
      );

      assert.strictEqual(
        result.sql,
        "WITH params AS (SELECT 'x' AS name, 1 AS id) UPDATE users SET name = (SELECT name FROM params) WHERE id = (SELECT id FROM params);"
      );
    });

    test('keeps RETURNING * free of the columns of the CTE', () => {
      const result = transformSqlcQueryWithValues(
        "UPDATE users SET name = sqlc.arg('name') RETURNING *;",
        { name: "'x'" }
      );

      assert.strictEqual(
        result.sql,
        "WITH params AS (SELECT 'x' AS name) UPDATE users SET name = (SELECT name FROM params) RETURNING *;"
      );
    });

    test('writes the values of a delete statement', () => {
      const result = transformSqlcQueryWithValues("DELETE FROM users WHERE id = sqlc.arg('id');", {
        id: '1',
      });

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) DELETE FROM users WHERE id = (SELECT id FROM params);'
      );
    });

    test('writes the values of a query that has a WITH clause and an update', () => {
      const result = transformSqlcQueryWithValues(
        "WITH recent AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM recent) AND id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id), recent AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM recent) AND id = (SELECT id FROM params);'
      );
    });

    test('writes the values of an insert with a select', () => {
      const result = transformSqlcQueryWithValues(
        "INSERT INTO logs (id) SELECT id FROM users WHERE id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) INSERT INTO logs (id) SELECT id FROM users WHERE id = (SELECT id FROM params);'
      );
    });

    test('writes the values of an insert with a values list', () => {
      const result = transformSqlcQueryWithValues(
        "INSERT INTO logs (id) VALUES (sqlc.arg('id'));",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) INSERT INTO logs (id) VALUES ((SELECT id FROM params));'
      );
    });

    test('writes the values of an insert with a conflict clause', () => {
      const result = transformSqlcQueryWithValues(
        "INSERT INTO logs (id) SELECT id FROM users WHERE id = sqlc.arg('id') ON CONFLICT (id) DO UPDATE SET id = excluded.id;",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) INSERT INTO logs (id) SELECT id FROM users WHERE id = (SELECT id FROM params) ON CONFLICT (id) DO UPDATE SET id = excluded.id;'
      );
    });

    test('keeps a group by clause after the from list', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT count(*) FROM users WHERE id = sqlc.arg('id') GROUP BY name;",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT count(*) FROM users WHERE id = (SELECT id FROM params) GROUP BY name;'
      );
    });

    test('keeps an order by clause after the from list', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id') ORDER BY name;",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users WHERE id = (SELECT id FROM params) ORDER BY name;'
      );
    });

    test('keeps a limit clause after the from list', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id') LIMIT 10;",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users WHERE id = (SELECT id FROM params) LIMIT 10;'
      );
    });

    test('keeps the two branches of a union usable', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT id FROM users WHERE id = sqlc.arg('id') UNION SELECT id FROM admins;",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT id FROM users WHERE id = (SELECT id FROM params) UNION SELECT id FROM admins;'
      );
    });

    test('keeps the second branch of an intersect usable', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT id FROM users WHERE name = sqlc.arg('name') INTERSECT SELECT id FROM admins WHERE id = sqlc.arg('id');",
        { name: "'John Doe'", id: '1' }
      );

      assert.strictEqual(
        result.sql,
        "WITH params AS (SELECT 'John Doe' AS name, 1 AS id) SELECT id FROM users WHERE name = (SELECT name FROM params) INTERSECT SELECT id FROM admins WHERE id = (SELECT id FROM params);"
      );
    });

    test('keeps the second branch of an except usable', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT id FROM users EXCEPT SELECT id FROM admins WHERE id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT id FROM users EXCEPT SELECT id FROM admins WHERE id = (SELECT id FROM params);'
      );
    });

    test('does not add a from item to a sub-query', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id IN (SELECT user_id FROM links WHERE user_id = sqlc.arg('id'));",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users WHERE id IN (SELECT user_id FROM links WHERE user_id = (SELECT id FROM params));'
      );
    });

    test('does not change a keyword inside a string', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE name = 'from' AND id = sqlc.arg('id');",
        { id: '1' }
      );

      assert.strictEqual(
        result.sql,
        "WITH params AS (SELECT 1 AS id) SELECT * FROM users WHERE name = 'from' AND id = (SELECT id FROM params);"
      );
    });

    test('quotes a name with backticks under the mysql style', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('userId');",
        { userId: '1' },
        { placeholderStyle: 'mysql' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS `userId`) SELECT * FROM users WHERE id = (SELECT `userId` FROM params);'
      );
    });

    test('writes one column for a name that occurs twice under the mysql style', () => {
      const result = transformSqlcQueryWithValues(
        "SELECT * FROM users WHERE id = sqlc.arg('id') OR parent_id = sqlc.arg('id');",
        { id: '1' },
        { placeholderStyle: 'mysql' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS id) SELECT * FROM users WHERE id = (SELECT id FROM params) OR parent_id = (SELECT id FROM params);'
      );
      assert.deepStrictEqual(
        result.parameters.map((parameter) => parameter.name),
        ['id']
      );
    });

    test('quotes a name that is a keyword under the sqlite style', () => {
      const result = transformSqlcQueryWithValues(
        'SELECT * FROM orders WHERE "order" = sqlc.arg(\'order\');',
        { order: '1' },
        { placeholderStyle: 'sqlite' }
      );

      assert.strictEqual(
        result.sql,
        'WITH params AS (SELECT 1 AS "order") SELECT * FROM orders WHERE "order" = (SELECT "order" FROM params);'
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
