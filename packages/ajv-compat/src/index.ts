// @jse/ajv-compat (M8): AJV v8's public API surface over the engine. The
// compat class owns a config ledger and rebuilds its Engine lazily when
// schema/keyword/format state changes (AJV also recompiles in those
// cases). Every emulated behavior is pinned against executed-AJV fixtures
// (test/oracle) — AJV source is never read (D15). The
// AJV-implementation-coupled surface (code-style keywords, $data, $async,
// JTD) fails loudly with a typed error instead of approximating.

import {
  createEngine,
  DIALECT_2019_09,
  DIALECT_2020_12,
  DIALECT_DRAFT_07,
  SchemaValidationError,
  type Engine,
  type ErrorParams,
  type FormatDefinition,
  type FormatTable,
  type JsonValue,
  type JsonType,
  type KeywordBehavior,
  type SchemaLoader,
} from "@jse/core";
import {
  compileList,
  compileValidator,
  type CompiledListArtifact,
} from "@jse/compiler";
import { mapErrors, type AjvErrorObject } from "./errors.js";
import {
  anyMutation,
  runMutationFixpoint,
  type MutationOptions,
} from "./mutate.js";
import {
  checkDiscriminators,
  discriminatedOneOf,
  discriminatorBehavior,
} from "./discriminator.js";

export type { AjvErrorObject } from "./errors.js";
export type ErrorObject = AjvErrorObject;
export { default as addFormats } from "./formats.js";
export { default as ajvErrors } from "./ajv-errors.js";
export { default as ajvKeywords } from "./ajv-keywords.js";

/**
 * Guards the invariant AJV's public contract depends on: `errors` is
 * non-empty whenever `valid` is false. The flag tier decides pass/fail
 * fast; on failure the list tier re-evaluates to collect error detail. If
 * the flag tier says invalid but the list tier reports zero errors, the
 * two tiers disagree — exactly the defect class the differential fuzzer
 * (scripts/fuzz.ts) exists to catch at build time. Surfacing it here
 * instead of silently returning `errors: []` turns a contract violation
 * into a loud bug report instead of a caller-visible correctness bug.
 */
export function assertTierAgreement(valid: boolean, errors: unknown[]): void {
  if (!valid && errors.length === 0) {
    throw new Error(
      "ajv-compat: flag-tier validator (compileValidator) reported invalid, " +
        "but the list tier (compileList) produced no errors. This is a " +
        "tier-agreement bug in @jse/compiler or @jse/core, not a schema " +
        "problem — please file a bug report with the schema and instance " +
        "that triggered this.",
    );
  }
}

/** Thrown for AJV surface this adapter deliberately does not emulate. */
export class AjvCompatUnsupportedError extends Error {
  constructor(feature: string, reason: string) {
    super(
      `ajv-compat does not support ${feature}: ${reason} ` +
        "(see the migration guide, docs/guide/ajv-migration.md)",
    );
    this.name = "AjvCompatUnsupportedError";
  }
}

export interface AjvLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** AJV constructor options — the emulated + accepted subset. */
export interface Options {
  allErrors?: boolean;
  verbose?: boolean;
  messages?: boolean;
  strict?: boolean | "log";
  strictSchema?: boolean | "log";
  validateFormats?: boolean;
  validateSchema?: boolean | "log";
  allowUnionTypes?: boolean;
  logger?: AjvLogger | false;
  schemas?: JsonValue[] | Record<string, JsonValue>;
  formats?: Record<string, Format>;
  keywords?: KeywordDefinition[];
  addUsedSchema?: boolean;
  loadSchema?: (uri: string) => Promise<JsonValue>;
  // M8.3 (mutation trio) — accepted here, wired there.
  coerceTypes?: boolean | "array";
  useDefaults?: boolean | "empty";
  removeAdditional?: boolean | "all" | "failing";
  /** OpenAPI-style oneOf branch selection (M8.4; see discriminator.ts) */
  discriminator?: boolean;
  // Loud failure.
  $data?: boolean;
  // Accepted-and-ignored codegen/perf hints.
  inlineRefs?: boolean | number;
  loopRequired?: number;
  loopEnum?: number;
  ownProperties?: boolean;
  unicodeRegExp?: boolean;
  multipleOfPrecision?: number;
  code?: Record<string, unknown>;
  meta?: boolean;
  addUsedVocabularies?: boolean;
}

