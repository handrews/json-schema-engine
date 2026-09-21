// The worked example in docs/comparisons/ata-validator-and-json-schema-library.md
// ("Output and errors"): one schema, one invalid and one valid instance,
// through each library's error and annotation output. Prints JSON; compare
// by eye. Also demonstrates json-schema-library's `deprecated`-in-applicator
// verdict on the valid instance.
//
// Run: npm run compare:samples

import { createRequire } from "node:module";
import { createEngine, type JsonValue } from "@json-schema-engine/core";
import { compileList } from "@json-schema-engine/compiler";
import { Validator as AtaValidator } from "ata-validator";
import { compileSchema } from "json-schema-library";

const cjsRequire = createRequire(import.meta.url);
const { toOutput: ataToOutput } = cjsRequire("ata-validator") as {
  toOutput: (
    validator: AtaValidator,
    data: unknown,
    options: { format: "flag" | "basic" },
  ) => unknown;
};

const SCHEMA_ID = "https://example.com/order";
const schema: JsonValue = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: SCHEMA_ID,
  title: "Order",
  type: "object",
  properties: {
    id: { type: "string", title: "Identifier" },
    qty: { type: "integer", minimum: 1 },
  },
  required: ["id"],
  anyOf: [
    { properties: { kind: { const: "a" } }, required: ["kind"] },
    {
      properties: { note: { type: "string", deprecated: true } },
      required: ["note"],
    },
  ],
  unevaluatedProperties: false,
};

const bad: JsonValue = { qty: 0, kind: "b", extra: true };
const good: JsonValue = { id: "x", qty: 2, note: "hi" };

const codeOf = (x: { code: unknown }): string =>
  typeof x.code === "string" ? x.code : JSON.stringify(x.code);

const show = (label: string, value: unknown): void => {
  console.log(`\n--- ${label} ---\n${JSON.stringify(value, null, 1)}`);
};

// jse
const engine = createEngine();
const uri = engine.registerSchema(schema, SCHEMA_ID);
show(
  "jse list (flat errors)",
  engine.evaluate(uri, bad, { output: "list" }).errors,
);
show(
  "jse basic document (invalid)",
  engine.evaluate(uri, bad, { output: "basic" }).outputDocument,
);
show(
  "jse basic annotations (valid)",
  engine.evaluate(uri, good, { output: "basic", annotations: true })
    .outputDocument,
);
show(
  "jse hierarchical (invalid)",
  engine.evaluate(uri, bad, { output: "hierarchical" }).outputDocument,
);
const list = compileList(engine, uri, { errorParams: false });
show("jse compiled list (invalid)", list.evaluateList(bad));

// ata-validator
const ata = new AtaValidator(schema as never, {
  assertFormat: false,
  useDefaults: false,
});
console.log(`\nata engine: ${ata.engine()}`);
show("ata validate (invalid)", ata.validate(bad));
show(
  "ata toOutput basic (invalid)",
  ataToOutput(ata, bad, { format: "basic" }),
);
show("ata toOutput basic (valid)", ataToOutput(ata, good, { format: "basic" }));

// json-schema-library
const node = compileSchema(schema, {
  formatAssertion: false,
});
const jslBad = node.validate(bad);
show("jsl validate (invalid) — codes and pointers", {
  valid: jslBad.valid,
  errors: jslBad.errors.map((e) => `${codeOf(e)}@${e.data.pointer}`),
});
show("jsl validate (invalid) — first error in full", jslBad.errors[0]);
const jslGood = node.validate(good);
show("jsl validate (valid instance)", {
  valid: jslGood.valid,
  errors: jslGood.errors.map(codeOf),
  annotations: jslGood.annotations.map(codeOf),
});
const minimal = compileSchema({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  anyOf: [{ deprecated: true }],
});
show("jsl {anyOf: [{deprecated: true}]} on 1", minimal.validate(1).valid);
