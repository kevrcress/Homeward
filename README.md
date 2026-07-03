# Homeward

**Find where what you have is actually needed.** A donation-sorting agent: list your items, pick who they're for, and Homeward sorts them into donate / keep / dispose with destination-aware reasoning, then web-searches for real nearby organizations that accept exactly those items — and lets you build a persistent contact shortlist.

Built for the Agent Forge Mini Hackathon (Tencent EdgeOne × AI Builders × Digital Jungle SF). Deployed on **EdgeOne Makers**.

## Architecture

```
Browser (React SPA, Vite)
  │  fetch /api/sort            fetch /api/find-places     localStorage (primary)
  ▼                             ▼                          + fetch /api/contacts (best-effort sync)
cloud-functions/api/sort.js   cloud-functions/api/        ▼
(Node 20, Anthropic API)      find-places.js              edge-functions/api/contacts.js
                              (Node 20, Anthropic API     (EdgeOne KV — optional cross-device sync)
                               + web_search server tool)
```

- **`src/`** — the React single-page UI (Vite).
- **`cloud-functions/api/`** — EdgeOne Cloud Functions (Node 20). Both LLM calls run here with the API key from a project environment variable — no key ever reaches the browser. `edgeone.json` raises `maxDuration` to 120s because the web-search call legitimately takes 30–60s.
- **Contact-list persistence** — `localStorage` is the source of truth, so the saved shortlist survives a reload with no backend at all. `edge-functions/api/contacts.js` (EdgeOne Edge Function + KV, keyed by an anonymous per-browser token) is layered on as **best-effort cross-device sync**: the app calls it, but silently no-ops if the KV namespace isn't bound, so nothing breaks without it.

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

# 4. Deploy globally
edgeone makers deploy                # production
edgeone makers deploy -e preview     # or a preview environment

# 5. Test live: open the deployment URL, sort a few items, run a search,
#    save a place, reload — the contact list should persist (via localStorage).
```

### Optional: KV for cross-device sync

The app is fully functional without KV — the contact list persists in `localStorage`. To additionally sync the shortlist across devices/browsers, bind an EdgeOne KV namespace:

```
EdgeOne console → Storage → KV → Create Namespace
  → namespace → Bind Project → select this project,
    with the variable name exactly:  homeward_kv
```

The edge function references `homeward_kv` as a global and returns a clear 503 if it's unbound — but the client swallows that, so an unbound namespace never affects the user.

Notes:
- The legacy `edgeone pages ...` command namespace still works but is being phased out in favor of `edgeone makers ...`.
- If local dev can't see env vars, pull them after linking: `edgeone makers env pull`.
- Local `edgeone makers dev` serves the app + functions together on `:8088`. If you get a "Bad Gateway" there, another process is holding Vite's dev port (5173) — free it or pin `server.port` in `vite.config.js`. Production deploys don't use the dev proxy, so this can't happen live.

## API surface

| Endpoint | Runtime | Purpose |
|---|---|---|
| `POST /api/sort` | Cloud Function (Node 20) | Sorts items into donate/keep/dispose with destination-aware reasons |
| `POST /api/find-places` | Cloud Function (Node 20) | Web-search for nearby orgs accepting the donate items; DV address scrubbing |
| `GET/POST /api/contacts` | Edge Function + KV | Optional cross-device sync of the shortlist; localStorage is the primary store |

## Design notes

- **API key stays server-side.** Both LLM calls run in EdgeOne Cloud Functions with the key read from `context.env` — nothing secret ships to the client.
- **Live web search via Anthropic's server tool.** The place-finding call uses the `web_search_20260209` server tool (dynamic filtering — results are filtered before they hit context) with `max_uses: 5`, plus `pause_turn` continuation handling for multi-round searches.
- **DV safety rule is server-enforced, in two layers.** A prompt rule plus a regex address scrubber in `find-places.js`. Because it runs server-side, no client modification can bypass it.
- **Persistence degrades gracefully.** `localStorage` is the source of truth, so the saved shortlist survives a reload with no backend; an EdgeOne KV edge function is layered on as best-effort cross-device sync (anonymous per-browser token). Saved places store the full record (contact, items, notes, source) and render on both the results and home screens. KV sync lights up automatically the moment the namespace is bound — until then, localStorage carries it.
- **Destination-aware sorting.** Distinct "General", "Homeless shelter/services", "Domestic violence shelter", "Pet rescue", and "Refugee resettlement" options let the sorting and search prompts target each audience's real constraints (e.g. shelters can't take used mattresses; DV/refugee programs prefer new/unopened toiletries).
- **Hardened parsing & validation.** The server extracts the outermost JSON array from model output (tolerating stray fences/preamble), validates shape and categories, caps result counts, and validates input (item counts, string lengths) on every endpoint.
- **Timeout headroom.** `edgeone.json` sets `cloudFunctions.nodejs.maxDuration: 120` (default 30s — the search call would otherwise time out).

### Known fragilities

- The sorter echoes item names back and `acceptsItems` matches on exact names — if the model paraphrases an item, its chip won't match the sorted card. Low-stakes (display only), but a name-normalization pass would fix it.
- Place results come from live web search — quality varies by location; small towns may return regional orgs.
- The contact list is per-browser (localStorage token), not per-account. Cross-device sync requires the optional KV namespace.
