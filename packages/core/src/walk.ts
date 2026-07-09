// Public schema-position walk (M8.6): the descent knowledge lives in each
// keyword's analyze() facts, so adapters and tools stop hardcoding their own
// applicator tables. Unlike the registry's registration walk (which owns
// base-URI rebasing, anchor indexing, and reference collection), this walk
// is deliberately tolerant: it runs on unvalidated input — e.g. a strict-
// mode check before registration — where a malformed keyword value must be
// skipped, not thrown. Registration keeps its InvalidSchemaError job.

import { JsonValue, isObject, escapeSegment } from "./json.js";
import { Dialect } from "./dialect.js";
import { DEFAULT_MAX_DEPTH, MaxDepthExceededError } from "./registry.js";

/**
 * One schema position visited by {@link walkSchema}.
 *
 * @alpha Introduced for adapter consumption (M8.6); shape may change before
 * the first published release.
 */
export interface SchemaWalkVisit {
  /** The value in schema position: an object or a boolean. */
  readonly node: JsonValue;
  /** JSON Pointer from the walk root. */
  readonly pointer: string;
  /** Applying keyword in the parent schema object; `null` at the root. */
  readonly keyword: string | null;
}

/**
 * Walks every schema position of `schema` reachable through the dialect's
 * keyword facts (`analyze().subschemas`), visiting parents before children.
 *
 * Tolerant by design: values in schema position that are neither objects
 * nor booleans are skipped, as are positions under keyword values whose
 * `analyze()` rejects them — unknown keywords' values are never descended.
 * Nesting beyond `maxDepth` still throws {@link MaxDepthExceededError}: the
 * depth bound is a security posture, not a validity judgment.
 *
 * @alpha
 */
export function walkSchema(
  schema: JsonValue,
  dialect: Pick<Dialect, "keywords">,
  visit: (v: SchemaWalkVisit) => void,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): void {
  const step = (
    node: JsonValue,
    pointer: string,
    keyword: string | null,
    depth: number,
  ): void => {
    if (depth > maxDepth) {
      throw new MaxDepthExceededError(
        `schema nesting exceeds maxDepth (${maxDepth}) at '#${pointer}'`,
      );
    }
    if (typeof node === "boolean") {
      visit({ node, pointer, keyword });
      return;
    }
    if (!isObject(node)) return;
    visit({ node, pointer, keyword });

    for (const [name, value] of Object.entries(node)) {
      const behavior = dialect.keywords.get(name)?.behavior;
      if (!behavior?.analyze) continue;
      let positions;
      try {
        positions = behavior.analyze(value, { schema: node }).subschemas;
      } catch {
        continue;
      }
      if (!positions) continue;
      for (const relPath of positions) {
        let child: JsonValue | undefined = value;
        let suffix = "/" + escapeSegment(name);
        for (const seg of relPath) {
          child =
            child === null || typeof child !== "object"
              ? undefined
              : Array.isArray(child)
                ? child[seg as number]
                : (child as Record<string, JsonValue>)[seg as string];
          suffix += "/" + escapeSegment(String(seg));
        }
        if (child !== undefined) {
          step(child, pointer + suffix, name, depth + 1);
        }
      }
    }
  };
  step(schema, "", null, 0);
}
