# V2.6 implementation constraints

- Preserve the uncommitted V2.5 baseline recorded in `baseline.json`.
- Card order: 210 → 211 → 212 → 213 → 214; advance only after each card's gates.
- Reuse ProviderStore and its credential backend. CLI already references local-server; local-server must not import CLI and form a cycle. Keep CLI import compatibility through re-exports if the implementation is relocated.
- Provider HTTP DTOs must never expose keys or secret references. Short keys must be fully masked. Errors must not echo request bodies, upstream response bodies, or credential-bearing URLs.
- Probes must validate HTTP(S) URLs, reject embedded credentials, avoid forwarding keys on redirects, use bounded timeouts, and exercise actual authentication (401 is failure). Ollama permits a blank key on loopback.
- Tests use isolated temporary stores, fake credentials, and injected fetch/provider implementations; no external agents or real model calls.
- Dynamic switching must affect actual outgoing requests and truthful session metadata while retaining history, permission, and policy. Reject changes during active work; unknown providers/models must fail explicitly.
- UI evidence must include actual rendered English/Chinese flows and responsive layout, independently of component tests.
- Final gates run after the last source/test edit; the saved runner records logs and checks protected hashes. No commit, push, publication, or permanent deletion.
