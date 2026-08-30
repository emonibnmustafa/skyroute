# Project TODO

- [x] Build cyberpunk dashboard shell with sidebar navigation, HUD styling, and responsive layout.
- [x] Add upstream provider management: create, edit, enable/disable, test, and delete OpenAI-compatible providers.
- [x] Store upstream provider API keys server-side and never return raw secrets to the browser.
- [x] Add named model combos with ordered enabled provider/model routes.
- [x] Implement resilient combo routing with automatic fallback to the next route on upstream failure.
- [x] Expose authenticated OpenAI-compatible `/v1/models` and `/v1/chat/completions` gateway endpoints.
- [x] Resolve direct provider models and named combo aliases through gateway requests.
- [x] Support compatible streaming and non-streaming chat completion responses.
- [x] Show local base URL and endpoint status in the dashboard.
- [x] Add named bearer API-key creation and revocation for gateway clients.
- [x] Require a valid bearer key for all gateway requests and protect key material server-side.
- [x] Add browser configuration for endpoints and copyable OpenCode, VS Code, and generic OpenAI-compatible snippets.
- [x] Add provider health, last test result, route status, and empty/loading/error states.
- [x] Add vitest coverage for provider validation, key hashing/authentication, combo fallback, and gateway compatibility behavior.
- [x] Run typecheck, tests, and visual browser verification.
- [x] Fix true provider editing by preserving the selected provider ID and add regression coverage.
- [x] Add a live gateway health endpoint and dashboard status indicator.
- [x] Add explicit mutation/query error states and per-route status feedback.
- [x] Add tests for ordered proxy fallback and authenticated `/v1/models` plus chat completion behavior.
- [x] Add a provider edit regression test proving update does not create a duplicate.
- [x] Add query error UI and error handling for toggle, delete, and revoke actions.
- [x] Show per-route combo status and last failure details in the dashboard.
- [x] Add HTTP endpoint tests for bearer auth, models, chat completions, and streaming compatibility.
- [x] Persist runtime route success/failure metadata and render deployed combo route health.
- [x] Add HTTP tests for chat auth, direct/combo resolution, JSON responses, and SSE streaming.

- [x] Allow each provider to save multiple model IDs while preserving the default model route.
- [x] Add server-side per-model live test requests with timeout and result persistence.
- [x] Expose every enabled provider model automatically from authenticated `/v1/models`.
- [x] Add provider UI model chips and a real-time test action/result for each model.
- [x] Add regression tests for multi-model discovery and per-model live testing.
- [x] Add an authenticated `/v1/models` regression assertion for every configured provider model ID.

- [x] Add Meta AI provider `https://api.meta.ai/v1` with Muse Spark 1.2 model using the user-supplied upstream credential server-side.
- [x] Create and verify a separate named SkyRoute by Emon bearer key for Claude client access.
- [x] Provide the exact localhost base URL, local client API key, and model name without revealing the upstream credential.
- [x] Verify the generated Claude bearer key against SkyRoute by Emon `/v1/models` and provide the exact local connection details without revealing the upstream key.
