# 0003: Output levels and orthogonal output controls

**Status:** accepted 2026-09-05 (owner decision).

## Context

IETF draft-03 §13 defines `flag`, `basic`, `detailed`, and `verbose`; the
[machines-oriented proposal](https://github.com/json-schema-org/json-schema-spec/blob/4f56a9900674b27804f0ec32e3b7fdfa4efad695/specs/output/jsonschema-validation-output-machines.md)
defines `flag`, `list`, and `hierarchical`. Output formats are under active
debate in the IETF process, and more additions and changes are expected before
the final RFC. Draft-03's special treatment of `verbose` (§12, §12.2,
§13.4.4: it includes irrelevant evaluations and forbids short-circuiting) is
groundwork for verbosity as a control independent of format. JSE's current
options mix format, field vocabulary, verbosity, annotation retention, and
detail inclusion in one surface, and silently ignore unsupported
combinations.

## Decision

- **Formats are selected by name.** The names are `flag`, `basic`,
  `detailed`, `verbose` (draft-03 §13) and `list`, `hierarchical`
  (machines-oriented proposal). `flag` is identical in both sources; the
  others are unique across both. Each name fixes structure and field
  vocabulary. Provenance is documented for users; no "family" concept exists
  in the API or the documentation beyond that note.
- **Three output levels organize the formats:** _minimal_ (validation only:
  `flag`), _relevant_ (non-verbose, non-flag: `basic`, `detailed`, `list`,
  `hierarchical`), and _verbose_ (`verbose`; `list` and `hierarchical` under
  verbose demand; the diagnostic trace). Output at the verbose level includes
  irrelevant annotations and errors. The level, not the format name, drives
  evaluation demand.
- **Relevance is evaluation semantics** (§12.2). The verbose level decides
  only whether irrelevant records are rendered; rendered irrelevant records
  carry an explicit marker.
- **Annotation selection** (allow/deny by keyword and vocabulary, predicate)
  is a control independent of level and relevance. It never changes relevance
  or dependency information (channel rule 5). It may be pushed into
  evaluation as an optimization.
- **Further independent controls:** structured error params; vocabulary
  identity alongside keyword names; source position inclusion, and separately
  whether positions are collected at load time (parse cost).
- **Every combination of controls is either supported in both tiers or
  rejected with a typed error.** No silent no-ops.
- **Short-circuiting is permitted iff** load-time analysis shows no
  annotation demand and no dependency impact, **and** the runtime
  configuration has no verbose demand (§12; a flat conjunction). _Verbose
  demand_ is any control that requires irrelevant evaluations to be
  recorded. The diagnostic trace is a rendering of the full evaluation
  record and is therefore verbose demand, not a fourth term.

## Alternatives

- Group formats into two families with a family selector. Rejected: too
  detailed for most users and likely to break down as formats change.
- Treat `verbose` only as a format name. Rejected: `list` and `hierarchical`
  need verbose variants, and the machines proposal's `droppedAnnotations`
  covers only discarded annotations, not irrelevant errors or irrelevant
  successful evaluations.
- Keep the "unless the skipped evaluation can be represented faithfully"
  short-circuit exception. Rejected: §12 has no such exception.

## Evidence

- Draft-03 §12 (short-circuit conditions), §12.2 (relevance), §13.4
  (irrelevant units omitted unless the structure requires them; §13.4.4
  recommends `valid` per node so consumers can tell relevant units apart).
- Probe (2026-09-05, built `@jse/core`): with
  `anyOf: [{type:"string"}, {type:"number", title:"num"}]` and input `5`,
  `output:"list"` and `"hierarchical"` include the failing `/anyOf/0` error
  unit in a valid result; the `locations:"2020-12"` path omits it only
  because it renders errors solely when the run is invalid.
- Output-control census (2026-09-05): `verbose` is a render-only boolean on
  `hierarchical`; `retention` allow/deny lists are pushed into the record
  predicate; `errorParams` and `vocabulary` are available on flat units only;
  unsupported combinations are silent no-ops
  (`packages/core/src/index.ts:219-226`).

## Consequences

- The output-model investigation defines the control model over the
  reconciled records (E2) and absorbs E9.
- `basic` and `detailed` are relevant-level and `verbose` is verbose-level by
  definition; `list` and `hierarchical` exist at both levels. Which further
  combinations exist is an investigation output.
- Documentation states each format's source and that the formats are under
  IETF debate.
- Goldens are regenerated per format × level.

## Compatibility

`output`, `locations`, `verbose`, `collectAnnotations`, and `retention`
change shape; migration notes are a release deliverable. The compiled
`basic()` accessor and the draft-03 location fields that oaskit reads are
kept or migrated in coordination with oaskit.

## Follow-up

- Third-party format extension (the TypeScript story) is post-release.
- Streaming (E11) builds on the relevance marker and stable unit identity.
