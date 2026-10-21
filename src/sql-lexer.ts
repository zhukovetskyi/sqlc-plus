/**
 * A scanner over SQL text.
 *
 * The scanner does not parse SQL. It knows enough about comments, string
 * literals, quoted identifiers and dollar quoted strings to walk a query
 * without looking inside a region where sqlc syntax must be left alone.
 */

export interface Dialect {
  /** The native placeholder syntax of the dialect. */
  readonly placeholderStyle: 'postgres' | 'mysql' | 'sqlite';
  /** The dialect reads "@name" as sqlc syntax. */
  readonly atSign: boolean;
  /** The dialect reads "$1" as a bind parameter. */
  readonly dollarNumber: boolean;
  /** The dialect reads "?" as a bind parameter. */
  readonly question: boolean;
  /** The dialect reads "`ident`" as a quoted identifier. */
  readonly backtick: boolean;
  /** The dialect reads "#" as a comment sign. */
  readonly hashComment: boolean;
  /** The dialect reads "..." as a string literal, not as a quoted identifier. */
  readonly doubleQuoteString: boolean;
  /** The dialect reads a block comment that holds another block comment. */
  readonly nestedBlockComment: boolean;
  /** A backslash escapes the next character inside a string literal. */
  readonly backslash: boolean;
}

export const postgresDialect: Dialect = {
  placeholderStyle: 'postgres',
  atSign: true,
  dollarNumber: true,
  question: false,
  backtick: false,
  hashComment: false,
  doubleQuoteString: false,
  nestedBlockComment: true,
  backslash: false,
};

export const mysqlDialect: Dialect = {
  placeholderStyle: 'mysql',
  atSign: false,
  dollarNumber: false,
  question: true,
  backtick: true,
  hashComment: true,
  doubleQuoteString: true,
  nestedBlockComment: false,
  backslash: true,
};

export const sqliteDialect: Dialect = {
  placeholderStyle: 'sqlite',
  atSign: true,
  dollarNumber: false,
  question: true,
  backtick: true,
  hashComment: false,
  doubleQuoteString: false,
  nestedBlockComment: false,
  backslash: true,
};

export const dialects = {
  postgres: postgresDialect,
  mysql: mysqlDialect,
  sqlite: sqliteDialect,
} as const;

export type DialectName = keyof typeof dialects;

export function dialectFor(name: DialectName): Dialect {
  return dialects[name];
}

/** The kind of a construct found in the query text. */
export type TokenKind = 'sqlc.arg' | 'sqlc.narg' | 'sqlc.slice' | 'sqlc.embed' | 'at' | 'native';

/** One construct found in the query text. */
export interface Token {
  readonly kind: TokenKind;
  /** The offset of the first character of the construct. */
  readonly start: number;
  /** The offset just past the last character of the construct. */
  readonly end: number;
  /** The parameter name, or the table name for an embed. */
  readonly name: string;
  /** The text to reuse when the construct is rebuilt, so quoting is kept. */
  readonly ident: string;
  /** The number of a native placeholder. The number is 0 when the text has none. */
  readonly number: number;
  /** The native placeholder carries its own number. */
  readonly explicit: boolean;
}

/** One comment of the query text. */
export interface Comment {
  /** The offset of the first character of the comment. */
  readonly start: number;
  /** The offset just past the last character of the comment. */
  readonly end: number;
  /** The kind of the comment. */
  readonly style: 'line' | 'block';
}

/** One keyword of the query text. */
export interface Keyword {
  /** The keyword in upper case. */
  readonly word: string;
  /** The offset of the first character of the keyword. */
  readonly start: number;
  /** The offset just past the last character of the keyword. */
  readonly end: number;
}

function isIdentStart(char: string): boolean {
  return (
    char === '_' || (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char >= '\u0080'
  );
}

function isIdentPart(char: string): boolean {
  return isIdentStart(char) || (char >= '0' && char <= '9') || char === '$';
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isSpace(char: string): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f' ||
    char === '\v'
  );
}

/**
 * The scanner walks over the text of a query.
 */
export class Scanner {
  private readonly text: string;
  private readonly dialect: Dialect;

  constructor(text: string, dialect: Dialect) {
    this.text = text;
    this.dialect = dialect;
  }

