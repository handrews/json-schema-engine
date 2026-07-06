// Bowtie IO-protocol harness (version 1) for @jse/core: line-delimited JSON
// commands on stdin, one response per command on stdout. Case registries are
// served to the engine as a loader, so remote refs and $schema/metaschema
// references resolve exactly the way real loaders do (D7).

import * as readline from "node:readline";
import { createEngine, JsonValue, SchemaLoader } from "../packages/core/src/index.js";

const DIALECT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
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

let currentDialect = DIALECT_2020_12;

const send = (response: unknown): void => {
  process.stdout.write(JSON.stringify(response) + "\n");
};

const errorContext = (e: unknown) => ({
  message: e instanceof Error ? e.message : String(e),
  traceback: e instanceof Error ? e.stack ?? "" : "",
});

async function handle(line: string): Promise<void> {
  const request = JSON.parse(line) as Record<string, unknown>;
  switch (request.cmd) {
    case "start": {
      send({
        version: 1,
        implementation: {
          language: "javascript",
          name: "jse",
          version: "0.0.0",
          dialects: [DIALECT_2020_12],
          homepage: "https://github.com/handrews/json-schema-engine",
          issues: "https://github.com/handrews/json-schema-engine/issues",
          source: "https://github.com/handrews/json-schema-engine",
        },
      });
      return;
    }
    case "dialect": {
      currentDialect = request.dialect as string;
      send({ ok: request.dialect === DIALECT_2020_12 });
      return;
    }
    case "run": {
      const seq = request.seq;
      try {
        const testCase = request.case as unknown as BowtieCase;
        const registry = testCase.registry ?? {};
        const loader: SchemaLoader = (uri) =>
          Object.hasOwn(registry, uri)
            ? { value: registry[uri] as JsonValue }
            : undefined;
        const engine = createEngine({
          defaultDialect: currentDialect, loaders: [loader],
        });
        const uri = await engine.loadSchema(
          testCase.schema as JsonValue, RETRIEVAL_URI);
        const results = testCase.tests.map((test) => {
          try {
            return { valid: engine.evaluate(uri, test.instance as JsonValue).valid };
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
