// A schema position: the node plus its canonical location (lexical base URI
// and JSON Pointer from that base's root schema). Kept dependency-free; both
// the dialect layer and the registry build on it.

import { JsonValue } from "./json.js";

export interface SchemaRef {
  node: JsonValue;
  baseUri: string; // canonical base, no fragment
  pointer: string; // JSON Pointer from the base's root schema
}
