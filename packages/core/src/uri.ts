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
  return i === -1
    ? { resource: uri, fragment: null }
    : {
        resource: uri.slice(0, i),
        fragment: decodeURIComponent(uri.slice(i + 1)),
      };
}