export type Format =
  | string
  | RegExp
  | ((value: string) => boolean)
  | {
      type?: "string" | "number";
      validate: string | RegExp | ((value: string) => boolean);
      compare?: (a: string, b: string) => number;
      async?: boolean;
    };

export interface KeywordDefinition {
  keyword: string | string[];
  type?: string | string[];
  schemaType?: string | string[];
  validate?: (
    schema: JsonValue,
    data: JsonValue,
    parentSchema?: Record<string, JsonValue>,
  ) => boolean;
  compile?: (
    schema: JsonValue,
    parentSchema: Record<string, JsonValue>,
  ) => (data: JsonValue) => boolean;
  macro?: (
    schema: JsonValue,
    parentSchema: Record<string, JsonValue>,
  ) => JsonValue;
  code?: unknown;
  error?: { message?: string };
  errors?: boolean;
  valid?: boolean;
  metaSchema?: JsonValue;
  modifying?: boolean;
  async?: boolean;
  $data?: boolean;
  before?: string;
  post?: string;
  implements?: string[];
}

export interface ValidateFunction {
  (data: JsonValue): boolean;
  errors: ErrorObject[] | null;
  schema: JsonValue;
}

interface CompiledEntry {
  fn: ValidateFunction;
  uri: string;
}

const COMPAT_VOCAB = "urn:ajv-compat:keywords";
const COMPAT_DIALECT = "urn:ajv-compat:dialect";

/**
 * Keywords AJV's strict mode treats as known for the supported dialects,
 * beyond dialect keyword tables: `$vocabulary` etc. arrive through the
 * dialect itself, so only the schema-position walk needs this list.
 */
const DESCEND_OBJECT_VALUES = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
]);
const DESCEND_SELF = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "not",
  "contains",
  "if",
  "then",
  "else",
  "items",
  "additionalItems",
]);
const DESCEND_ARRAY = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

export class Ajv {
  readonly opts: Options;
  errors: ErrorObject[] | null = null;

  private readonly logger: AjvLogger;
  private readonly docs = new Map<string, JsonValue>(); // key/uri → schema
  private readonly metaDocs = new Map<string, JsonValue>();
  private readonly customFormats = new Map<string, Format>();
  private readonly customKeywords = new Map<string, KeywordDefinition>();
  private engineCache: Engine | null = null;
  private readonly compiledByObject = new WeakMap<object, CompiledEntry>();
  private readonly compiledByRef = new Map<string, CompiledEntry>();
  private anonymousCount = 0;
  /** ajv-errors' hook (M8.4): applied to the mapped error list, after mapErrors. */
  private errorPostProcessor?: (
    errors: AjvErrorObject[],
    instance: JsonValue,
    schema: JsonValue,
    rootSchemaPath: string,
  ) => AjvErrorObject[];

  constructor(opts: Options = {}) {
    this.opts = { ...opts };
    this.logger =
      opts.logger === false
        ? {
            log: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          }
        : (opts.logger ?? console);
    if (opts.$data === true) {
      throw new AjvCompatUnsupportedError(
        "$data references",
        "keyword values sourced from the instance are excluded by design",
      );
    }
    if (opts.multipleOfPrecision !== undefined) {
      this.logger.warn(
        "ajv-compat: multipleOfPrecision is ignored — multipleOf uses exact decimal-scaled comparison",
      );
    }
    for (const [name, format] of Object.entries(opts.formats ?? {})) {
      this.addFormat(name, format);
    }
    for (const def of opts.keywords ?? []) this.addKeyword(def);
    const schemas = opts.schemas;
    if (Array.isArray(schemas)) {
      for (const s of schemas) this.addSchema(s);
    } else if (schemas !== undefined) {
      for (const [key, s] of Object.entries(schemas)) this.addSchema(s, key);
    }
  }

