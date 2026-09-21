// Official JSON-Schema-Test-Suite verdict runner for the external comparison
// (docs/comparisons/ata-validator-and-json-schema-library.md): the same
// vendored suite commit, the same remotes, the same per-tier configuration,
// through jse, ata-validator, and json-schema-library.
//
// Every group in tests/<draft>/ (required), tests/<draft>/optional/ and
// tests/<draft>/optional/format/ runs. Format assertion is on only for the
// format tier; defaults and coercion are off everywhere; a schema that fails
// to compile counts each of its tests as an error. Only verdicts are compared.
//
// Run: npm run compare:conformance [-- jse|ata|jsl]   (default: all three)
// Writes bench/external/results/conformance-<subject>.json with every failure.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import {
  FORMATS_2020_12,
  FORMATS_2019_09,
  FORMATS_DRAFT_07,
  FORMATS_DRAFT_06,
  FORMATS_DRAFT_04,
} from "@json-schema-engine/formats";
import { registerDraft04 } from "@json-schema-engine/dialect-draft04";
import { Validator as AtaValidator } from "ata-validator";
import {
  compileSchema,
  draft04,
  draft06,
  draft07,
  draft2019,
  draft2020,
  type JsonSchema,
} from "json-schema-library";
import { addFormats } from "json-schema-library/formats";
import { remotes as jslMetaschemas } from "json-schema-library/remotes";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITE = join(HERE, "..", "..", "test-suite");
const REMOTES = join(SUITE, "remotes");
const RESULTS = join(HERE, "results");

const SUBJECTS = ["jse", "ata", "jsl"] as const;
type SubjectName = (typeof SUBJECTS)[number];

const DRAFTS: Record<string, string> = {
  "draft2020-12": "https://json-schema.org/draft/2020-12/schema",
  "draft2019-09": "https://json-schema.org/draft/2019-09/schema",
  draft7: "http://json-schema.org/draft-07/schema#",
  draft6: "http://json-schema.org/draft-06/schema#",
  draft4: "http://json-schema.org/draft-04/schema#",
};

type Category = "required" | "optional" | "format";

interface Group {
  description: string;
  schema: JsonValue;
  tests: { description: string; data: JsonValue; valid: boolean }[];
}

// The suite serves remotes from http://localhost:1234/<path>.
const remoteRegistry: Record<string, JsonValue> = {};
(function collect(dir: string, prefix: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, prefix + entry.name + "/");
    else if (entry.name.endsWith(".json")) {
      remoteRegistry["http://localhost:1234/" + prefix + entry.name] =
        JSON.parse(readFileSync(full, "utf8")) as JsonValue;
    }
  }
})(REMOTES, "");

const isObject = (v: JsonValue): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// The suite states the dialect by directory, not in every schema.
const withDialect = (schema: JsonValue, dialect: string): JsonValue =>
  isObject(schema) && !("$schema" in schema)
    ? { $schema: dialect, ...schema }
    : schema;

/** Builds one verdict function per group, or throws on compile failure. */
type Build = (
  schema: JsonValue,
  draft: string,
  category: Category,
  retrievalUri: string,
) => Promise<(data: JsonValue) => boolean>;

