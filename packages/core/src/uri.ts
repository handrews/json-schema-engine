// URI handling for schema identification and reference resolution.

/** Thrown when a reference cannot be resolved to an absolute URI. */
export class UnresolvableRefError extends Error {}

/**
 * Resolves a reference URI against a base URI to an absolute URI.
 * @throws UnresolvableRefError if the pair does not form a valid URI.
 */
export function resolveUri(ref: string, base: string): string {
  try {
    return new URL(ref, base).href;
  } catch {
    throw new UnresolvableRefError(`cannot resolve '${ref}' against '${base}'`);
  }
}

// RFC 3986: `fragment = *( pchar / "/" / "?" )`, where `pchar = unreserved /
// pct-encoded / sub-delims / ":" / "@"`. Everything the production allows
// stays literal — ALPHA, DIGIT, `-._~`, the sub-delims `!$&'()*+,;=`, and
// `:@/?` — so an ordinary pointer reads unchanged; `%` is encoded, so a
// literal percent in a member name becomes `%25` and survives the round
// trip. Space, `"`, `<`, `>`, `\`, `^`, `` ` ``, `{`, `|`, `}`, `#`, the
// controls, and every non-ASCII character (as UTF-8 bytes) are encoded.
const FRAGMENT_UNSAFE = /[^A-Za-z0-9\-._~!$&'()*+,;=:@/?]/gu;
const FRAGMENT_SAFE = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?]*$/u;

const encodeChar = (c: string): string => {
  try {
    return encodeURIComponent(c).replace(
      /[!'()*]/g,
      (m) => "%" + m.charCodeAt(0).toString(16).toUpperCase(),
    );
  } catch {
    // A lone surrogate has no UTF-8 form: the replacement character's.
    return "%EF%BF%BD";
  }
};

/**
 * Encodes a plain-text JSON Pointer as a URI fragment (RFC 6901 §6): the
 * pointer arrives RFC 6901-escaped (`~0`/`~1`); what remains is RFC 3986's
 * requirement that a fragment hold only `pchar / "/" / "?"`. Non-ASCII is
 * encoded rather than passed through because a schema location is a URI,
 * not an IRI: it is built to be pasted into a `$ref` or handed to
 * `Engine.locate`. A human-facing UI decodes for display.
 */
export function pointerFragment(pointer: string): string {
  return FRAGMENT_SAFE.test(pointer)
    ? pointer
    : pointer.replace(FRAGMENT_UNSAFE, encodeChar);
}

/**
 * Decodes a URI fragment into a plain-text JSON Pointer: the exact inverse
 * of {@link pointerFragment}, and the only way a fragment becomes a pointer
 * (reference resolution, `Engine.locate`), so the encoding decision lives in
 * one pair of functions.
 * @throws URIError on a malformed percent-escape.
 */
export function pointerFromFragment(fragment: string): string {
  return fragment.includes("%") ? decodeURIComponent(fragment) : fragment;
}

/**
 * The canonical `schemaLocation` of a schema position: `baseUri`, fragment-
 * free and already a URI, plus the pointer as a fragment. Every schema
 * location the engine emits — a ref's key, an error's position, a unit's
 * `schemaLocation`, a compiled constant — is built here, so none can drift.
 */
export function schemaLocation(baseUri: string, pointer: string): string {
  return `${baseUri}#${pointerFragment(pointer)}`;
}

/** A URI split into its resource part and decoded fragment. */
export interface SplitUri {
  /** URI without fragment. */
  resource: string;
  /** Decoded fragment, `null` if absent. */
  fragment: string | null;
}

/** Splits a URI into its resource and decoded fragment parts. */
export function splitFragment(uri: string): SplitUri {
  const i = uri.indexOf("#");
  if (i === -1) return { resource: uri, fragment: null };
  const raw = uri.slice(i + 1);
  // Percent-decoding is the identity on a `%`-free string; skip the call
  // (and its per-call allocation) on the common case.
  return {
    resource: uri.slice(0, i),
    fragment: pointerFromFragment(raw),
  };
}

/**
 * Resolves a reference against a base and splits the result: the one parse
 * every reference lookup needs.
 * @throws UnresolvableRefError if the pair does not form a valid URI.
 */
export function resolveSplit(ref: string, base: string): SplitUri {
  return splitFragment(resolveUri(ref, base));
}