  /** dialect URI for this class's draft (AJV's class-per-draft split) */
  protected dialectUri(): string {
    return DIALECT_DRAFT_07;
  }

  // ---- schema management -------------------------------------------------

  addSchema(schema: JsonValue | JsonValue[], key?: string): this {
    if (Array.isArray(schema)) {
      for (const s of schema) this.addSchema(s);
      return this;
    }
    const id =
      key ??
      (typeof schema === "object" &&
      schema !== null &&
      typeof (schema as Record<string, JsonValue>).$id === "string"
        ? ((schema as Record<string, JsonValue>).$id as string)
        : undefined);
    if (id === undefined) {
      throw new Error("schema must have $id or be passed with a key");
    }
    this.docs.set(id, schema);
    this.invalidate();
    return this;
  }

  addMetaSchema(schema: JsonValue, key?: string): this {
    const id =
      key ?? ((schema as Record<string, JsonValue>).$id as string | undefined);
    if (id === undefined) {
      throw new Error("meta-schema must have $id or be passed with a key");
    }
    this.metaDocs.set(id, schema);
    this.invalidate();
    return this;
  }

  getSchema(keyRef: string): ValidateFunction | undefined {
    const cached = this.compiledByRef.get(keyRef);
    if (cached) return cached.fn;
    if (!this.docs.has(keyRef)) return undefined;
    const fn = this.compileAt(this.docs.get(keyRef)!, keyRef);
    return fn;
  }

  removeSchema(schemaKeyRef?: string | RegExp | JsonValue): this {
    if (schemaKeyRef === undefined) {
      this.docs.clear();
    } else if (schemaKeyRef instanceof RegExp) {
      for (const key of [...this.docs.keys()]) {
        if (schemaKeyRef.test(key)) this.docs.delete(key);
      }
    } else if (typeof schemaKeyRef === "string") {
      this.docs.delete(schemaKeyRef);
    } else {
      for (const [key, doc] of [...this.docs.entries()]) {
        if (doc === schemaKeyRef) this.docs.delete(key);
      }
    }
    this.invalidate();
    return this;
  }

