// A schema position: the node plus its canonical location (lexical base URI
// and JSON Pointer from that base's root schema). Kept dependency-free; both
// the dialect layer and the registry build on it.

import { JsonValue } from "./json.js";

/** A schema node plus its canonical location. */
export interface SchemaRef {
  node: JsonValue;
  /** Canonical base URI, no fragment. */
  baseUri: string;
  /** JSON Pointer from the base's root schema. */
  pointer: string;
}
