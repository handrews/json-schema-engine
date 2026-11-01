// The evaluation-path chain: parent-linked, pre-escaped segments whose
// pointer string is materialized on first use and cached on the node, so
// every record and the trace node of one application pay for it once.

import { describe, it, expect } from "vitest";
import { materializePath, type PathNode } from "@json-schema-engine/core";

const chain = (...segments: string[]): PathNode | null => {
  let node: PathNode | null = null;
  for (const segment of segments) node = { parent: node, segment };
  return node;
};

describe("materializePath", () => {
  it("joins the chain into a JSON Pointer; the root path is empty", () => {
    expect(materializePath(null)).toBe("");
    expect(materializePath(chain("properties"))).toBe("/properties");
    expect(materializePath(chain("allOf", "0", "properties", "b"))).toBe(
      "/allOf/0/properties/b",
    );
    // Segments arrive pre-escaped.
    expect(materializePath(chain("properties", "a~1b"))).toBe(
      "/properties/a~1b",
    );
  });

  it("caches the path on the node", () => {
    const node = chain("properties", "a")!;
    const first = materializePath(node);
    expect(first).toBe("/properties/a");
    expect(node.path).toBe(first);
    expect(materializePath(node)).toBe(first);
  });

  it("fills in a partially cached chain", () => {
    const parent: PathNode = { parent: null, segment: "properties" };
    expect(materializePath(parent)).toBe("/properties");
    const middle: PathNode = { parent, segment: "a" };
    const deep: PathNode = { parent: middle, segment: "items" };
    expect(materializePath(deep)).toBe("/properties/a/items");
    // The intermediate node was filled on the way back down.
    expect(middle.path).toBe("/properties/a");
  });

  it("stores a shared prefix once", () => {
    // `items` over an array mints one node per element under one shared
    // parent: after the first, each sibling is one concatenation.
    const parent = chain("anyOf", "0")!;
    const left: PathNode = { parent, segment: "items" };
    const right: PathNode = { parent, segment: "items" };
    expect(materializePath(left)).toBe("/anyOf/0/items");
    expect(parent.path).toBe("/anyOf/0");
    expect(materializePath(right)).toBe("/anyOf/0/items");
  });

  it("materializes a deep chain without recursing", () => {
    let node: PathNode | null = null;
    for (let i = 0; i < 5000; i++) node = { parent: node, segment: String(i) };
    const path = materializePath(node);
    expect(path.startsWith("/0/1/2/")).toBe(true);
    expect(path.endsWith("/4999")).toBe(true);
  });
});
