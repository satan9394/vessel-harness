# Card273 independent bounded source review

Verdict: **PASS within the requested hash-cache/provenance contract**. No concrete cache bypass identified. This is source review; no benchmark, compaction tests, tsc or other gates were rerun by this reviewer.

- `packages/shared/src/projection.ts:80-89` serializes every raw non-compaction record on each projection call, even after cache warm-up. In-place content/nested-field/seq changes replace that record's cached snapshot. Snapshot identity is therefore tied to current persisted JSON bytes rather than only mutable object identity.
- `packages/shared/src/projection.ts:90-96` selects the inclusive provenance seq interval, compares ordered snapshot identities and count, and recanonicalizes if selection, ordering or record bytes change. A warm-cache same-record content mutation cannot reuse the old range digest. Unchanged records reuse canonicalization only; current bytes are still checked. Recomputed source hash is compared with the committed provenance hash and throws the required `Compaction evidence hash mismatch` on disagreement.
- `packages/shared/src/projection.ts:77-79` rechecks summary/provenance integrity on every invocation; these values are not trusted through a cached receipt. `:102-104` retains metadata/provenance in the projected summary.
- `packages/context/src/compaction/Compaction.ts:113-124,152-153,176-177` retains full provenance metadata, canonical sourceHash over raw source records after JSON persistence normalization, source references and hash-bound summary. Replay uses the same exclusion of compaction/start and compaction/end and inclusive seq bounds, so sourceHash remains independently recomputable. Removing redundant provenance from the summary text does not remove its metadata receipt or important file/pending-authority references.
- `packages/context/src/compaction/recovery-golden.test.ts:53-73` independently recomputes sourceHash for both compactions and warms projection before all four mutations: summary, provenance pending refs, source record content, and sourceHash with recomputed outer summaryHash. This last case checks the independent source digest rather than merely failing the outer digest. Same cloned record objects are deliberately reused across warm-up and mutation.

Scope boundary: legacy receiptless commits remain accepted by the existing compatibility branch; hashes are integrity receipts, not authenticated signatures against an actor rewriting both data and hashes. This optimization does not broaden those existing guarantees. No product/core/config/task changes, resets/reverts, deletion, external agent CLI or gate execution performed. Only this evidence file written.

Reviewed byte hashes:

```text
bb32448df92c5a9f9f041352253fcbb08c2138885c671347aedd6b8f60f44f83  packages/shared/src/projection.ts
69bf951c010ca18f26758046867b793685876055c5f86a26ff6f28c309962d8b  packages/context/src/compaction/Compaction.ts
71cb83abe309852ddc5f18a316afa01d5fe50d7bde5730878cc41587a0415da8  packages/context/src/compaction/recovery-golden.test.ts
```

