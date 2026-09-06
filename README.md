# SkyRoute by Emon — Local AI Gateway for Mac

<p align="center">
  <img src="https://img.shields.io/badge/Mac%20App-Native%20WKWebView-007AFF?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Gateway-OpenAI%20%2B%20Anthropic-34C759?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Privacy-Local%20Only-1d1d1f?style=for-the-badge" />
  <img src="https://img.shields.io/badge/License-MIT-black?style=for-the-badge" />
</p>

<p align="center"><b>One base URL for Claude Desktop, VS Code, opencode & every AI coding agent.</b><br/>Add OmniRoute, Meta, OpenAI — expose only the models you enable as <code>opus-*</code> for Claude.</p>

---

## ✨ What it does

**SkyRoute** is a tiny local gateway that sits on `http://127.0.0.1:3000` and speaks **both** OpenAI (`/v1/chat/completions`, `/v1/models`) and **Anthropic** (`/v1/messages` with streaming + `tool_use`) — so one URL works for **Claude Desktop (Cowork/Code)**, **VS Code Continue/Cline**, **opencode**, `curl` and any OpenAI-compatible client.

- **Bring any provider** — Meta `muse-spark-1.2`, OmniRoute `http://localhost:20128/v1`, OpenAI, etc. Add name + baseUrl + apiKey + modelIds.
- **Fetch → Browse → Add** — Click *Fetch models from provider* to list 2000+ upstream models, search, `Add to SkyRoute` (disabled by default).
- **Allow-list** — Dedicated **Models** tab: each model its own box, `Test` + `Enable` + `Delete`, status `healthy/error/unknown`. **Enabled Models** menu shows only enabled — those alone are returned by `GET /v1/models`.
- **Claude-ready** — Every allowed model auto-exposes `opus-*` alias (`auto/best-coding` → `opus-auto-best-coding`) so Claude's `opus` filter passes.
- **Per-model test** — `Test` hits `POST /chat/completions` with `Reply with OK`, popup `Model working` green or red with full upstream error.
- **Mac native** — `SkyRoute.app` (WKWebView 1280×800, traffic lights, ⌘R reload) + `LaunchAgent com.skyroute.gateway` keeps gateway alive 24h, auto-start on power loss/restart, even if app closed.
- **Local-only** — Data in `skyroute-data.json` (0600), no cloud, no telemetry.

---

## 🚀 Quick start (Mac)

```bash
git clone https://github.com/emonibnmustafa/skyroute.git
cd skyroute
npm install --legacy-peer-deps
npm run build
# run gateway (24h via launchd - recommended)
launchctl load ~/Library/LaunchAgents/com.skyroute.gateway.plist
# or manual
NODE_ENV=production NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem PORT=3000 node dist/index.js

open http://127.0.0.1:3000
```

**Claude Desktop:**
1. `Help → Troubleshooting → Enable Developer Mode` → `Developer → Configure Third-Party Inference`
2. `Gateway base URL`: `http://127.0.0.1:3000/`  `Gateway API key`: `lr_...` (create in **Keys** tab)  `Gateway auth`: `bearer`
3. `Model`: pick any `opus-*` (e.g. `opus-muse-spark-1.2`)
4. `Apply` → quit & relaunch Claude → `Continue with Gateway`

**VS Code / opencode / curl:**
```
Base URL: http://127.0.0.1:3000/v1
API key: lr_...
Model: muse-spark-1.2  # or opus-*
```

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer lr_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"muse-spark-1.2","messages":[{"role":"user","content":"hi"}],"max_tokens":512}'
```

---

## 🖥️ UI walkthrough

**Providers** — Add/Edit upstream. `Fill OmniRoute` preset, `Fetch models from provider` (server-side `GET /models`), searchable `Available models` list with `Add to SkyRoute` per row. Toggle `Enable`, `Test` (health), `Delete`.

**Models** — `SkyRoute by Emon models · 2344` — all allow-listed, each box: `modelId` mono + copy `Copy` icon, `alias · provider`, status dot, `Test` (popup), `Enable` switch, `Trash`. Search. Top sub-card `Enabled for SkyRoute` shows only enabled (exposed).

**Enabled Models** — dedicated menu entry, **only enabled** shown, `Disable`/`Delete` here removes from `GET /v1/models` instantly.

**Aliases** — Optional `opus-*` fallback combos (ordered routes) for resiliency.

**Keys** — Create `lr_...` bearer keys, one-time secret, copy, revoke. Snippets for `Claude`/`curl`/`VS Code`.

---

## 🔧 Architecture

```
Claude Desktop / VS Code
        ↓  POST /v1/messages (Anthropic + tools, streaming, keepalive) / POST /v1/chat/completions
   SkyRoute Gateway  http://127.0.0.1:3000
        ↓  resolveRoutes: allow-list (enabled) → provider + model, toOpusAlias, combo fallback
   OmniRoute http://localhost:20128/v1  ·  Meta https://api.meta.ai/v1  ·  etc.