  /**
   * The offset just past the comment, string literal, quoted identifier or
   * dollar quoted string that starts at the offset.
   * The result is -1 when no such token starts there.
   */
  skip(offset: number): number {
    const char = this.at(offset);
    switch (char) {
      case "'":
        return this.skipQuoted(offset, "'", this.dialect.backslash);
      case '"':
        return this.skipQuoted(
          offset,
          '"',
          this.dialect.doubleQuoteString && this.dialect.backslash
        );
      case '`':
        return this.dialect.backtick ? this.skipQuoted(offset, '`', false) : -1;
      case '-':
        return this.at(offset + 1) === '-' ? this.skipLine(offset) : -1;
      case '#':
        return this.dialect.hashComment ? this.skipLine(offset) : -1;
      case '/':
        return this.at(offset + 1) === '*' ? this.skipBlockComment(offset) : -1;
      case '$':
        return this.skipDollarQuoted(offset);
      default:
        return -1;
    }
  }

  private at(offset: number): string {
    if (offset < 0 || offset >= this.text.length) {
      return '';
    }
    return this.text[offset];
  }

  private skipQuoted(offset: number, quote: string, backslash: boolean): number {
    for (let i = offset + 1; i < this.text.length; i++) {
      const char = this.text[i];
      if (char === '\\' && backslash) {
        i++;
        continue;
      }
      if (char === quote) {
        if (this.at(i + 1) === quote) {
          i++;
          continue;
        }
        return i + 1;
      }
    }
    return this.text.length;
  }

  private skipLine(offset: number): number {
    const index = this.text.indexOf('\n', offset);
    return index >= 0 ? index + 1 : this.text.length;
  }

  private skipBlockComment(offset: number): number {
    let depth = 0;
    for (let i = offset; i < this.text.length - 1; i++) {
      if (this.text[i] === '/' && this.text[i + 1] === '*') {
        depth++;
        i++;
        continue;
      }
      if (this.text[i] === '*' && this.text[i + 1] === '/') {
        depth--;
        i++;
        if (depth === 0 || !this.dialect.nestedBlockComment) {
          return i + 1;
        }
      }
    }
    return this.text.length;
  }

  private skipDollarQuoted(offset: number): number {
    const tag = this.dollarTag(offset);
    if (tag === '') {
      return -1;
    }
    const index = this.text.indexOf(tag, offset + tag.length);
    return index >= 0 ? index + tag.length : this.text.length;
  }

  /**
   * The full opening delimiter ("$$" or "$tag$") of a dollar quoted string
   * that starts at the offset.
   * The result is an empty string when the offset does not start such a string.
   */
  private dollarTag(offset: number): string {
    if (this.at(offset) !== '$') {
      return '';
    }
    let i = offset + 1;
    for (; i < this.text.length && this.text[i] !== '$'; i++) {
      if (isDigit(this.text[i]) && i === offset + 1) {
        return '';
      }
      if (!isIdentPart(this.text[i])) {
        return '';
      }
    }
    if (i >= this.text.length) {
      return '';
    }
    return this.text.slice(offset, i + 1);
  }

  /**
   * The offset just past the identifier that starts at the offset.
   */
  identEnd(offset: number): number {
    let i = offset;
    while (i < this.text.length && isIdentPart(this.text[i])) {
      i++;
    }
    return i;
  }

  /**
   * The offset of the first character that is not a space and not a comment.
   */
  skipSpace(offset: number): number {
    let i = offset;
    while (i < this.text.length) {
      if (isSpace(this.text[i])) {
        i++;
        continue;
      }
      if (this.text[i] === '-' && this.at(i + 1) === '-') {
        i = this.skipLine(i);
        continue;
      }
      if (this.text[i] === '/' && this.at(i + 1) === '*') {
        i = this.skipBlockComment(i);
        continue;
      }
      if (this.text[i] === '#' && this.dialect.hashComment) {
        i = this.skipLine(i);
        continue;
      }
      break;
    }
    return i;
  }

  /**
   * The comments of the text, in source order.
   */
  comments(): Comment[] {
    const comments: Comment[] = [];
    for (let i = 0; i < this.text.length;) {
      const end = this.skip(i);
      if (end < 0) {
        i++;
        continue;
      }
      const char = this.text[i];
      if (char === '-' && this.at(i + 1) === '-') {
        comments.push({ start: i, end, style: 'line' });
      } else if (char === '/' && this.at(i + 1) === '*') {
        comments.push({ start: i, end, style: 'block' });
      } else if (char === '#' && this.dialect.hashComment) {
        comments.push({ start: i, end, style: 'line' });
      }
      i = Math.max(end, i + 1);
    }
    return comments;
  }

