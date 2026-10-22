import { Dialect, Scanner, dialectFor } from './sql-lexer';
import {
  TransformOptions,
  TransformParameter,
  TransformResult,
  transformSqlcQuery,
} from './transformer';

/** The name of the CTE that holds the values of the parameters. */
export const CTE_NAME = 'params';

export interface CteOptions extends TransformOptions {
  /** The value of each parameter, by parameter name. Each value is a SQL literal. */
  readonly values?: Record<string, string>;
}

export interface CteResult extends TransformResult {
  /** The CTE that holds the values. */
  readonly cte: string;
}

/**
 * The keywords of PostgreSQL that need a quoted identifier.
 *
 * The list is the list of the reserved words of PostgreSQL, the same list that
 * sqlc uses to quote an identifier. The list is a close match for the reserved
 * words of SQLite and MySQL, so one list stands for every dialect.
 */
const RESERVED_WORDS = new Set([
  'all',
  'analyse',
  'analyze',
  'and',
  'any',
  'array',
  'as',
  'asc',
  'asymmetric',
  'authorization',
  'binary',
  'both',
  'case',
  'cast',
  'check',
  'collate',
  'collation',
  'column',
  'concurrently',
  'constraint',
  'create',
  'cross',
  'current_catalog',
  'current_date',
  'current_role',
  'current_schema',
  'current_time',
  'current_timestamp',
  'current_user',
  'default',
  'deferrable',
  'desc',
  'distinct',
  'do',
  'else',
  'end',
  'except',
  'false',
  'fetch',
  'for',
  'foreign',
  'freeze',
  'from',
  'full',
  'grant',
  'group',
  'having',
  'ilike',
  'in',
  'initially',
  'inner',
  'intersect',
  'into',
  'is',
  'isnull',
  'join',
  'lateral',
  'leading',
  'left',
  'like',
  'limit',
  'localtime',
  'localtimestamp',
  'natural',
  'not',
  'notnull',
  'null',
  'offset',
  'on',
  'only',
  'or',
  'order',
  'outer',
  'overlaps',
  'placing',
  'primary',
  'references',
  'returning',
  'right',
  'select',
  'session_user',
  'similar',
  'some',
  'symmetric',
  'table',
  'tablesample',
  'then',
  'to',
  'trailing',
  'true',
  'union',
  'unique',
  'user',
  'using',
  'variadic',
  'verbose',
  'when',
  'where',
  'window',
  'with',
]);

/**
 * The keywords that a supported statement starts with.
 */
const FIRST_KEYWORDS = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE']);

/**
 * The name of a parameter that needs no quotes.
 */
const PLAIN_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Converts a sqlc query into a query that a database client can run, with the
 * values of the parameters written in a CTE.
 *
 * The function replaces the sqlc syntax, writes the values of the parameters
 * in a CTE and uses a scalar subquery over the CTE in place of every
 * placeholder. A subquery keeps the parameters out of the FROM list, so no
 * column becomes ambiguous and no SELECT * grows columns of the CTE.
 */
export function transformSqlcQueryWithValues(
  sql: string,
  values: Record<string, string> = {},
  options: CteOptions = {}
): CteResult {
  const dialect = dialectFor(options.placeholderStyle ?? 'postgres');
  const transformed = transformSqlcQuery(sql, options);

  if (transformed.parameters.length === 0) {
    return { ...transformed, cte: '' };
  }

  const named = transformed.parameters.filter((parameter) => parameter.name !== '');
  const unnamed = transformed.parameters.filter((parameter) => parameter.name === '');
  if (unnamed.length > 0) {
    throw new Error(
      `The placeholder ${unnamed[0].placeholder} has no name, so it cannot be a column of the CTE.`
    );
  }

  const unique = uniqueByName(named);

  const missing = unique
    .filter((parameter) => values[parameter.name] === undefined)
    .map((parameter) => parameter.name);
  if (missing.length > 0) {
    throw new Error(`The parameter ${missing.join(', ')} has no value.`);
  }

  if (transformed.statementCount > 1) {
    throw new Error('The query has more than one statement.');
  }

  const statement = statementOf(transformed.sql, dialect);
  if (!statement) {
    throw new Error('The query has no statement.');
  }

  const keywords = new Scanner(statement, dialect).keywords(0, statement.length);
  const first = keywords.length > 0 ? keywords[0].word : '';
  if (!FIRST_KEYWORDS.has(first)) {
    throw new Error(`The statement ${first} is not supported.`);
  }

  const replaced = replacePlaceholders(statement, named, dialect);
  const withClause = buildWithClause(replaced, unique, values, dialect);
  const cte = `${CTE_NAME} AS (SELECT ${columnsOf(unique, values, dialect)})`;
  const parameters = unique.map((parameter) => ({
    ...parameter,
    placeholder: referenceOf(parameter.name, dialect),
  }));

  return { sql: withClause, parameters, statementCount: transformed.statementCount, cte };
}

