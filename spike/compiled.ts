// Hand-written validators in the exact shape the compiler tier would emit
// (ANALYSIS.md §7.4/§7.5). Written from the schemas and the spec only.
//
// The point under test: every keywordLocation/absoluteKeywordLocation below is
// a compile-time constant, and instanceLocation needs runtime work only for
// dynamic segments (array indexes, swept property names). Flag-mode artifacts
// carry zero location bookkeeping; list/annotation artifacts are separately
// specialized, the way config-specialized compilation would produce them.

export interface OutputUnit {
  keywordLocation: string;
  absoluteKeywordLocation: string;
  instanceLocation: string;
  error?: string;
  annotation?: unknown;
}

export interface ListResult {
  valid: boolean;
  errors?: OutputUnit[];
}

export interface AnnotatedResult {
  valid: boolean;
  annotations?: OutputUnit[];
  errors?: OutputUnit[];
}

// minLength/maxLength count code points. The compiler emits the exact check
// only when UTF-16 length can't already decide (units < min → points < min;
// units <= max → points <= max).
function codePointLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n++;
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) i++;
  }
  return n;
}

const isObject = (d: unknown): d is Record<string, unknown> =>
  typeof d === "object" && d !== null && !Array.isArray(d);

// ---------------------------------------------------------------------------
// Schema 1: https://spike.example/user
// ---------------------------------------------------------------------------

const USER = "https://spike.example/user#";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ZIP_RE = /^[0-9]{5}$/;
const USER_PROPS = new Set(["id", "name", "email", "role", "tags", "address"]);

export function userFlag(d: unknown): boolean {
  if (!isObject(d)) return false;
  if (!("id" in d) || !("name" in d) || !("email" in d) || !("tags" in d)) return false;

  const id = d.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return false;

  const name = d.name;
  if (typeof name !== "string" || name.length < 1) return false;
  if (name.length > 100 && codePointLength(name) > 100) return false;

  const email = d.email;
  if (typeof email !== "string" || !EMAIL_RE.test(email)) return false;

  if ("role" in d) {
    const role = d.role;
    if (role !== "admin" && role !== "user" && role !== "guest") return false;
  }

  const tags = d.tags;
  if (!Array.isArray(tags) || tags.length > 10) return false;
  for (let i = 0; i < tags.length; i++) {
    if (typeof tags[i] !== "string") return false;
  }

  if ("address" in d) {
    const a = d.address;
    if (!isObject(a)) return false;
    if (!("street" in a) || !("city" in a)) return false;
    if (typeof a.street !== "string") return false;
    if (typeof a.city !== "string") return false;
    if ("zip" in a) {
      const zip = a.zip;
      if (typeof zip !== "string" || !ZIP_RE.test(zip)) return false;
    }
  }

  for (const k in d) {
    if (k !== "id" && k !== "name" && k !== "email" && k !== "role" && k !== "tags" && k !== "address") {
      return false;
    }
  }
  return true;
}

