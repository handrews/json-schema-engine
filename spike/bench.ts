// F1 spike harness: correctness oracle + benchmarks (ANALYSIS.md §13.1).
// Run with: npm run bench

import { Bench } from "tinybench";
import Ajv2020Mod from "ajv/dist/2020.js";
// CJS interop: at runtime module.exports is the class and also carries .default,
// but ajv's own types declare `.default` as always present, so TS can't see this
// as a real possibility.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const Ajv2020 = Ajv2020Mod.default ?? Ajv2020Mod;
import { registerSchema, validate } from "@hyperjump/json-schema/draft-2020-12";
import { BASIC } from "@hyperjump/json-schema/experimental";
import { annotate } from "@hyperjump/json-schema/annotations/experimental";

import {
  userSchema, userValid, userInvalid, userInvalidMulti,
  eventSchema, eventValid, eventInvalid,
  profileSchema, profileValid, profileInvalid,
} from "./schemas.js";
import {
  userFlag, userList, eventFlag, eventList, profileFlag, profileAnnotated,
} from "./compiled.js";

// --- Set up competitors ----------------------------------------------------

const tCompileAjv = performance.now();
const ajv = new Ajv2020();
const ajvUser = ajv.compile(userSchema);
const ajvEvent = ajv.compile(eventSchema);
const ajvProfile = ajv.compile(profileSchema);
const ajvCompileMs = performance.now() - tCompileAjv;

const ajvAll = new Ajv2020({ allErrors: true });
const ajvUserAll = ajvAll.compile(userSchema);

const tCompileHj = performance.now();
registerSchema(userSchema as never);
registerSchema(eventSchema as never);
registerSchema(profileSchema as never);
const hjUser = await validate("https://spike.example/user");
const hjEvent = await validate("https://spike.example/event");
const hjProfile = await validate("https://spike.example/profile");
const hjCompileMs = performance.now() - tCompileHj;

const hjAnnotateProfile = await annotate("https://spike.example/profile");

// --- Correctness oracle ----------------------------------------------------
// Every implementation must agree on every verdict before any timing counts.

let oracleFailures = 0;
function expectVerdict(
  label: string,
  expected: boolean,
  verdicts: Record<string, boolean>,
): void {
  for (const [impl, got] of Object.entries(verdicts)) {
    if (got !== expected) {
      oracleFailures++;
      console.error(`ORACLE FAIL: ${label}: ${impl} said ${got}, expected ${expected}`);
    }
  }
}

expectVerdict("user/valid", true, {
  ours: userFlag(userValid),
  oursList: userList(userValid).valid,
  ajv: ajvUser(userValid),
  hyperjump: hjUser(userValid).valid,
});
expectVerdict("user/invalid", false, {
  ours: userFlag(userInvalid),
  oursList: userList(userInvalid).valid,
  ajv: ajvUser(userInvalid),
  hyperjump: hjUser(userInvalid).valid,
});
expectVerdict("user/invalidMulti", false, {
  ours: userFlag(userInvalidMulti),
  oursList: userList(userInvalidMulti).valid,
  ajv: ajvUser(userInvalidMulti),
  hyperjump: hjUser(userInvalidMulti).valid,
});
expectVerdict("event/valid", true, {
  ours: eventFlag(eventValid),
  oursList: eventList(eventValid).valid,
  ajv: ajvEvent(eventValid),
  hyperjump: hjEvent(eventValid).valid,
});
expectVerdict("event/invalid", false, {
  ours: eventFlag(eventInvalid),
  oursList: eventList(eventInvalid).valid,
  ajv: ajvEvent(eventInvalid),
  hyperjump: hjEvent(eventInvalid).valid,
});
expectVerdict("profile/valid", true, {
  ours: profileFlag(profileValid),
  oursAnnotated: profileAnnotated(profileValid).valid,
  ajv: ajvProfile(profileValid),
  hyperjump: hjProfile(profileValid).valid,
});
expectVerdict("profile/invalid", false, {
  ours: profileFlag(profileInvalid),
  oursAnnotated: profileAnnotated(profileInvalid).valid,
  ajv: ajvProfile(profileInvalid),
  hyperjump: hjProfile(profileInvalid).valid,
});