  /**
   * The keywords of the text between the two offsets, in source order.
   *
   * Only the keywords that stand outside a parenthesis are reported, so the
   * keywords of a sub-query do not appear. A keyword must stand on its own,
   * between two characters that are not part of an identifier.
   */
  keywords(start: number, end: number): Keyword[] {
    const words: Keyword[] = [];
    let depth = 0;
    for (let i = start; i < end;) {
      const stop = this.skip(i);
      if (stop >= 0) {
        i = Math.max(stop, i + 1);
        continue;
      }
      const char = this.text[i];
      if (char === '(') {
        depth++;
        i++;
        continue;
      }
      if (char === ')') {
        depth--;
        i++;
        continue;
      }
      if (depth > 0 || !isIdentStart(char)) {
        i++;
        continue;
      }
      const wordEnd = this.identEnd(i);
      if (wordEnd > end) {
        i++;
        continue;
      }
      const before = this.at(i - 1);
      const after = this.at(wordEnd);
      const wholeWord = !isIdentPart(before) && !isIdentPart(after);
      if (wholeWord) {
        words.push({ word: this.text.slice(i, wordEnd).toUpperCase(), start: i, end: wordEnd });
      }
      i = wordEnd;
    }
    return words;
  }

  /**
   * The spans of the statements in the text.
   * Every character of the text belongs to exactly one span.
   */
  statements(): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    let start = 0;
    for (let i = 0; i < this.text.length;) {
      const end = this.skip(i);
      if (end >= 0) {
        i = end;
        continue;
      }
      if (this.text[i] === ';') {
        spans.push([start, i + 1]);
        start = i + 1;
      }
      i++;
    }
    if (start < this.text.length) {
      spans.push([start, this.text.length]);
    }
    return spans;
  }

  /**
   * The offset of the ")" that closes the "(" at the offset.
   * The result is -1 when the parenthesis is not closed.
   */
  matchParen(offset: number): number {
    let depth = 0;
    for (let i = offset; i < this.text.length;) {
      const end = this.skip(i);
      if (end >= 0) {
        i = end;
        continue;
      }
      if (this.text[i] === '(') {
        depth++;
      } else if (this.text[i] === ')') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
      i++;
    }
    return -1;
  }

  /**
   * The text between the parentheses, split on the top level commas.
   * The result is empty when the text holds no argument.
   */
  splitArgs(start: number, end: number): string[] {
    const args: string[] = [];
    let depth = 0;
    let last = start;
    for (let i = start; i < end;) {
      const stop = this.skip(i);
      if (stop >= 0) {
        i = Math.min(stop, end);
        continue;
      }
      if (this.text[i] === '(') {
        depth++;
      } else if (this.text[i] === ')') {
        depth--;
      } else if (this.text[i] === ',' && depth === 0) {
        args.push(this.text.slice(last, i));
        last = i + 1;
      }
      i++;
    }
    const tail = this.text.slice(last, end);
    if (args.length === 0 && tail.trim() === '') {
      return [];
    }
    args.push(tail);
    return args;
  }

  /**
   * Every construct of the text between the two offsets, in source order.
   */
  scan(start: number, end: number): Token[] {
    const tokens: Token[] = [];
    for (let i = start; i < end;) {
      const stop = this.skip(i);
      if (stop >= 0) {
        i = Math.max(stop, i + 1);
        continue;
      }
      const char = this.text[i];
      if (isIdentStart(char)) {
        const identEnd = this.identEnd(i);
        if (this.text.slice(i, identEnd).toLowerCase() === 'sqlc') {
          const call = this.sqlcCall(i, identEnd);
          if (call) {
            tokens.push(call.token);
            i = call.next;
            continue;
          }
        }
        i = identEnd;
        continue;
      }
      if (char === '@' && this.dialect.atSign && isIdentStart(this.at(i + 1))) {
        const identEnd = this.identEnd(i + 1);
        tokens.push({
          kind: 'at',
          start: i,
          end: identEnd,
          name: this.text.slice(i + 1, identEnd),
          ident: this.text.slice(i, identEnd),
          number: 0,
          explicit: false,
        });
        i = identEnd;
        continue;
      }
      if (char === '$' && this.dialect.dollarNumber && isDigit(this.at(i + 1))) {
        let j = i + 1;
        while (j < this.text.length && isDigit(this.text[j])) {
          j++;
        }
        tokens.push({
          kind: 'native',
          start: i,
          end: j,
          name: '',
          ident: this.text.slice(i, j),
          number: Number.parseInt(this.text.slice(i + 1, j), 10),
          explicit: true,
        });
        i = j;
        continue;
      }
      if (char === '?' && this.dialect.question) {
        let j = i + 1;
        while (j < this.text.length && isDigit(this.text[j])) {
          j++;
        }
        const explicit = j > i + 1;
        tokens.push({
          kind: 'native',
          start: i,
          end: j,
          name: '',
          ident: this.text.slice(i, j),
          number: explicit ? Number.parseInt(this.text.slice(i + 1, j), 10) : 0,
          explicit,
        });
        i = j;
        continue;
      }
      i++;
    }
    return tokens;
  }

  /**
   * The sqlc call that starts at the offset, where afterSqlc is the offset just
   * past the "sqlc" identifier.
   * The result is null when the text is not a sqlc call.
   */
  private sqlcCall(start: number, afterSqlc: number): { token: Token; next: number } | null {
    let i = this.skipSpace(afterSqlc);
    if (this.at(i) !== '.') {
      return null;
    }
    i = this.skipSpace(i + 1);
    if (!isIdentStart(this.at(i))) {
      return null;
    }
    const nameEnd = this.identEnd(i);
    const name = this.text.slice(i, nameEnd).toLowerCase();
    const open = this.skipSpace(nameEnd);
    if (this.at(open) !== '(') {
      return null;
    }
    const closing = this.matchParen(open);
    if (closing < 0) {
      return null;
    }
    const end = closing + 1;
    const kind = sqlcKind(name);
    if (!kind) {
      return null;
    }
    const args = this.splitArgs(open + 1, closing);
    if (args.length !== 1) {
      return null;
    }
    const argument = this.argument(args[0]);
    if (!argument) {
      return null;
    }
    return {
      token: {
        kind,
        start,
        end,
        name: argument.name,
        ident: argument.ident,
        number: 0,
        explicit: false,
      },
      next: end,
    };
  }

  /**
   * The parameter name and the text to reuse when a sqlc call is rebuilt.
   * The result is null when the argument is not a name.
   */
  private argument(arg: string): { name: string; ident: string } | null {
    const text = arg.trim();
    if (text === '') {
      return null;
    }
    const quote = text[0];
    if (quote === "'" || quote === '"' || quote === '`') {
      const unquoted = unquote(text, quote);
      if (unquoted === null) {
        return null;
      }
      if (quote === '"' && !this.dialect.doubleQuoteString) {
        return { name: unquoted, ident: text };
      }
      if (quote === '`' && !this.dialect.backtick) {
        return null;
      }
      if (unquoted === '') {
        return null;
      }
      return { name: unquoted, ident: unquoted };
    }
    if (!isIdentStart(text[0])) {
      return null;
    }
    for (const char of text) {
      if (!isIdentPart(char) && char !== '.') {
        return null;
      }
    }
    return { name: text.replace(/\./g, ''), ident: text };
  }
}

function sqlcKind(name: string): Token['kind'] | null {
  switch (name) {
    case 'arg':
      return 'sqlc.arg';
    case 'narg':
      return 'sqlc.narg';
    case 'slice':
      return 'sqlc.slice';
    case 'embed':
      return 'sqlc.embed';
    default:
      return null;
  }
}

/**
 * The text inside the quotes, with the doubled quotes read as one quote.
 * The result is null when the text is not a quoted text.
 */
function unquote(text: string, quote: string): string | null {
  if (text.length < 2 || text[0] !== quote || text[text.length - 1] !== quote) {
    return null;
  }
  const inner = text.slice(1, -1);
  if (!inner.includes(quote)) {
    return inner;
  }
  if (!inner.includes(quote + quote)) {
    return null;
  }
  return inner.split(quote + quote).join(quote);
}
