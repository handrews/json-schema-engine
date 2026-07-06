// URI handling for schema identification and reference resolution.

export class UnresolvableRefError extends Error {}

export function resolveUri(ref: string, base: string): string {
  try {
    return new URL(ref, base).href;
  } catch {
    throw new UnresolvableRefError(`cannot resolve '${ref}' against '${base}'`);
  }
}

export interface SplitUri {
  resource: string;         // URI without fragment
  fragment: string | null;  // decoded fragment, null if absent
}

export function splitFragment(uri: string): SplitUri {
  const i = uri.indexOf("#");
  return i === -1
    ? { resource: uri, fragment: null }
    : { resource: uri.slice(0, i), fragment: decodeURIComponent(uri.slice(i + 1)) };
}
