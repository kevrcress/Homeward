# Homeward

**Find where what you have is actually needed.** A donation-sorting agent: list your items, pick who they're for, and Homeward sorts them into donate / keep / dispose with destination-aware reasoning, then web-searches for real nearby organizations that accept exactly those items — and lets you build a persistent contact shortlist.

Built for the Agent Forge Mini Hackathon (Tencent EdgeOne × AI Builders × Digital Jungle SF). Deployed on **EdgeOne Makers**.

## Architecture

```
Browser (React SPA, Vite)
  │  fetch /api/sort            fetch /api/find-places        fetch /api/contacts
  ▼                             ▼                             ▼
cloud-functions/api/sort.js   cloud-functions/api/           edge-functions/api/contacts.js
(Node 20, Anthropic API)      find-places.js                 (EdgeOne KV persistence)
                              (Node 20, Anthropic API
                               + web_search server tool)
```

- **`src/`** — the React UI (ported unchanged from the original single-file Claude.ai artifact prototype).
- **`cloud-functions/api/`** — EdgeOne Cloud Functions (Node 20). Both LLM calls run here with the API key from a project environment variable — no key ever reaches the browser. `edgeone.json` raises `maxDuration` to 120s because the web-search call legitimately takes 30–60s.
- **`edge-functions/api/contacts.js`** — EdgeOne Edge Function backed by EdgeOne KV (KV is only accessible from edge functions). The saved contact list survives reloads, keyed by an anonymous per-browser token in localStorage.

### DV-shelter safety rule (load-bearing)

When the destination is a domestic violence shelter, the app must **never return a street address** — DV shelter locations are confidential for resident safety. This is enforced server-side in `cloud-functions/api/find-places.js` in two layers:

1. The prompt instructs the model to return intake phone numbers / donation-partner routing only.
2. `scrubAddressesForDV()` strips anything address-shaped that slips through and falls back to a phone number or "call for intake".

Because it's server-side, no client modification can bypass it.

## Setup & deploy (EdgeOne Makers)

Prereqs: Node ≥ 18, an [EdgeOne](https://pages.edgeone.ai) account, an Anthropic API key.

```bash
# 1. Install and log in to the EdgeOne CLI
npm install -g edgeone
edgeone login

# 2. Link this repo to an EdgeOne Makers project (creates one if needed)
edgeone makers link        # or: edgeone makers init

# 3. Set the Anthropic key as a project environment variable (server-side only)
edgeone makers env set ANTHROPIC_API_KEY sk-ant-...
# optional: override the model (defaults to claude-sonnet-4-6)
# edgeone makers env set MODEL_ID claude-sonnet-4-6

# 4. Create + bind the KV namespace (console step)
#    EdgeOne console → Storage → KV → Create Namespace
#    Then: namespace → Bind Project → select this project,
#    with the variable name exactly:  homeward_kv

# 5. Preview locally (serves the app + functions together on :8088)
npm install
edgeone makers dev
# → http://localhost:8088

# 6. Deploy globally
edgeone makers deploy                # production
edgeone makers deploy -e preview     # or a preview environment

# 7. Test live: open the deployment URL, sort a few items, run a search,
#    save a place, reload — the contact list should persist.
```

Notes:
- The legacy `edgeone pages ...` command namespace still works but is being phased out in favor of `edgeone makers ...`.
- If local dev can't see env vars, pull them after linking: `edgeone makers env pull`.
- The KV binding variable name must be `homeward_kv` — the edge function references it as a global and returns a 503 with a clear message if it's unbound.

## API surface

| Endpoint | Runtime | Purpose |
|---|---|---|
| `POST /api/sort` | Cloud Function (Node 20) | Sorts items into donate/keep/dispose with destination-aware reasons |
| `POST /api/find-places` | Cloud Function (Node 20) | Web-search for nearby orgs accepting the donate items; DV address scrubbing |
| `GET/POST /api/contacts` | Edge Function + KV | Load/save the persistent contact shortlist |

## What changed from the prototype (demo / slide notes)

- **API key moved server-side.** The prototype called `api.anthropic.com` from the browser (only worked in the Claude.ai artifact sandbox). Both calls now run in EdgeOne Cloud Functions; the key is an EdgeOne project env var read from `context.env` — nothing secret ships to the client.
- **Web search kept on Anthropic's server tool, upgraded.** EdgeOne Makers' agent sandbox tools (browser automation, shell, code exec) don't include a general web-search tool for this pattern, and EdgeOne's own docs show model calls from functions as the idiomatic web-app path. The tool version was upgraded from `web_search_20250305` to `web_search_20260209` (dynamic filtering — filters results before they hit context) with `max_uses: 5`, plus `pause_turn` continuation handling.
- **DV safety rule is now server-enforced, twice.** Prompt rule + regex address scrubber in `find-places.js`. In the prototype a modified client could skip it; now it can't.
- **Contact list persists.** EdgeOne KV via an edge function, keyed by an anonymous localStorage token. Saved places now store the full record (contact, items, notes, source) instead of just names, so the list renders after reload — it also shows on the home screen.
- **Hardened parsing.** The prototype regex-stripped markdown fences and trusted `JSON.parse`; the server now extracts the outermost JSON array, validates shape/categories, and caps result counts. Input validation (item counts, string lengths) on every endpoint.
- **Timeout headroom.** `edgeone.json` sets `cloudFunctions.nodejs.maxDuration: 120` (default is 30s — the search call would time out).
- **UI unchanged** except: the saved contact list card also renders on the home screen (persistence has to be visible), and location is required before searching (the prototype would happily search "near ''").

### Known fragilities (worth saying in the demo)

- The sorter echoes item names back and `acceptsItems` matches on exact names — if the model paraphrases an item, its chip won't match the sorted card. Low-stakes (display only), but a name-normalization pass would fix it.
- Place results come from live web search — quality varies by location; small towns may return regional orgs.
- The contact list is per-browser (localStorage token), not per-account.
