// Bowtie IO-protocol harness (version 1) for @json-schema-engine/core: line-delimited JSON
// commands on stdin, one response per command on stdout. Case registries are
// served to the engine as a loader, so remote refs and $schema/metaschema
// references resolve exactly the way real loaders do (D7).

import * as readline from "node:readline";
import {
  createEngine,
  JsonValue,
  SchemaLoader,
} from "@json-schema-engine/core";
import {
  registerDraft04,
  DIALECT_DRAFT_04,
} from "@json-schema-engine/dialect-draft04";

const DIALECTS = [
  "https://json-schema.org/draft/2020-12/schema",
  "https://json-schema.org/draft/2019-09/schema",
  "http://json-schema.org/draft-07/schema",
  "http://json-schema.org/draft-06/schema",
  DIALECT_DRAFT_04,
];
// Neutral base for case schemas without $id; http-scheme so relative
// references resolve through URL.
const RETRIEVAL_URI = "https://bowtie.example/schema";

interface BowtieTest {
  description: string;
  instance: unknown;
}
interface BowtieCase {
  description: string;
  schema: unknown;
  registry?: Record<string, unknown>;
  tests: BowtieTest[];
}

let currentDialect = DIALECTS[0]!;

const send = (response: unknown): void => {
  process.stdout.write(JSON.stringify(response) + "\n");
};

const errorContext = (e: unknown) => ({
  message: e instanceof Error ? e.message : String(e),
  traceback: e instanceof Error ? (e.stack ?? "") : "",
});

async function handle(line: string): Promise<void> {
  const request = JSON.parse(line) as Record<string, unknown>;
  switch (request.cmd) {
    case "start": {
      send({
        version: 1,
        implementation: {
          language: "javascript",
          name: "json-schema-engine",
          version: "0.0.5",
          dialects: DIALECTS,
          homepage: "https://github.com/handrews/json-schema-engine",
          issues: "https://github.com/handrews/json-schema-engine/issues",
          source: "https://github.com/handrews/json-schema-engine",
        },
      });
      return;
    }
    case "dialect": {
      // Bowtie sends legacy dialect URIs in their canonical "…schema#" form;
      // the engine registers dialects fragment-free, and the draft-04
      // registration guard below compares exactly.
      currentDialect = (request.dialect as string).replace(/#$/, "");
      send({ ok: DIALECTS.includes(currentDialect) });
      return;
    }
    case "run": {
      const seq = request.seq;
      try {
        const testCase = request.case as BowtieCase;
        const registry = testCase.registry ?? {};
        const loader: SchemaLoader = (uri) =>
          Object.hasOwn(registry, uri)
            ? { value: registry[uri] as JsonValue }
            : undefined;
        const engine = createEngine({
          defaultDialect: currentDialect,
          loaders: [loader],
        });
        // draft-04 lives in its own package (D11/M10); every other dialect
        // is built into core.
        if (currentDialect === DIALECT_DRAFT_04) registerDraft04(engine);
        const uri = await engine.loadSchema(
          testCase.schema as JsonValue,
          RETRIEVAL_URI,
        );
        const results = testCase.tests.map((test) => {
          try {
            return {
              valid: engine.evaluate(uri, test.instance as JsonValue).valid,
            };
          } catch (e) {
            return { errored: true, context: errorContext(e) };
          }
        });
        send({ seq, results });
      } catch (e) {
        send({ seq, errored: true, context: errorContext(e) });
      }
      return;
    }
    case "stop": {
      process.exit(0);
    }
  }
}

// Bowtie awaits each response before sending the next command, but chain
// anyway so responses can never interleave.
let chain: Promise<void> = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  chain = chain.then(() => handle(line));
});
