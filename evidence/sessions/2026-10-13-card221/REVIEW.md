# Card 221 independent review

Read-only evaluator: `review` subagent. No evaluator edits or test processes.

Initial findings and resolutions:

- Active L2 lacked provider capability analysis: added shared capability requirements, validated compiler model profiles, actual effective provider/hub wiring, and rejection before model switch activation. A routed-provider regression prevents checking the original provider when dispatch uses another one.
- Assertion evidence could certify a changed snapshot: results now require the candidate snapshot hash; its fingerprint includes behavior, enforcement and model profile. Verified additionally requires an explicit trusted policy revision because function source cannot identify arbitrary closed-over state.
- Critical assertions could be invented: critical runtime constraints require assertion IDs registered by the trusted evaluator.
- Same-session reads could remain stale: the read-only refresh action retrieves current L4 evidence; stale session responses remain discarded.

Final evaluator verdict: PASS, no remaining actionable findings in the reviewed changes. Full-suite and browser acceptance are separate gates.
