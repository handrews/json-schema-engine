// URI helpers: the reference-resolution parse every lookup goes through.
// `splitFragment` skips percent-decoding on `%`-free fragments; the result
// must be byte-identical to decoding for every input.

import { describe, it, expect } from "vitest";
import {
  resolveSplit,
  splitFragment,
  UnresolvableRefError,
} from "../src/uri.js";

describe("splitFragment", () => {
  it("returns a null fragment when there is none", () => {
    expect(splitFragment("https://a.example/s")).toEqual({
      resource: "https://a.example/s",
      fragment: null,
    });
  });

  it("returns an empty fragment for a bare '#'", () => {
    expect(splitFragment("https://a.example/s#")).toEqual({
      resource: "https://a.example/s",
      fragment: "",
    });
  });

  it("leaves a %-free fragment untouched, including '~' escapes", () => {
    expect(splitFragment("https://a.example/s#/a~1b/c~0d").fragment).toBe(
      "/a~1b/c~0d",
    );
    expect(splitFragment("https://a.example/s#anchor").fragment).toBe("anchor");
  });

  it("decodes percent-escapes when present", () => {
    expect(splitFragment("https://a.example/s#/a%20b").fragment).toBe("/a b");
    expect(splitFragment("https://a.example/s#/%7E1").fragment).toBe("/~1");
  });

  it("still throws URIError on a malformed escape", () => {
    expect(() => splitFragment("https://a.example/s#/%zz")).toThrow(URIError);
  });
});

describe("resolveSplit", () => {
  it("resolves then splits", () => {
    expect(resolveSplit("#/$defs/x", "https://a.example/s")).toEqual({
      resource: "https://a.example/s",
      fragment: "/$defs/x",
    });
    expect(resolveSplit("other#a", "https://a.example/dir/s")).toEqual({
      resource: "https://a.example/dir/other",
      fragment: "a",
    });
  });

  it("throws UnresolvableRefError when the pair is not a URI", () => {
    expect(() => resolveSplit("x", "not a base")).toThrow(UnresolvableRefError);
  });
});