  validateSchema(schema: JsonValue): boolean {
    try {
      const engine = createEngine({
        defaultDialect: this.dialectUri(),
        validateSchemas: true,
      });
      for (const [key, doc] of this.metaDocs) engine.registerSchema(doc, key);
      engine.registerSchema(
        schema,
        `urn:ajv-compat:validate-schema:${String(this.anonymousCount++)}`,
      );
      this.errors = null;
      return true;
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        this.errors = [
          {
            keyword: "$schema",
            instancePath: "",
            schemaPath: "",
            params: {},
            message: err.message,
          },
        ];
        return false;
      }
      throw err;
    }
  }

  // ---- compilation and validation ----------------------------------------

  compile(schema: JsonValue): ValidateFunction {
    if (typeof schema === "object" && schema !== null) {
      const hit = this.compiledByObject.get(schema);
      if (hit) return hit.fn;
    }
    return this.compileAt(schema);
  }

  async compileAsync(schema: JsonValue): Promise<ValidateFunction> {
    const load = this.opts.loadSchema;
    if (load === undefined) {
      throw new Error("options.loadSchema should be a function");
    }
    // Loader adapter: AJV's loadSchema returns the schema value; the
    // engine's loaders return LoadedDocuments and crawl transitively.
    const loader: SchemaLoader = async (resource) => {
      try {
        return { value: await load(resource) };
      } catch {
        return undefined;
      }
    };
    const engine = this.buildEngine([loader]);
    const uri = await engine.loadSchema(
      schema,
      this.rootUriFor(schema),
      this.compileDialect(engine),
    );
    return this.makeValidate(engine, uri, schema);
  }

  validate(schemaOrRef: JsonValue | string, data: JsonValue): boolean {
    let fn: ValidateFunction;
    if (typeof schemaOrRef === "string") {
      const found = this.getSchema(schemaOrRef);
      if (found === undefined) {
        throw new Error(`no schema with key or ref "${schemaOrRef}"`);
      }
      fn = found;
    } else {
      fn = this.compile(schemaOrRef);
    }
    const ok = fn(data);
    this.errors = fn.errors;
    return ok;
  }

  errorsText(
    errors: ErrorObject[] | null = this.errors,
    opts: { separator?: string; dataVar?: string } = {},
  ): string {
    if (!errors || errors.length === 0) return "No errors";
    const separator = opts.separator ?? ", ";
    const dataVar = opts.dataVar ?? "data";
    return errors
      .map((e) => `${dataVar}${e.instancePath} ${e.message ?? ""}`)
      .join(separator);
  }

  // ---- formats and keywords ----------------------------------------------

  addFormat(name: string, format: Format): this {
    if (typeof format === "object" && !(format instanceof RegExp)) {
      if (format.async === true) {
        throw new AjvCompatUnsupportedError(
          `async format "${name}"`,
          "evaluation is synchronous by design",
        );
      }
    }
    this.customFormats.set(name, format);
    this.invalidate();
    return this;
  }

  addKeyword(definition: string | KeywordDefinition): this {
    const def: KeywordDefinition =
      typeof definition === "string" ? { keyword: definition } : definition;
    const names = Array.isArray(def.keyword) ? def.keyword : [def.keyword];
    if (def.code !== undefined) {
      throw new AjvCompatUnsupportedError(
        `code-style keyword "${names.join(",")}"`,
        "KeywordCxt/codegen keywords are AJV-implementation-coupled; port to validate/compile/macro",
      );
    }
    if (def.$data === true) {
      throw new AjvCompatUnsupportedError(
        `$data on keyword "${names.join(",")}"`,
        "keyword values sourced from the instance are excluded by design",
      );
    }
    if (def.async === true) {
      throw new AjvCompatUnsupportedError(
        `async keyword "${names.join(",")}"`,
        "evaluation is synchronous by design",
      );
    }
    if (def.modifying === true) {
      throw new AjvCompatUnsupportedError(
        `modifying keyword "${names.join(",")}"`,
        "arrives with the mutation milestone (M8.3)",
      );
    }
    if (def.macro !== undefined) {
      throw new AjvCompatUnsupportedError(
        `macro keyword "${names.join(",")}"`,
        "macro expansion arrives with the companion milestone (M8.4); port to validate/compile meanwhile",
      );
    }
    for (const name of names) this.customKeywords.set(name, def);
    this.invalidate();
    return this;
  }

  getKeyword(keyword: string): KeywordDefinition | boolean {
    return this.customKeywords.get(keyword) ?? false;
  }

  removeKeyword(keyword: string): this {
    if (!this.customKeywords.delete(keyword)) {
      throw new AjvCompatUnsupportedError(
        `removeKeyword("${keyword}") for a built-in keyword`,
        "dialects assemble from whole vocabularies; removing single built-ins is not emulated",
      );
    }
    this.invalidate();
    return this;
  }

  addVocabulary(definitions: KeywordDefinition[]): this {
    for (const def of definitions) this.addKeyword(def);
    return this;
  }

  /**
   * ajv-errors' integration point (M8.4; see ajv-errors.ts): registers a
   * pass over the mapped error list and marks `errorMessage` as a known
   * (annotation-only) keyword for strict mode — it never reaches the
   * engine as a real keyword, since ajv-errors.ts post-processes the
   * already-mapped AJV error objects instead.
   */
  setErrorPostProcessor(
    processor: (
      errors: AjvErrorObject[],
      instance: JsonValue,
      schema: JsonValue,
      rootSchemaPath: string,
    ) => AjvErrorObject[],
  ): void {
    this.errorPostProcessor = processor;
  }

  // ---- internals -----------------------------------------------------------

  private invalidate(): void {
    this.engineCache = null;
    this.compiledByRef.clear();
  }

  private formatTable(): FormatTable | undefined {
    if (this.customFormats.size === 0) return undefined;
    const table: Record<string, FormatDefinition> = {};
    for (const [name, format] of this.customFormats) {
      table[name] = toFormatDefinition(name, format);
    }
    return table;
  }

  private compatBehaviors(): Record<string, KeywordBehavior> | undefined {
    if (this.customKeywords.size === 0 && this.opts.discriminator !== true) {
      return undefined;
    }
    const behaviors: Record<string, KeywordBehavior> = {};
    for (const [name, def] of this.customKeywords) {
      behaviors[name] = toBehavior(name, def, this.opts.$data === true);
    }
    if (this.opts.discriminator === true) {
      behaviors.discriminator = discriminatorBehavior;
      // Replaces the base dialect's oneOf entirely (COMPAT_VOCAB is merged
      // in last, so same-name entries win — see dialect.ts registerDialect).
      behaviors.oneOf = discriminatedOneOf;
    }
    return behaviors;
  }

  private compileDialect(engine: Engine): string {
    const behaviors = this.compatBehaviors();
    if (behaviors === undefined) return this.dialectUri();
    const base = engine.dialects.getDialect(this.dialectUri());
    engine.registerVocabulary(COMPAT_VOCAB, behaviors);
    engine.registerDialect(COMPAT_DIALECT, [
      ...base.vocabularyUris,
      COMPAT_VOCAB,
    ]);
    return COMPAT_DIALECT;
  }

  private buildEngine(extraLoaders: readonly SchemaLoader[] = []): Engine {
    const formats = this.formatTable();
    const engine = createEngine({
      defaultDialect: this.dialectUri(),
      ...(formats === undefined
        ? {}
        : {
            formats,
            assertFormats: this.opts.validateFormats !== false,
          }),
      ...(this.opts.validateSchema === false ? {} : { validateSchemas: true }),
      ...(extraLoaders.length > 0 ? { loaders: extraLoaders } : {}),
    });
    for (const [key, doc] of this.metaDocs) engine.registerSchema(doc, key);
    const dialect = this.compileDialect(engine);
    for (const [key, doc] of this.docs) {
      engine.registerSchema(doc, key, dialect);
    }
    return engine;
  }

  private engine(): Engine {
    this.engineCache ??= this.buildEngine();
    return this.engineCache;
  }

  private rootUriFor(schema: JsonValue): string {
    const id =
      typeof schema === "object" &&
      schema !== null &&
      typeof (schema as Record<string, JsonValue>).$id === "string"
        ? ((schema as Record<string, JsonValue>).$id as string)
        : undefined;
    return id ?? `urn:ajv-compat:anonymous:${String(this.anonymousCount++)}`;
  }

  private compileAt(schema: JsonValue, key?: string): ValidateFunction {
    this.strictSchemaCheck(schema);
    if (this.opts.discriminator === true) {
      // Same eager timing as AJV: discriminator's structural requirements
      // throw from compile(), before any data is validated (oracle:
      // ajv.compile() itself throws for these, never validate()). Local
      // pointer resolution only — cross-document $ref branches route
      // through the real engine at evaluation time (discriminatorBehavior).
      checkDiscriminators(schema, (ref) => ({
        node: resolveLocalPointer(schema, ref),
      }));
    }
    const engine = this.engine();
    const retrieval = key ?? this.rootUriFor(schema);
    const uri = engine.registerSchema(
      schema,
      retrieval,
      this.compatBehaviors() === undefined ? undefined : COMPAT_DIALECT,
    );
    const fn = this.makeValidate(engine, uri, schema);
    if (typeof schema === "object" && schema !== null) {
      this.compiledByObject.set(schema, { fn, uri });
    }
    if (key !== undefined) this.compiledByRef.set(key, { fn, uri });
    const id = (schema as Record<string, JsonValue> | null)?.$id;
    if (typeof id === "string" && this.opts.addUsedSchema !== false) {
      this.compiledByRef.set(id, { fn, uri });
    }
    return fn;
  }

  private makeValidate(
    engine: Engine,
    uri: string,
    schema: JsonValue,
  ): ValidateFunction {
    // Fast path: flag artifact (fail-fast, zero allocation). Errors are the
    // exceptional path — the list artifact compiles lazily on first failure.
    const listArtifact: { current: CompiledListArtifact | null } = {
      current: null,
    };
    const flagArtifact = compileValidator(engine, uri);
    const rootBase = engine.registry.rootRef(uri).baseUri;
    const resolveSchema = (location: string): JsonValue | undefined => {
      const hash = location.indexOf("#");
      const base = location.slice(0, hash);
      const pointer = location.slice(hash + 1);
      const doc =
        base === rootBase ? schema : (this.docs.get(base) ?? undefined);
      return doc === undefined ? undefined : walkPointer(doc, pointer);
    };
    const opts = this.opts;
    const mutations: MutationOptions = {
      coerceTypes: opts.coerceTypes,
      useDefaults: opts.useDefaults,
      removeAdditional: opts.removeAdditional,
    };
    const mutating = anyMutation(mutations);
    const fn = ((data: JsonValue): boolean => {
      let instance = data;
      if (mutating) {
        // In-place nested mutation, like AJV; a coerced TOP-LEVEL value
        // only changes the validated value, never the caller's binding
        // (fixture: coerce-top-level-scalar).
        const holder = { value: data };
        runMutationFixpoint(engine, uri, holder, mutations, resolveSchema);
        instance = holder.value;
      }
      const flagValid = flagArtifact.validate(instance);
      if (flagValid) {
        fn.errors = null;
        return true;
      }
      listArtifact.current ??= compileList(engine, uri, { errorParams: true });
      const { errors } = listArtifact.current.evaluateList(instance);
      assertTierAgreement(flagValid, errors);
      let mapped = mapErrors(errors, instance, {
        rootBaseUri: rootBase,
        resolveSchema,
        allErrors: opts.allErrors === true,
        verbose: opts.verbose === true,
        messages: opts.messages !== false,
      });
      if (this.errorPostProcessor !== undefined) {
        mapped = this.errorPostProcessor(mapped, instance, schema, "#");
      }
      fn.errors = mapped;
      return false;
    }) as ValidateFunction;
    fn.errors = null;
    fn.schema = schema;
    return fn;
  }

  /**
   * strict-mode subset (D14: compat may enable AJV-implied hygiene):
   * unknown keywords and unknown formats reject at compile time like
   * AJV's strictSchema default. The walk descends the standard applicator
   * positions only — dialect-registered custom keywords are known.
   */
  private strictSchemaCheck(schema: JsonValue): void {
    const mode = this.opts.strictSchema ?? this.opts.strict ?? true;
    if (mode === false) return;
    const report = (msg: string): void => {
      if (mode === "log") this.logger.warn(`strict mode: ${msg}`);
      else throw new Error(`strict mode: ${msg}`);
    };
    const dialect = this.engine().dialects.getDialect(this.dialectUri());
    const known = new Set(dialect.ordered.map((e) => e.name));
    for (const name of this.customKeywords.keys()) known.add(name);
    if (this.opts.discriminator === true) known.add("discriminator");
    if (this.errorPostProcessor !== undefined) known.add("errorMessage");
    const formats = this.formatTable();
    const checkFormats = this.opts.validateFormats !== false;
    const visit = (node: JsonValue): void => {
      if (typeof node !== "object" || node === null || Array.isArray(node))
        return;
      const obj = node as Record<string, JsonValue>;
      for (const [key, value] of Object.entries(obj)) {
        if (!known.has(key)) {
          report(`unknown keyword: "${key}"`);
          continue;
        }
        if (key === "format" && typeof value === "string" && checkFormats) {
          if (formats?.[value] === undefined) {
            report(`unknown format "${value}" ignored in schema`);
          }
        }
        if (DESCEND_OBJECT_VALUES.has(key)) {
          if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            for (const sub of Object.values(value)) visit(sub);
          }
        } else if (DESCEND_ARRAY.has(key)) {
          if (Array.isArray(value)) for (const sub of value) visit(sub);
        } else if (DESCEND_SELF.has(key)) {
          if (Array.isArray(value)) for (const sub of value) visit(sub);
          else visit(value);
        }
      }
    };
    visit(schema);
  }
}

