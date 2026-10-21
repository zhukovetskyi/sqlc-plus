import { Dialect, Scanner, dialectFor } from './sql-lexer';
import {
  TransformOptions,
  TransformParameter,
  TransformResult,
  transformSqlcQuery,
} from './transformer';

/** The name of the CTE that holds the values of the parameters. */
export const CTE_NAME = 'params';

/** The alias of the CTE in the FROM clause. */
const CTE_ALIAS = 'p';

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
 * sqlc uses to quote an identifier.
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
 * The keywords that end the FROM list of a statement.
 */
const FROM_END_KEYWORDS = new Set([
  'WHERE',
  'GROUP',
  'HAVING',
  'WINDOW',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'FETCH',
  'FOR',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'RETURNING',
]);

/**
 * The keywords that join two statements. The alias of the CTE is not in scope
 * after them, so the name of the CTE is used instead.
 */
const SET_OPERATION_KEYWORDS = new Set(['UNION', 'INTERSECT', 'EXCEPT']);

/**
 * The name of a parameter that needs no quotes.
 */
const PLAIN_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Converts a sqlc query into a query that a database client can run, with the
 * values of the parameters written in a CTE.
 *
 * The function replaces the sqlc syntax, writes the values of the parameters
 * in a CTE and uses the columns of the CTE in the query.
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

  const missing = named
    .filter((parameter) => values[parameter.name] === undefined)
    .map((parameter) => parameter.name);
  if (missing.length > 0) {
    throw new Error(`The parameter ${missing.join(', ')} has no value.`);
  }

  const statement = statementOf(transformed.sql, dialect);
  if (!statement) {
    throw new Error('The query has no statement.');
  }

  const keywords = new Scanner(statement, dialect).keywords(0, statement.length);
  const first = keywords.length > 0 ? keywords[0].word : '';
  if (first !== 'SELECT' && first !== 'WITH' && first !== 'INSERT') {
    throw new Error(`The statement ${first} is not supported.`);
  }

  const setOperation = keywords.find((keyword) => SET_OPERATION_KEYWORDS.has(keyword.word));
  const hasSelect = keywords.some((keyword) => keyword.word === 'SELECT');
  if (first === 'INSERT' && !hasSelect) {
    throw new Error('The statement INSERT with a VALUES list is not supported.');
  }

  const aliased = setOperation === undefined;
  const qualifier = aliased ? CTE_ALIAS : CTE_NAME;

  const replaced = replacePlaceholders(statement, transformed.parameters, qualifier, dialect);
  const withClause = buildWithClause(replaced, named, values, aliased, dialect);
  const cte = `${CTE_NAME} AS (SELECT ${columnsOf(named, values)})`;
  const parameters = named.map((parameter) => ({
    ...parameter,
    placeholder: `${qualifier}.${quoteIdentifier(parameter.name)}`,
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
 * Replaces every placeholder of the statement with the column of the CTE.
 */
function replacePlaceholders(
  statement: string,
  parameters: TransformParameter[],
  qualifier: string,
  dialect: Dialect
): string {
  const scanner = new Scanner(statement, dialect);
  const tokens = scanner.scan(0, statement.length).filter((token) => token.kind === 'native');

  const references = new Map<string, string>();
  for (const parameter of parameters) {
    references.set(parameter.placeholder, `${qualifier}.${quoteIdentifier(parameter.name)}`);
  }

  const result: string[] = [];
  let position = 0;
  tokens.forEach((token, index) => {
    const reference =
      dialect.placeholderStyle === 'mysql'
        ? `${qualifier}.${quoteIdentifier(parameters[index].name)}`
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
 */
function buildWithClause(
  statement: string,
  parameters: TransformParameter[],
  values: Record<string, string>,
  aliased: boolean,
  dialect: Dialect
): string {
  const cte = `${CTE_NAME} AS (SELECT ${columnsOf(parameters, values)})`;

  const scanner = new Scanner(statement, dialect);
  const keywords = scanner.keywords(0, statement.length);
  const withKeyword = keywords.find((keyword) => keyword.word === 'WITH');

  if (!withKeyword) {
    const body = aliased ? addFromItem(statement, dialect) : statement;
    return `WITH ${cte} ${body}`;
  }

  const rest = statement.slice(withKeyword.end);
  const trimmed = rest.trimStart();
  const offset = rest.length - trimmed.length;
  const recursive = trimmed.startsWith('RECURSIVE');
  const head = statement.slice(0, withKeyword.end) + (recursive ? ' RECURSIVE ' : ' ');
  const body = statement.slice(withKeyword.end + offset);
  const withFrom = aliased ? addFromItem(body, dialect) : body;
  return `${head}${cte}, ${withFrom}`;
}

/**
 * Adds the CTE to the FROM list of the statement.
 *
 * A statement that has no FROM clause gets a FROM clause of its own.
 */
function addFromItem(statement: string, dialect: Dialect): string {
  const scanner = new Scanner(statement, dialect);
  const keywords = scanner.keywords(0, statement.length);
  const from = keywords.find((keyword) => keyword.word === 'FROM');
  if (!from) {
    const end = endOfStatement(statement);
    const before = statement.slice(0, end).trimEnd();
    const after = statement.slice(end);
    return `${before} FROM ${CTE_NAME} ${CTE_ALIAS}${separator(after)}`;
  }

  const end = endOfList(keywords, from.end, statement);
  const before = statement.slice(0, end).trimEnd();
  const after = statement.slice(end);
  return `${before}, ${CTE_NAME} ${CTE_ALIAS}${separator(after)}`;
}

/**
 * The space between the CTE and the text that follows it.
 *
 * A semicolon and a closing parenthesis follow the CTE without a space.
 */
function separator(text: string): string {
  if (text === '') {
    return '';
  }
  if (text.startsWith(';') || text.startsWith(')')) {
    return text;
  }
  return text.startsWith(' ') || text.startsWith('\n') ? text : ` ${text}`;
}

/**
 * The offset of the semicolon that ends the statement.
 *
 * The result is the length of the statement when it has no semicolon.
 */
function endOfStatement(statement: string): number {
  const semicolon = statement.indexOf(';');
  return semicolon < 0 ? statement.length : semicolon;
}

/**
 * The offset just past the last item of a list.
 *
 * The list ends at the keyword that follows it, or at the semicolon that ends
 * the statement.
 */
function endOfList(
  keywords: Array<{ word: string; start: number; end: number }>,
  fromEnd: number,
  statement: string
): number {
  for (const keyword of keywords) {
    if (keyword.start < fromEnd) {
      continue;
    }
    if (!FROM_END_KEYWORDS.has(keyword.word)) {
      continue;
    }
    return keyword.start;
  }
  const semicolon = statement.indexOf(';', fromEnd);
  return semicolon < 0 ? statement.length : semicolon;
}

/**
 * The columns of the CTE, one for each parameter.
 */
function columnsOf(parameters: TransformParameter[], values: Record<string, string>): string {
  return parameters
    .map((parameter) => `${values[parameter.name]} AS ${quoteIdentifier(parameter.name)}`)
    .join(', ');
}

/**
 * The identifier of the parameter, quoted when it needs it.
 */
function quoteIdentifier(name: string): string {
  if (PLAIN_IDENTIFIER.test(name) && !RESERVED_WORDS.has(name)) {
    return name;
  }
  return `"${name.replace(/"/g, '""')}"`;
}