// List-output artifact (all errors, BASIC-style units). Every location pair is
// a constant; only /tags/{i}, the swept extra-property names, and error text
// for them are runtime-built.
export function userList(d: unknown): ListResult {
  if (!isObject(d)) {
    return {
      valid: false,
      errors: [{
        keywordLocation: "/type",
        absoluteKeywordLocation: USER + "/type",
        instanceLocation: "",
        error: "expected an object",
      }],
    };
  }
  const errors: OutputUnit[] = [];

  for (const req of ["id", "name", "email", "tags"] as const) {
    if (!(req in d)) {
      errors.push({
        keywordLocation: "/required",
        absoluteKeywordLocation: USER + "/required",
        instanceLocation: "",
        error: `missing required property '${req}'`,
      });
    }
  }

  if ("id" in d) {
    const id = d.id;
    if (typeof id !== "number" || !Number.isInteger(id)) {
      errors.push({
        keywordLocation: "/properties/id/type",
        absoluteKeywordLocation: USER + "/properties/id/type",
        instanceLocation: "/id",
        error: "expected an integer",
      });
    } else if (id < 1) {
      errors.push({
        keywordLocation: "/properties/id/minimum",
        absoluteKeywordLocation: USER + "/properties/id/minimum",
        instanceLocation: "/id",
        error: "must be >= 1",
      });
    }
  }

  if ("name" in d) {
    const name = d.name;
    if (typeof name !== "string") {
      errors.push({
        keywordLocation: "/properties/name/type",
        absoluteKeywordLocation: USER + "/properties/name/type",
        instanceLocation: "/name",
        error: "expected a string",
      });
    } else {
      if (name.length < 1) {
        errors.push({
          keywordLocation: "/properties/name/minLength",
          absoluteKeywordLocation: USER + "/properties/name/minLength",
          instanceLocation: "/name",
          error: "must be at least 1 character",
        });
      }
      if (name.length > 100 && codePointLength(name) > 100) {
        errors.push({
          keywordLocation: "/properties/name/maxLength",
          absoluteKeywordLocation: USER + "/properties/name/maxLength",
          instanceLocation: "/name",
          error: "must be at most 100 characters",
        });
      }
    }
  }

  if ("email" in d) {
    const email = d.email;
    if (typeof email !== "string") {
      errors.push({
        keywordLocation: "/properties/email/type",
        absoluteKeywordLocation: USER + "/properties/email/type",
        instanceLocation: "/email",
        error: "expected a string",
      });
    } else if (!EMAIL_RE.test(email)) {
      errors.push({
        keywordLocation: "/properties/email/pattern",
        absoluteKeywordLocation: USER + "/properties/email/pattern",
        instanceLocation: "/email",
        error: "does not match required pattern",
      });
    }
  }

  if ("role" in d) {
    const role = d.role;
    if (role !== "admin" && role !== "user" && role !== "guest") {
      errors.push({
        keywordLocation: "/properties/role/enum",
        absoluteKeywordLocation: USER + "/properties/role/enum",
        instanceLocation: "/role",
        error: "not one of the allowed values",
      });
    }
  }

  if ("tags" in d) {
    const tags = d.tags;
    if (!Array.isArray(tags)) {
      errors.push({
        keywordLocation: "/properties/tags/type",
        absoluteKeywordLocation: USER + "/properties/tags/type",
        instanceLocation: "/tags",
        error: "expected an array",
      });
    } else {
      if (tags.length > 10) {
        errors.push({
          keywordLocation: "/properties/tags/maxItems",
          absoluteKeywordLocation: USER + "/properties/tags/maxItems",
          instanceLocation: "/tags",
          error: "must have at most 10 items",
        });
      }
      for (let i = 0; i < tags.length; i++) {
        if (typeof tags[i] !== "string") {
          errors.push({
            keywordLocation: "/properties/tags/items/type",
            absoluteKeywordLocation: USER + "/properties/tags/items/type",
            instanceLocation: "/tags/" + i,
            error: "expected a string",
          });
        }
      }
    }
  }

  if ("address" in d) {
    const a = d.address;
    if (!isObject(a)) {
      errors.push({
        keywordLocation: "/properties/address/type",
        absoluteKeywordLocation: USER + "/properties/address/type",
        instanceLocation: "/address",
        error: "expected an object",
      });
    } else {
      for (const req of ["street", "city"] as const) {
        if (!(req in a)) {
          errors.push({
            keywordLocation: "/properties/address/required",
            absoluteKeywordLocation: USER + "/properties/address/required",
            instanceLocation: "/address",
            error: `missing required property '${req}'`,
          });
        }
      }
      if ("street" in a && typeof a.street !== "string") {
        errors.push({
          keywordLocation: "/properties/address/properties/street/type",
          absoluteKeywordLocation: USER + "/properties/address/properties/street/type",
          instanceLocation: "/address/street",
          error: "expected a string",
        });
      }
      if ("city" in a && typeof a.city !== "string") {
        errors.push({
          keywordLocation: "/properties/address/properties/city/type",
          absoluteKeywordLocation: USER + "/properties/address/properties/city/type",
          instanceLocation: "/address/city",
          error: "expected a string",
        });
      }
      if ("zip" in a) {
        const zip = a.zip;
        if (typeof zip !== "string") {
          errors.push({
            keywordLocation: "/properties/address/properties/zip/type",
            absoluteKeywordLocation: USER + "/properties/address/properties/zip/type",
            instanceLocation: "/address/zip",
            error: "expected a string",
          });
        } else if (!ZIP_RE.test(zip)) {
          errors.push({
            keywordLocation: "/properties/address/properties/zip/pattern",
            absoluteKeywordLocation: USER + "/properties/address/properties/zip/pattern",
            instanceLocation: "/address/zip",
            error: "does not match required pattern",
          });
        }
      }
    }
  }

  for (const k in d) {
    if (!USER_PROPS.has(k)) {
      errors.push({
        keywordLocation: "/additionalProperties",
        absoluteKeywordLocation: USER + "/additionalProperties",
        instanceLocation: "/" + k.replace(/~/g, "~0").replace(/\//g, "~1"),
        error: "additional properties are not allowed",
      });
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Schema 2: https://spike.example/event
// ---------------------------------------------------------------------------

const EVENT = "https://spike.example/event#";
// Static analysis result: every applicator contributing evaluated names is
// statically resolvable, so unevaluatedProperties lowers to one constant set.
const EVENT_EVALUATED = new Set(["kind", "id", "actor", "createdAt", "updatedAt"]);

export function eventFlag(d: unknown): boolean {
  if (!isObject(d)) return false;

  // /allOf/0/$ref -> #/$defs/base
  if (!("id" in d) || !("actor" in d)) return false;
  if (typeof d.id !== "string") return false;
  if (typeof d.actor !== "string") return false;

  // /allOf/1/$ref -> #/$defs/timestamps
  if (!("createdAt" in d)) return false;
  if (typeof d.createdAt !== "string") return false;
  if ("updatedAt" in d && typeof d.updatedAt !== "string") return false;

  // /properties, /required
  if (!("kind" in d)) return false;
  const kind = d.kind;
  if (kind !== "created" && kind !== "updated" && kind !== "deleted") return false;

  // /unevaluatedProperties, lowered to the static evaluated-name set
  // (emitted as an equality chain below a size threshold, Set.has above it)
  for (const k in d) {
    if (k !== "kind" && k !== "id" && k !== "actor" && k !== "createdAt" && k !== "updatedAt") {
      return false;
    }
  }
  return true;
}

// Note the keywordLocation values crossing the $ref: constants that no runtime
// bookkeeping produced — the compiler knew the evaluation path at emit time.
export function eventList(d: unknown): ListResult {
  if (!isObject(d)) {
    return {
      valid: false,
      errors: [{
        keywordLocation: "/type",
        absoluteKeywordLocation: EVENT + "/type",
        instanceLocation: "",
        error: "expected an object",
      }],
    };
  }
  const errors: OutputUnit[] = [];

  for (const req of ["id", "actor"] as const) {
    if (!(req in d)) {
      errors.push({
        keywordLocation: "/allOf/0/$ref/required",
        absoluteKeywordLocation: EVENT + "/$defs/base/required",
        instanceLocation: "",
        error: `missing required property '${req}'`,
      });
    }
  }
  if ("id" in d && typeof d.id !== "string") {
    errors.push({
      keywordLocation: "/allOf/0/$ref/properties/id/type",
      absoluteKeywordLocation: EVENT + "/$defs/base/properties/id/type",
      instanceLocation: "/id",
      error: "expected a string",
    });
  }
  if ("actor" in d && typeof d.actor !== "string") {
    errors.push({
      keywordLocation: "/allOf/0/$ref/properties/actor/type",
      absoluteKeywordLocation: EVENT + "/$defs/base/properties/actor/type",
      instanceLocation: "/actor",
      error: "expected a string",
    });
  }

  if (!("createdAt" in d)) {
    errors.push({
      keywordLocation: "/allOf/1/$ref/required",
      absoluteKeywordLocation: EVENT + "/$defs/timestamps/required",
      instanceLocation: "",
      error: "missing required property 'createdAt'",
    });
  } else if (typeof d.createdAt !== "string") {
    errors.push({
      keywordLocation: "/allOf/1/$ref/properties/createdAt/type",
      absoluteKeywordLocation: EVENT + "/$defs/timestamps/properties/createdAt/type",
      instanceLocation: "/createdAt",
      error: "expected a string",
    });
  }
  if ("updatedAt" in d && typeof d.updatedAt !== "string") {
    errors.push({
      keywordLocation: "/allOf/1/$ref/properties/updatedAt/type",
      absoluteKeywordLocation: EVENT + "/$defs/timestamps/properties/updatedAt/type",
      instanceLocation: "/updatedAt",
      error: "expected a string",
    });
  }

  if (!("kind" in d)) {
    errors.push({
      keywordLocation: "/required",
      absoluteKeywordLocation: EVENT + "/required",
      instanceLocation: "",
      error: "missing required property 'kind'",
    });
  } else {
    const kind = d.kind;
    if (kind !== "created" && kind !== "updated" && kind !== "deleted") {
      errors.push({
        keywordLocation: "/properties/kind/enum",
        absoluteKeywordLocation: EVENT + "/properties/kind/enum",
        instanceLocation: "/kind",
        error: "not one of the allowed values",
      });
    }
  }

  for (const k in d) {
    if (!EVENT_EVALUATED.has(k)) {
      errors.push({
        keywordLocation: "/unevaluatedProperties",
        absoluteKeywordLocation: EVENT + "/unevaluatedProperties",
        instanceLocation: "/" + k.replace(/~/g, "~0").replace(/\//g, "~1"),
        error: "unevaluated properties are not allowed",
      });
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Schema 3: https://spike.example/profile
// ---------------------------------------------------------------------------

const PROFILE = "https://spike.example/profile#";

export function profileFlag(d: unknown): boolean {
  if (!isObject(d)) return false;
  if (!("id" in d) || typeof d.id !== "string") return false;
  if ("displayName" in d && typeof d.displayName !== "string") return false;
  if ("bio" in d && typeof d.bio !== "string") return false;
  if ("createdAt" in d && typeof d.createdAt !== "string") return false;
  return true;
}

// Annotation artifact specialized to the retention policy
//   { keywords: ["readOnly", "default"] }   (title is dropped at compile time).
// Annotations only escape when the schema succeeds (dropping semantics); with
// per-property assertions, subschema failure implies whole-schema failure here,
// so the compiler hoists the validity gate to the front.
export function profileAnnotated(d: unknown): AnnotatedResult {
  if (!isObject(d)) {
    return {
      valid: false,
      errors: [{
        keywordLocation: "/type",
        absoluteKeywordLocation: PROFILE + "/type",
        instanceLocation: "",
        error: "expected an object",
      }],
    };
  }
  const errors: OutputUnit[] = [];
  if (!("id" in d)) {
    errors.push({
      keywordLocation: "/required",
      absoluteKeywordLocation: PROFILE + "/required",
      instanceLocation: "",
      error: "missing required property 'id'",
    });
  } else if (typeof d.id !== "string") {
    errors.push({
      keywordLocation: "/properties/id/type",
      absoluteKeywordLocation: PROFILE + "/properties/id/type",
      instanceLocation: "/id",
      error: "expected a string",
    });
  }
  if ("displayName" in d && typeof d.displayName !== "string") {
    errors.push({
      keywordLocation: "/properties/displayName/type",
      absoluteKeywordLocation: PROFILE + "/properties/displayName/type",
      instanceLocation: "/displayName",
      error: "expected a string",
    });
  }
  if ("bio" in d && typeof d.bio !== "string") {
    errors.push({
      keywordLocation: "/properties/bio/type",
      absoluteKeywordLocation: PROFILE + "/properties/bio/type",
      instanceLocation: "/bio",
      error: "expected a string",
    });
  }
  if ("createdAt" in d && typeof d.createdAt !== "string") {
    errors.push({
      keywordLocation: "/properties/createdAt/type",
      absoluteKeywordLocation: PROFILE + "/properties/createdAt/type",
      instanceLocation: "/createdAt",
      error: "expected a string",
    });
  }
  if (errors.length > 0) return { valid: false, errors };

  const annotations: OutputUnit[] = [];
  if ("id" in d) {
    annotations.push({
      keywordLocation: "/properties/id/readOnly",
      absoluteKeywordLocation: PROFILE + "/properties/id/readOnly",
      instanceLocation: "/id",
      annotation: true,
    });
  }
  if ("displayName" in d) {
    annotations.push({
      keywordLocation: "/properties/displayName/default",
      absoluteKeywordLocation: PROFILE + "/properties/displayName/default",
      instanceLocation: "/displayName",
      annotation: "",
    });
  }
  if ("bio" in d) {
    annotations.push({
      keywordLocation: "/properties/bio/default",
      absoluteKeywordLocation: PROFILE + "/properties/bio/default",
      instanceLocation: "/bio",
      annotation: "",
    });
  }
  if ("createdAt" in d) {
    annotations.push({
      keywordLocation: "/properties/createdAt/readOnly",
      absoluteKeywordLocation: PROFILE + "/properties/createdAt/readOnly",
      instanceLocation: "/createdAt",
      annotation: true,
    });
  }
  return { valid: true, annotations };
}