/** 2019-09 class (AJV's Ajv2019). */
export class Ajv2019 extends Ajv {
  protected override dialectUri(): string {
    return DIALECT_2019_09;
  }
}

/** 2020-12 class (AJV's Ajv2020). */
export class Ajv2020 extends Ajv {
  protected override dialectUri(): string {
    return DIALECT_2020_12;
  }
}

export default Ajv;

// ---- helpers ----------------------------------------------------------------

const walkPointer = (
  doc: JsonValue,
  pointer: string,
): JsonValue | undefined => {
  let node: JsonValue | undefined = doc;
  if (pointer === "") return node;
  for (const raw of pointer.slice(1).split("/")) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(node)) node = node[Number(seg)];
    else if (typeof node === "object" && node !== null)
      node = (node as Record<string, JsonValue>)[seg];
    else return undefined;
  }
  return node;
};

/** Same-document "#/..." fragment resolution for the eager discriminator
 * check (compileAt runs before schema registration, so the real engine's
 * cross-document resolver isn't available yet). */
const resolveLocalPointer = (doc: JsonValue, ref: string): JsonValue => {
  const hash = ref.indexOf("#");
  const pointer = hash === -1 ? "" : ref.slice(hash + 1);
  const target = walkPointer(doc, pointer);
  if (target === undefined) {
    throw new Error(`discriminator: cannot resolve "${ref}"`);
  }
  return target;
};

