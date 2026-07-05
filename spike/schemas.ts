// The three spike schemas (ANALYSIS.md §13.1) plus valid/invalid instances.
// All are 2020-12 documents; schema 1 is deliberately draft-07-*shaped* (no
// 2020-12-only features) to represent the AJV-migration corpus.

export const DIALECT = "https://json-schema.org/draft/2020-12/schema";

// 1. API-payload shape: properties/required/enum/pattern/items/nesting,
//    additionalProperties: false.
export const userSchema = {
  $schema: DIALECT,
  $id: "https://spike.example/user",
  type: "object",
  required: ["id", "name", "email", "tags"],
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 100 },
    email: { type: "string", pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
    role: { enum: ["admin", "user", "guest"] },
    tags: { type: "array", items: { type: "string" }, maxItems: 10 },
    address: {
      type: "object",
      required: ["street", "city"],
      properties: {
        street: { type: "string" },
        city: { type: "string" },
        zip: { type: "string", pattern: "^[0-9]{5}$" },
      },
    },
  },
  additionalProperties: false,
} as const;

export const userValid = {
  id: 42,
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "admin",
  tags: ["math", "computing"],
  address: { street: "12 St James's Sq", city: "London", zip: "12345" },
};

// Fails mid-evaluation (bad email pattern).
export const userInvalid = {
  id: 42,
  name: "Ada Lovelace",
  email: "not-an-email",
  role: "admin",
  tags: ["math", "computing"],
  address: { street: "12 St James's Sq", city: "London", zip: "12345" },
};

// Multiple failures for all-errors comparisons.
export const userInvalidMulti = {
  id: 0,
  name: "",
  email: "not-an-email",
  role: "root",
  tags: ["math", 7],
  address: { street: "12 St James's Sq" },
  extra: true,
};

// 2. 2020-12 composition: $ref into $defs + allOf + unevaluatedProperties.
//    Statically analyzable: the evaluated-name set is a compile-time constant.
export const eventSchema = {
  $schema: DIALECT,
  $id: "https://spike.example/event",
  type: "object",
  allOf: [{ $ref: "#/$defs/base" }, { $ref: "#/$defs/timestamps" }],
  properties: {
    kind: { enum: ["created", "updated", "deleted"] },
  },
  required: ["kind"],
  unevaluatedProperties: false,
  $defs: {
    base: {
      type: "object",
      required: ["id", "actor"],
      properties: {
        id: { type: "string" },
        actor: { type: "string" },
      },
    },
    timestamps: {
      type: "object",
      required: ["createdAt"],
      properties: {
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
      },
    },
  },
} as const;

export const eventValid = {
  kind: "created",
  id: "evt-1042",
  actor: "ada",
  createdAt: "2026-07-05T12:00:00Z",
  updatedAt: "2026-07-05T12:30:00Z",
};

// Fails only at the unevaluatedProperties sweep (worst case for the compiled
// form: everything else must be evaluated first).
export const eventInvalid = {
  kind: "created",
  id: "evt-1042",
  actor: "ada",
  createdAt: "2026-07-05T12:00:00Z",
  payload: { anything: true },
};

// 3. Annotation-heavy: title/readOnly/default throughout. The compiled
//    "annotated" artifact is specialized to a retention policy that keeps
//    readOnly and default but drops title.
export const profileSchema = {
  $schema: DIALECT,
  $id: "https://spike.example/profile",
  title: "User profile",
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", title: "Identifier", readOnly: true },
    displayName: { type: "string", title: "Display name", default: "" },
    bio: { type: "string", title: "Biography", default: "" },
    createdAt: { type: "string", title: "Created", readOnly: true },
  },
} as const;

export const profileValid = {
  id: "u-7",
  displayName: "Ada",
  createdAt: "2026-07-05T12:00:00Z",
};

export const profileInvalid = {
  id: "u-7",
  displayName: 42,
};
