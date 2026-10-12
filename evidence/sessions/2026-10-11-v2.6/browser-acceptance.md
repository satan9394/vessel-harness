# Integrated browser acceptance — PASS

Actual built Web UI at isolated loopback server 31826; temporary provider, usage, session, workspace and ProjectRegistry roots. Endpoint fixture served the OpenAI-compatible model catalog and streaming transport locally; no paid provider or external Agent process was invoked.

- Chinese empty catalog form showed offline demonstration plus Configure new model guidance.
- Entered temporary workspace and read-only permission; opened settings from that form.
- Selected Ollama preset, used keyless loopback URL, tested connection: success 26 milliseconds; discovered fixture-a and fixture-b; saved.
- Closed settings: original workspace/read-only values remained; real dropdown loaded both models.
- Created with fixture-a, sent first turn, switched to fixture-b, sent second turn; same session retained both messages/responses and selected fixture-b.
- Recorded transport observations independently: fixture-a messageCount 2, then fixture-b messageCount 4 (`browser-model-observations.jsonl`).
- Chinese and English snapshots saved. At 800px the document clientWidth and scrollWidth were both 800, with responsive Inspector dialog and closed-dialog conversation observed.
- Screenshots: `browser-integrated-zh.png` shows both responses/current model; `browser-integrated-final.png` shows Chinese toolbar/current model; `browser-integrated-800.png` shows English responsive view.
- Restored viewport override and stopped the preview. Earlier preview's default project-index registration remains preserved, as disclosed in card212 proof/HANDOFF; this final fixture explicitly injected isolated ProjectRegistry.

Acceptance uses fixture responses, not live vendor compatibility or billing evidence. Internal controller identity/unknown endpoint limits and tariffs are documented in card213-proof.md.
