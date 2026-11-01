import { Dialect, DialectName, Scanner, Token, dialectFor } from './sql-lexer';

/** The placeholder syntax of the database the query is written for. */
export type PlaceholderStyle = DialectName;

export interface TransformOptions {
  /** The placeholder syntax of the result. The default is "postgres". */
  readonly placeholderStyle?: PlaceholderStyle;
}

/** One parameter that the user must bind to run the query. */
export interface TransformParameter {
  /** The number of the parameter in the statement. */
  readonly number: number;
  /** The name of the parameter. It is empty for a parameter without a name. */
  readonly name: string;
  /** The placeholder text that stands for the parameter. */
  readonly placeholder: string;
  /** The parameter holds a list of values. */
  readonly slice: boolean;
  /** The parameter accepts a null value. */
  readonly nullable: boolean;
  /** The number of the statement the parameter belongs to. */
  readonly statement: number;
}

export interface TransformResult {
  /** The query with the sqlc syntax replaced. */
  readonly sql: string;
  /** The parameters to bind, in the order of the query. */
  readonly parameters: TransformParameter[];
  /** The number of the statements of the query. */
  readonly statementCount: number;
}

interface Occurrence {
  readonly token: Token;
  number: number;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const ANNOTATION_PATTERN = /^(?:--|#)\s*name\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s+(:[A-Za-z]+)\s*$/;

const BLOCK_ANNOTATION_PATTERN = /^\s*name\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s+(:[A-Za-z]+)\s*$/;

/**
 * Converts a sqlc query into a query that a database client can run.
 *
 * The function replaces the sqlc syntax, keeps the other text as it is and
 * reports the parameters to bind.
 */
export function transformSqlcQuery(sql: string, options: TransformOptions = {}): TransformResult {
  return transform(sql, {
    dialect: dialectFor(options.placeholderStyle ?? 'postgres'),
    embed: true,
    args: true,
    metadata: true,
  });
}

/**
 * Replaces every sqlc.embed call with a star reference.
 */
export function expandEmbeds(sql: string): string {
  return transform(sql, {
    dialect: dialectFor('postgres'),
    embed: true,
    args: false,
    metadata: false,
  }).sql;
}

/**
 * Replaces every sqlc parameter with a numbered placeholder.
 */
export function parameterizeArgs(sql: string): TransformResult {
  return transform(sql, {
    dialect: dialectFor('postgres'),
    embed: false,
    args: true,
    metadata: false,
  });
}

/**
 * Removes the query annotations of sqlc.
 */
export function stripMetadata(sql: string): string {
  return transform(sql, {
    dialect: dialectFor('postgres'),
    embed: false,
    args: false,
    metadata: true,
  }).sql;
}

interface TransformParts {
  readonly dialect: Dialect;
  readonly embed: boolean;
  readonly args: boolean;
  readonly metadata: boolean;
}

function transform(sql: string, parts: TransformParts): TransformResult {
  const scanner = new Scanner(sql, parts.dialect);
  const edits: Edit[] = [];
  const parameters: TransformParameter[] = [];
  const statements = scanner.statements();

  statements.forEach(([start, end], index) => {
    const tokens = scanner.scan(start, end);
    const occurrences = numberOccurrences(tokens, parts.dialect);
    const statementParameters: TransformParameter[] = [];
    for (const occurrence of occurrences) {
      const token = occurrence.token;
      if (token.kind === 'sqlc.embed') {
        if (!parts.embed) {
          continue;
        }
        edits.push({ start: token.start, end: token.end, text: `${token.ident}.*` });
        continue;
      }
      if (!parts.args) {
        continue;
      }
      const placeholder = replacementFor(token, occurrence.number, parts.dialect);
      edits.push({ start: token.start, end: token.end, text: placeholder });
      if (token.kind === 'native') {
        statementParameters.push({
          number: occurrence.number,
          name: token.name,
          placeholder,
          slice: false,
          nullable: false,
          statement: index + 1,
        });
        continue;
      }
      if (parts.dialect.placeholderStyle !== 'mysql' && hasName(statementParameters, token.name)) {
        continue;
      }
      statementParameters.push({
        number: occurrence.number,
        name: token.name,
        placeholder,
        slice: token.kind === 'sqlc.slice',
        nullable: token.kind === 'sqlc.narg',
        statement: index + 1,
      });
    }
    parameters.push(...statementParameters);
  });

  if (parts.metadata) {
    for (const removal of annotationRemovals(sql, scanner)) {
      edits.push(removal);
    }
  }

  return { sql: applyEdits(sql, edits), parameters, statementCount: statements.length };
}

function hasName(parameters: TransformParameter[], name: string): boolean {
  return parameters.some((parameter) => parameter.name === name);
}

/**
 * Gives every parameter of a statement its number.
 *
 * The native placeholders keep the numbers the user wrote, and the numbers of
 * the sqlc parameters continue after them. A parameter name that occurs twice
 * uses one number, so the user binds one value.
 */
function numberOccurrences(tokens: Token[], dialect: Dialect): Occurrence[] {
  if (dialect.placeholderStyle === 'mysql') {
    let number = 0;
    return tokens.map((token) => ({
      token,
      number: token.kind === 'sqlc.embed' ? 0 : ++number,
    }));
  }

  const nativeNumbers = new Map<Token, number>();
  const taken = new Set<number>();
  let count = 0;
  for (const token of tokens) {
    if (token.kind !== 'native') {
      continue;
    }
    count++;
    const number = token.explicit ? token.number : count;
    nativeNumbers.set(token, number);
    taken.add(number);
  }

  const namedNumbers = new Map<string, number>();
  let next = 1;
  const occurrences: Occurrence[] = [];

  for (const token of tokens) {
    if (token.kind === 'sqlc.embed') {
      occurrences.push({ token, number: 0 });
      continue;
    }
    if (token.kind === 'native') {
      occurrences.push({ token, number: nativeNumbers.get(token) ?? 0 });
      continue;
    }
    const known = namedNumbers.get(token.name);
    if (known !== undefined) {
      occurrences.push({ token, number: known });
      continue;
    }
    while (taken.has(next)) {
      next++;
    }
    namedNumbers.set(token.name, next);
    taken.add(next);
    occurrences.push({ token, number: next });
  }

  return occurrences;
}

/**
 * The text that stands for a parameter in the result.
 */
function replacementFor(token: Token, number: number, dialect: Dialect): string {
  if (token.kind === 'sqlc.slice' && dialect.placeholderStyle !== 'postgres') {
    return `/*SLICE:${token.name}*/?`;
  }
  switch (dialect.placeholderStyle) {
    case 'postgres':
      return token.kind === 'native' ? token.ident : `$${number}`;
    case 'mysql':
      return '?';
    case 'sqlite':
      return `?${number}`;
  }
}

/**
 * The edits that remove the query annotations of sqlc.
 */
function annotationRemovals(sql: string, scanner: Scanner): Edit[] {
  const edits: Edit[] = [];
  for (const comment of scanner.comments()) {
    const text = sql.slice(comment.start, comment.end);
    if (!isAnnotation(text, comment.style)) {
      continue;
    }
    edits.push(removalEdit(sql, comment.start, comment.end));
  }
  return edits;
}

function isAnnotation(text: string, style: 'line' | 'block'): boolean {
  if (style === 'line') {
    return ANNOTATION_PATTERN.test(text);
  }
  const inner = text.replace(/^\/\*/, '').replace(/\*\/$/, '');
  const firstLine = inner.split('\n')[0];
  return BLOCK_ANNOTATION_PATTERN.test(firstLine);
}

/**
 * The edit that removes a comment.
 *
 * A comment that is on a line of its own removes the whole line. A comment
 * that stands behind other text removes the text before it on the same line.
 */
function removalEdit(sql: string, start: number, end: number): Edit {
  const lineStart = sql.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = sql.indexOf('\n', end);
  const after = sql.slice(end, lineEnd < 0 ? sql.length : lineEnd);
  const before = sql.slice(lineStart, start);

  if (before.trim() === '' && after.trim() === '') {
    return { start: lineStart, end: lineEnd < 0 ? sql.length : lineEnd + 1, text: '' };
  }

  let from = start;
  while (from > lineStart && (sql[from - 1] === ' ' || sql[from - 1] === '\t')) {
    from--;
  }
  return { start: from, end, text: '' };
}

/**
 * Applies the edits to the text.
 */
function applyEdits(sql: string, edits: Edit[]): string {
  if (edits.length === 0) {
    return sql.trim();
  }
  const sorted = [...edits].sort((left, right) => left.start - right.start);
  let result = '';
  let position = 0;
  for (const edit of sorted) {
    if (edit.start < position) {
      continue;
    }
    result += sql.slice(position, edit.start) + edit.text;
    position = edit.end;
  }
  result += sql.slice(position);
  return result.trim();
}
