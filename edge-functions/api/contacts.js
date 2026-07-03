// Contact-list persistence on EdgeOne Edge Functions + KV.
//
// Requires a KV namespace bound to this project with the variable name
// `homeward_kv` (EdgeOne console → Storage → KV → Bind Project). KV is only
// available inside Edge Functions, which is why this endpoint lives here while
// the AI calls live in cloud-functions/.
//
// The list id is an anonymous client-generated token kept in localStorage —
// no accounts, hackathon-grade scoping.

const MAX_CONTACTS = 50;
const MAX_BYTES = 100_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// KV keys allow alphanumerics/underscores only.
function keyFor(listId) {
  const clean = String(listId ?? "").replace(/[^A-Za-z0-9_]/g, "");
  if (clean.length < 8 || clean.length > 64) return null;
  return `contacts_${clean}`;
}

export async function onRequest({ request }) {
  if (typeof homeward_kv === "undefined") {
    return json({ error: "KV namespace 'homeward_kv' is not bound to this project." }, 503);
  }

  const url = new URL(request.url);

  if (request.method === "GET") {
    const key = keyFor(url.searchParams.get("list"));
    if (!key) return json({ error: "Missing or invalid list id." }, 400);
    const stored = await homeward_kv.get(key, { type: "json" });
    return json({ contacts: Array.isArray(stored) ? stored : [] });
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }
    const key = keyFor(body?.listId);
    if (!key) return json({ error: "Missing or invalid list id." }, 400);
    if (!Array.isArray(body?.contacts) || body.contacts.length > MAX_CONTACTS) {
      return json({ error: `contacts must be an array of at most ${MAX_CONTACTS}.` }, 400);
    }
    const contacts = body.contacts.map((c) => ({
      name: String(c?.name ?? "").slice(0, 200),
      contact: String(c?.contact ?? "").slice(0, 500),
      acceptsItems: Array.isArray(c?.acceptsItems) ? c.acceptsItems.map((i) => String(i).slice(0, 200)) : [],
      notes: String(c?.notes ?? "").slice(0, 500),
      source: String(c?.source ?? "").slice(0, 500),
    }));
    const payload = JSON.stringify(contacts);
    if (payload.length > MAX_BYTES) return json({ error: "Contact list too large." }, 413);
    await homeward_kv.put(key, payload);
    return json({ ok: true, count: contacts.length });
  }

  return json({ error: "Method not allowed." }, 405);
}