/**
 * The statement of the query.
 *
 * The result is null when the query holds no statement.
 */
function statementOf(sql: string, dialect: Dialect): string | null {
  const spans = new Scanner(sql, dialect).statements();
  if (spans.length === 0) {
    return null;
  }
  const [start, end] = spans[0];
  return sql.slice(start, end);
}

/**
 * The SQL text that stands for a parameter at its position.
 *
 * A scalar subquery reads one column of the CTE, so the text needs no relation
 * of its own in the FROM list.
 */
function referenceOf(name: string, dialect: Dialect): string {
  return `(SELECT ${quoteIdentifier(name, dialect)} FROM ${CTE_NAME})`;
}

/**
 * Replaces every placeholder of the statement with a scalar subquery over the
 * CTE.
 */
function replacePlaceholders(
  statement: string,
  parameters: TransformParameter[],
  dialect: Dialect
): string {
  const scanner = new Scanner(statement, dialect);
  const tokens = scanner.scan(0, statement.length).filter((token) => token.kind === 'native');

  const references = new Map<string, string>();
  for (const parameter of parameters) {
    references.set(parameter.placeholder, referenceOf(parameter.name, dialect));
  }

  const result: string[] = [];
  let position = 0;
  tokens.forEach((token, index) => {
    const reference =
      dialect.placeholderStyle === 'mysql'
        ? referenceOf(parameters[index].name, dialect)
        : references.get(token.ident);
    if (reference === undefined) {
      return;
    }
    result.push(statement.slice(position, token.start), reference);
    position = token.end;
  });
  result.push(statement.slice(position));
  return result.join('');
}

/**
 * Builds the query with the CTE that holds the values.
 *
 * A statement that has a WITH clause keeps its own CTEs. The RECURSIVE
 * modifier stays in front of every CTE, so it moves before the CTE of the
 * values.
 */
function buildWithClause(
  statement: string,
  parameters: TransformParameter[],
  values: Record<string, string>,
  dialect: Dialect
): string {
  const cte = `${CTE_NAME} AS (SELECT ${columnsOf(parameters, values, dialect)})`;

  const scanner = new Scanner(statement, dialect);
  const keywords = scanner.keywords(0, statement.length);
  const withKeyword = keywords.find((keyword) => keyword.word === 'WITH');

  if (!withKeyword) {
    return `WITH ${cte} ${statement}`;
  }

  const rest = statement.slice(withKeyword.end);
  const recursive = /^RECURSIVE(?![A-Za-z0-9_$])/i.test(rest.trimStart());
  if (!recursive) {
    return `WITH ${cte}, ${rest.trimStart()}`;
  }

  const wordStart = withKeyword.end + (rest.length - rest.trimStart().length);
  const body = statement.slice(scanner.identEnd(wordStart)).trimStart();
  return `WITH RECURSIVE ${cte}, ${body}`;
}

/**
 * The columns of the CTE, one for each distinct parameter.
 */
function columnsOf(
  parameters: TransformParameter[],
  values: Record<string, string>,
  dialect: Dialect
): string {
  return parameters
    .map((parameter) => `${values[parameter.name]} AS ${quoteIdentifier(parameter.name, dialect)}`)
    .join(', ');
}

/**
 * The parameters without a repeated name, in the order of their first use.
 */
function uniqueByName(parameters: TransformParameter[]): TransformParameter[] {
  const seen = new Set<string>();
  const unique: TransformParameter[] = [];
  for (const parameter of parameters) {
    if (seen.has(parameter.name)) {
      continue;
    }
    seen.add(parameter.name);
    unique.push(parameter);
  }
  return unique;
}

/**
 * The identifier of the parameter, quoted when it needs it.
 */
function quoteIdentifier(name: string, dialect: Dialect): string {
  if (PLAIN_IDENTIFIER.test(name) && !RESERVED_WORDS.has(name)) {
    return name;
  }
  const quote = dialect.placeholderStyle === 'mysql' ? '`' : '"';
  return `${quote}${name.split(quote).join(quote + quote)}${quote}`;
}