const toFormatDefinition = (name: string, format: Format): FormatDefinition => {
  const test = (validate: Format): ((v: string) => boolean) => {
    if (typeof validate === "string") {
      const re = new RegExp(validate);
      return (v) => re.test(v);
    }
    if (validate instanceof RegExp) return (v) => validate.test(v);
    if (typeof validate === "function") return validate;
    return test(validate.validate);
  };
  const types: readonly (JsonType | "integer")[] =
    typeof format === "object" &&
    !(format instanceof RegExp) &&
    format.type === "number"
      ? ["number"]
      : ["string"];
  const check = test(format);
  return {
    types,
    test: (value) => check(value as string),
  };
};

/** Object-style AJV keyword definition → engine KeywordBehavior. */
const toBehavior = (
  name: string,
  def: KeywordDefinition,
  _dataOption: boolean,
): KeywordBehavior => {
  const types =
    def.type === undefined
      ? null
      : Array.isArray(def.type)
        ? def.type
        : [def.type];
  const applies = (value: JsonValue): boolean => {
    if (types === null) return true;
    const t = Array.isArray(value)
      ? "array"
      : value === null
        ? "null"
        : typeof value === "number" &&
            Number.isInteger(value) &&
            types.includes("integer")
          ? "integer"
          : typeof value;
    return types.includes(t);
  };
  return {
    id: `${COMPAT_VOCAB}#${name}`,
    evaluate: (value, cursor, ctx) => {
      const data = cursor.value;
      if (!applies(data)) return true;
      if (def.valid !== undefined) {
        if (!def.valid) ctx.error(defaultMessage(name, def));
        return def.valid;
      }
      let ok: boolean;
      let reported: { message?: string; params?: ErrorParams }[] | undefined;
      if (def.compile !== undefined) {
        const compiled = def.compile(value, ctx.schema);
        ok = compiled(data);
      } else if (def.validate !== undefined) {
        const validateFn = def.validate;
        ok = validateFn(value, data, ctx.schema);
        const errs = (
          validateFn as unknown as {
            errors?: { message?: string; params?: ErrorParams }[] | null;
          }
        ).errors;
        reported = errs ?? undefined;
      } else {
        ok = true; // passive keyword (addKeyword("name") form)
      }
      if (!ok) {
        if (def.errors !== false && reported !== undefined) {
          for (const e of reported) {
            ctx.error(e.message ?? defaultMessage(name, def), e.params);
          }
        } else {
          ctx.error(defaultMessage(name, def));
        }
      }
      return ok;
    },
  };
};

const defaultMessage = (name: string, def: KeywordDefinition): string =>
  def.error?.message ?? `must pass "${name}" keyword validation`;