if (oracleFailures > 0) {
  console.error(`\n${oracleFailures} oracle failure(s) — benchmarks aborted.`);
  process.exit(1);
}
console.log("Oracle: all implementations agree on all verdicts.\n");

// Spot-check output content for the SPIKE.md record.
console.log("Sample ours/list unit (event/invalid):",
  JSON.stringify(eventList(eventInvalid).errors![0]));
console.log("Sample hyperjump BASIC unit (event/invalid):",
  JSON.stringify((hjEvent(eventInvalid, BASIC) as { errors?: unknown[] }).errors?.[0]));
console.log("Ours annotations (profile/valid):",
  JSON.stringify(profileAnnotated(profileValid).annotations));
console.log();

// --- Benchmarks --------------------------------------------------------------

interface Group {
  name: string;
  gated: boolean; // participates in the ajv-ratio gate
  tasks: Record<string, () => unknown>;
}

const groups: Group[] = [
  {
    name: "user valid (flag)", gated: true, tasks: {
      "ours(compiled)": () => userFlag(userValid),
      "ajv": () => ajvUser(userValid),
      "hyperjump": () => hjUser(userValid),
    },
  },
  {
    name: "user invalid (flag)", gated: true, tasks: {
      "ours(compiled)": () => userFlag(userInvalid),
      "ajv": () => ajvUser(userInvalid),
      "hyperjump": () => hjUser(userInvalid),
    },
  },
  {
    name: "event valid (flag)", gated: true, tasks: {
      "ours(compiled)": () => eventFlag(eventValid),
      "ajv": () => ajvEvent(eventValid),
      "hyperjump": () => hjEvent(eventValid),
    },
  },
  {
    name: "event invalid (flag)", gated: true, tasks: {
      "ours(compiled)": () => eventFlag(eventInvalid),
      "ajv": () => ajvEvent(eventInvalid),
      "hyperjump": () => hjEvent(eventInvalid),
    },
  },
  {
    name: "user invalidMulti (all errors w/ locations)", gated: false, tasks: {
      "ours(list)": () => userList(userInvalidMulti),
      "ajv(allErrors)": () => ajvUserAll(userInvalidMulti),
      "hyperjump(BASIC)": () => hjUser(userInvalidMulti, BASIC),
    },
  },
  {
    name: "profile valid (annotations)", gated: false, tasks: {
      "ours(annotated, retention={readOnly,default})": () => profileAnnotated(profileValid),
      "ours(flag, annotations compiled away)": () => profileFlag(profileValid),
      "hyperjump(annotate)": () => hjAnnotateProfile(profileValid),
    },
  },
];

const results: { group: Group; hz: Record<string, number> }[] = [];

for (const group of groups) {
  const bench = new Bench({ time: 300, warmupTime: 100 });
  for (const [name, fn] of Object.entries(group.tasks)) bench.add(name, fn);
  await bench.run();

  const hz: Record<string, number> = {};
  console.log(`## ${group.name}`);
  for (const task of bench.tasks) {
    const r = task.result;
    const opsSec = "latency" in r ? 1000 / r.latency.mean : NaN;
    hz[task.name] = opsSec;
    console.log(`  ${task.name.padEnd(45)} ${Math.round(opsSec).toLocaleString("en-US").padStart(14)} ops/s`);
  }
  results.push({ group, hz });
  console.log();
}

// --- Gate --------------------------------------------------------------------

console.log(`ajv compile time (3 schemas): ${ajvCompileMs.toFixed(1)} ms`);
console.log(`hyperjump register+compile time (3 schemas): ${hjCompileMs.toFixed(1)} ms`);
console.log("(ours: precompiled — models build-time/standalone emission)\n");

let gatePass = true;
for (const { group, hz } of results) {
  if (!group.gated) continue;
  const ours = hz["ours(compiled)"]!;
  const theirs = hz.ajv!;
  const ratio = theirs / ours;
  const ok = ratio <= 1.5;
  if (!ok) gatePass = false;
  console.log(`GATE ${ok ? "PASS" : "FAIL"}: ${group.name}: ajv/ours = ${ratio.toFixed(2)} (must be <= 1.50)`);
}
console.log(`\nOVERALL GATE: ${gatePass ? "PASS" : "FAIL"}`);
process.exit(gatePass ? 0 : 1);