function makeSubject(subject: SubjectName): Build {
  if (subject === "jse") {
    const tables = {
      "draft2020-12": FORMATS_2020_12,
      "draft2019-09": FORMATS_2019_09,
      draft7: FORMATS_DRAFT_07,
      draft6: FORMATS_DRAFT_06,
      draft4: FORMATS_DRAFT_04,
    } as const;
    const loader = (uri: string): { value: JsonValue } | undefined =>
      uri in remoteRegistry ? { value: remoteRegistry[uri]! } : undefined;
    return async (schema, draft, category, retrievalUri) => {
      const engine = createEngine({
        defaultDialect: DRAFTS[draft],
        loaders: [loader],
        formats: tables[draft as keyof typeof tables],
        assertFormats: category === "format",
      });
      if (draft === "draft4") registerDraft04(engine);
      const uri = await engine.loadSchema(schema, retrievalUri);
      return (data) => engine.evaluate(uri, data).valid;
    };
  }
  if (subject === "ata") {
    // Boolean schemas are valid groups; the constructor's overloads take
    // `object | string | boolean`, which JsonValue does not narrow to.
    return (schema, draft, category) => {
      const v = new AtaValidator(withDialect(schema, DRAFTS[draft]!) as never, {
        schemas: remoteRegistry as Record<string, object>,
        assertFormat: category === "format",
        useDefaults: false,
      });
      return Promise.resolve((data: JsonValue) => v.validate(data).valid);
    };
  }
  // json-schema-library: formats beyond its core set come from the
  // `formats` entry; metaschemas from the `remotes` entry; suite remotes are
  // registered on a shared node, as its own spec runner does.
  addFormats([draft04, draft06, draft07, draft2019, draft2020]);
  return (schema, draft, category) => {
    const $schema = DRAFTS[draft]!;
    const shared = compileSchema({});
    for (const meta of jslMetaschemas) {
      const m = meta as Record<string, unknown>;
      const id = typeof m.$id === "string" ? m.$id : String(m.id);
      shared.addRemoteSchema(id, meta);
    }
    for (const [id, doc] of Object.entries(remoteRegistry)) {
      const remote: JsonSchema = isObject(doc)
        ? { $schema, ...doc }
        : (doc as unknown as JsonSchema);
      shared.addRemoteSchema(id, remote);
    }
    const node = compileSchema(
      withDialect(schema, $schema) as unknown as JsonSchema,
      {
        remote: shared,
        formatAssertion: category === "format",
        throwOnInvalidSchema: true,
        throwOnInvalidRef: true,
      },
    );
    return Promise.resolve((data: JsonValue) => node.validate(data).valid);
  };
}

interface Tally {
  run: number;
  pass: number;
  fail: number;
  error: number;
}

interface Failure {
  draft: string;
  category: Category;
  file: string;
  group: string;
  test: string;
  detail: string;
}

async function runSubject(subject: SubjectName): Promise<void> {
  const build = makeSubject(subject);
  const tallies: Record<string, Tally> = {};
  const failures: Failure[] = [];

  for (const draft of Object.keys(DRAFTS)) {
    const dir = join(SUITE, "tests", draft);
    const tiers: [Category, string][] = [
      ["required", dir],
      ["optional", join(dir, "optional")],
      ["format", join(dir, "optional", "format")],
    ];
    for (const [category, tierDir] of tiers) {
      const tally: Tally = { run: 0, pass: 0, fail: 0, error: 0 };
      tallies[`${draft}/${category}`] = tally;
      const files = readdirSync(tierDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const groups = JSON.parse(
          readFileSync(join(tierDir, file), "utf8"),
        ) as Group[];
        for (const [gi, group] of groups.entries()) {
          const record = (test: string, detail: string): void => {
            failures.push({
              draft,
              category,
              file,
              group: group.description,
              test,
              detail,
            });
          };
          let verdict: ((d: JsonValue) => boolean) | null = null;
          let buildError: string | null = null;
          try {
            verdict = await build(
              group.schema,
              draft,
              category,
              `https://suite.example/${draft}/${category}/${file}/${gi}`,
            );
          } catch (e) {
            buildError = `compile: ${(e as Error).message}`;
          }
          for (const test of group.tests) {
            tally.run++;
            if (buildError !== null) {
              tally.error++;
              record(test.description, buildError);
              continue;
            }
            try {
              const got = verdict!(test.data);
              if (got === test.valid) tally.pass++;
              else {
                tally.fail++;
                record(test.description, `expected ${test.valid}, got ${got}`);
              }
            } catch (e) {
              tally.error++;
              record(
                test.description,
                `threw: ${(e as Error).message.slice(0, 200)}`,
              );
            }
          }
        }
      }
    }
  }

  console.log(`\nsubject: ${subject}`);
  console.table(tallies);
  const perFile = new Map<string, number>();
  for (const f of failures) {
    const key = `${f.draft} ${f.category} ${f.file}`;
    perFile.set(key, (perFile.get(key) ?? 0) + 1);
  }
  for (const [key, n] of perFile)
    console.log(`  ${String(n).padStart(4)}  ${key}`);
  mkdirSync(RESULTS, { recursive: true });
  const out = join(RESULTS, `conformance-${subject}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      {
        subject,
        generatedAt: new Date().toISOString(),
        node: process.version,
        tallies,
        failures,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`failures: ${failures.length} (${out})`);
}

const requested = process.argv[2];
const subjects: readonly SubjectName[] =
  requested === undefined ? SUBJECTS : SUBJECTS.filter((s) => s === requested);
if (subjects.length === 0) {
  console.error(`usage: conformance.ts [${SUBJECTS.join("|")}]`);
  process.exit(2);
}
for (const s of subjects) await runSubject(s);
