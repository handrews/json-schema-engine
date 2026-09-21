// A schema position: the node plus its canonical location (lexical base URI
// and JSON Pointer from that base's root schema). Kept dependency-free; both
// the dialect layer and the registry build on it.

import { JsonValue } from "./json.js";

/**
 * A schema node plus its canonical location.
 *
 * The registry hands out one object per location (interned per registry
 * generation), so a ref may be shared between lookups, evaluations, and
 * snapshots: treat it as immutable. The optional fields are caches the
 * registry and the engine hang off that shared identity; a consumer that
 * builds a ref literal may leave them absent.
 */
export interface SchemaRef {
  node: JsonValue;
  /** Canonical base URI, no fragment. */
  baseUri: string;
  /** JSON Pointer from the base's root schema. */
  pointer: string;
  /** `${baseUri}#${pointer}`, built once. */
  key?: string;
  /** Memoized child positions, one hop per segment (registry-owned). */
  children?: Map<string, SchemaRef> | null;
  /**
   * The engine's per-node keyword table (engine-owned; opaque here so this
   * module stays dependency-free). Validated by dialect identity on use.
   */
  table?: object | null;
}