```

- `server/gatewayStore.ts` — file `skyroute-data.json` (providers, combos, keys, allowedModels), `toOpusAlias`, `listExposedModels`, `resolveRoutes`, `proxyChat` (tool translation, heartbeat `15s`, `max_tokens ≥4096`, `timeout 120s` for Muse Spark)
- `server/gatewayRoutes.ts` — `CORS`, `GET /health`, `GET /v1/models` (only enabled allow-list), `POST /v1/messages` (Anthropic→OpenAI tools `write_file` etc., `tool_use` streaming, `input_json_delta`), `POST /v1/chat/completions`
- `client/src/pages/Home.tsx` — Mac light UI (`mac-card`, `backdrop-blur`, SF Pro), 6 tabs, per-model test popups
- `dist/index.js` — bundled gateway; `SkyRoute.app` — Swift WKWebView wrapper

---

## 📦 Mac app (24h)

**24h daemon:** [`mac/com.skyroute.gateway.plist`](mac/com.skyroute.gateway.plist) — edit the checkout path + node binary inside, then:
```bash
cp mac/com.skyroute.gateway.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.skyroute.gateway.plist
```
`RunAtLoad + KeepAlive` restarts on crash and survives reboot/power loss, runs even if the UI is closed. Logs `/tmp/skyroute.log`. Check: `launchctl list | grep skyroute`.

---

## 🔒 Privacy & open source

- **No secrets in repo** — `.gitignore` excludes `skyroute-data.json`, `localroute-data.json`, `.env`, `dist`, `node_modules`. Commit `.env.example` only.
- Data stays on disk `0600`, bearer keys `sha256` hashed.
- `npm run build` → `dist/`; `npm test` → 10 tests `gateway.test.ts` (auth, combo fallback, streaming).
- License MIT — see `LICENSE`.

---

## 🤝 Contributing

PRs welcome. `npm run dev` (`NODE_ENV=development tsx watch server/_core/index.ts` + Vite). Please run `npm run check` and `npm test` before push.

---

## 👨‍💻 About Me

<p align="center">
  <a href="https://github.com/emonibnmustafa">
    <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&pause=1000&center=true&vCenter=true&width=480&lines=Hi+%F0%9F%91%8B%2C+I'm+Emon;Local-first+AI+tooling+builder;Mac+native+%E2%80%A2+Gateways+%E2%80%A2+DX" alt="Typing intro" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/emonibnmustafa?tab=followers"><img src="https://img.shields.io/github/followers/emonibnmustafa?label=Follow&style=social" alt="GitHub followers" /></a>
  <a href="https://github.com/emonibnmustafa/skyroute"><img src="https://img.shields.io/github/stars/emonibnmustafa/skyroute?style=social" alt="Repo stars" /></a>
  <img src="https://komarev.com/ghpvc/?username=emonibnmustafa&color=007AFF&style=flat&label=Profile+views" alt="Profile views" />
</p>

<p align="center">I build <b>local-first developer tools</b> — gateways, Mac apps, and agent infrastructure that keep data on your machine. <b>SkyRoute</b> is my answer to model sprawl: one gateway, every provider, zero cloud.</p>

<p align="center">
  <a href="https://github.com/emonibnmustafa"><img src="https://img.shields.io/badge/GitHub-emonibnmustafa-1d1d1f?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" /></a>
</p>

### 🛠️ Tech I work with

<p align="center">
  <img src="https://skillicons.dev/icons?i=ts,react,nodejs,express,swift,tailwind,vite,python,git,github,vscode&theme=light" alt="Tech stack" />
</p>

### 📊 GitHub stats

<p align="center">
  <img src="https://github-readme-stats.vercel.app/api?username=emonibnmustafa&show_icons=true&theme=default&hide_border=true&bg_color=ffffff&title_color=007AFF&icon_color=007AFF" height="165" alt="GitHub stats" />
  <img src="https://github-readme-stats.vercel.app/api/top-langs/?username=emonibnmustafa&layout=compact&theme=default&hide_border=true&bg_color=ffffff&title_color=007AFF" height="165" alt="Top languages" />
</p>

<p align="center">
  <img src="https://streak-stats.demolab.com?user=emonibnmustafa&theme=default&hide_border=true&background=ffffff&ring=007AFF&fire=FF5F57&currStreakLabel=007AFF" height="165" alt="Contribution streak" />
</p>

### 🌱 What I'm focused on

- 🔌 **AI gateways** — OpenAI ↔ Anthropic translation, streaming, tool_use, failover routing
- 🖥️ **Mac-native apps** — Swift/WKWebView wrappers, LaunchAgent daemons, menu-bar DX
- 🔒 **Privacy by default** — local-only data, hashed credentials, no telemetry
- 🤖 **Agent infrastructure** — one endpoint for Claude, VS Code, opencode, and every coding agent

<p align="center">💡 <i>Have an idea, found a bug, or want a provider supported? <a href="https://github.com/emonibnmustafa/skyroute/issues">Open an issue</a> — I read every one.</i></p>

---

<p align="center"><b>SkyRoute by Emon</b> — one gateway, every model, local.</p>
