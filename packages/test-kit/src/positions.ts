// Position-tracking JSON parser: a reference implementation of the D17
// loader capability, used to exercise Engine position lookups in tests.
// Types are structural duplicates of @jse/core's Source* types so test-kit
// stays dependency-free; the shapes must stay assignment-compatible.

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** 1-based line/column; 0-based offset. */
export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}
export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}
export interface SourceRange {
  key?: SourceSpan;
  value: SourceSpan;
}

export interface ParsedDocument {
  value: JsonValue;
  getRange: (pointer: string) => SourceRange | undefined;
}

const escapePointer = (s: string): string =>
  s.replace(/~/g, "~0").replace(/\//g, "~1");

export function parseJsonWithRanges(text: string): ParsedDocument {
  const ranges = new Map<string, SourceRange>();
  let i = 0;
  let line = 1;
  let column = 1;

  const position = (): SourcePosition => ({ line, column, offset: i });
  const fail = (message: string): never => {
    throw new SyntaxError(`${message} at line ${line}, column ${column}`);
  };
  const advance = (): void => {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    i += 1;
  };
  const skipWs = (): void => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) advance();
  };

  const parseStringToken = (): { value: string; span: SourceSpan } => {
    const start = position();
    if (text[i] !== '"') fail("expected string");
    const startOffset = i;
    advance();
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") advance();
      advance();
    }
    if (i >= text.length) fail("unterminated string");
    advance();
    return {
      value: JSON.parse(text.slice(startOffset, i)) as string,
      span: { start, end: position() },
    };
  };

  const parseValue = (pointer: string, keySpan?: SourceSpan): JsonValue => {
    skipWs();
    if (i >= text.length) fail("unexpected end of input");
    const start = position();
    let value: JsonValue;
    const c = text[i];
    if (c === "{") {
      advance();
      skipWs();
      const obj: Record<string, JsonValue> = {};
      if (text[i] === "}") {
        advance();
      } else {
        for (;;) {
          skipWs();
          const key = parseStringToken();
          skipWs();
          if (text[i] !== ":") fail("expected ':'");
          advance();
          obj[key.value] = parseValue(
            pointer + "/" + escapePointer(key.value),
            key.span,
          );
          skipWs();
          if (text[i] === ",") {
            advance();
            continue;
          }
          if (text[i] === "}") {
            advance();
            break;
          }
          fail("expected ',' or '}'");
        }
      }
      value = obj;
    } else if (c === "[") {
      advance();
      skipWs();
      const arr: JsonValue[] = [];
      if (text[i] === "]") {
        advance();
      } else {
        for (;;) {
          arr.push(parseValue(pointer + "/" + arr.length));
          skipWs();
          if (text[i] === ",") {
            advance();
            continue;
          }
          if (text[i] === "]") {
            advance();
            break;
          }
          fail("expected ',' or ']'");
        }
      }
      value = arr;
    } else if (c === '"') {
      value = parseStringToken().value;
    } else {
      const startOffset = i;
      while (i < text.length && !",}] \t\n\r".includes(text[i]!)) advance();
      try {
        value = JSON.parse(text.slice(startOffset, i)) as JsonValue;
      } catch {
        value = fail("invalid literal");
      }
    }
    const range: SourceRange = { value: { start, end: position() } };
    if (keySpan !== undefined) range.key = keySpan;
    ranges.set(pointer, range);
    return value;
  };

  const value = parseValue("");
  skipWs();
  if (i < text.length) fail("trailing content");
  return { value, getRange: (pointer) => ranges.get(pointer) };
}
