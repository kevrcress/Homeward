import Anthropic from "@anthropic-ai/sdk";

// Runs on EdgeOne Cloud Functions (Node 20) with maxDuration 120s (edgeone.json) —
// a web-search-assisted model call can legitimately take 30–60s.
//
// SAFETY RULE (load-bearing, do not remove): when the destination is a domestic
// violence shelter, this endpoint must never return a street address. DV shelter
// locations are kept confidential for resident safety. The rule is enforced in
// two layers: the prompt instructs the model, and scrubAddressesForDV() strips
// anything address-shaped that slips through. It lives server-side so no client
// change can bypass it.

const MODEL_FALLBACK = "claude-sonnet-4-6";

const DEST_LABELS = {
  general: "General",
  homeless: "Homeless shelter/services",
  dv: "Domestic violence shelter",
  pet: "Pet rescue or shelter",
  refugee: "Refugee resettlement",
  other: "Just find the best fit",
};

const STREET_ADDRESS_RE =
  /\b\d{1,6}\s+[A-Za-z0-9'.\- ]{2,40}\s(?:st(?:reet)?|ave(?:nue)?|blvd|boulevard|r(?:oa)?d|dr(?:ive)?|lane|ln|way|court|ct|place|pl|hwy|highway|circle|cir|terrace|ter|parkway|pkwy|broadway)\b\.?/gi;
const PHONE_RE = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("no JSON array in model output");
  return JSON.parse(text.slice(start, end + 1));
}

// Defense-in-depth for the DV safety rule: if the model returned anything that
// looks like a street address anyway, remove it and fall back to a phone number
// or an explicit "call for intake" contact.
export function scrubAddressesForDV(places) {
  return places.map((p) => {
    const contact = String(p.contact ?? "");
    const notes = String(p.notes ?? "");
    let safeContact = contact;
    if (STREET_ADDRESS_RE.test(contact)) {
      const phone = contact.match(PHONE_RE);
      safeContact = phone
        ? `${phone[0]} (call for donation intake — address withheld for resident safety)`
        : "Call their public intake line — address withheld for resident safety";
    }
    STREET_ADDRESS_RE.lastIndex = 0;
    const safeNotes = notes.replace(STREET_ADDRESS_RE, "[address withheld for safety]");
    STREET_ADDRESS_RE.lastIndex = 0;
    return { ...p, contact: safeContact, notes: safeNotes };
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY is not configured on this project." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { items, destination, location } = body ?? {};
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return json({ error: "Send 1–50 donate items." }, 400);
  }
  if (typeof location !== "string" || !location.trim() || location.length > 120) {
    return json({ error: "A city or zip code is required to search nearby." }, 400);
  }
  const destLabel = DEST_LABELS[destination] ?? DEST_LABELS.other;
  const isDV = destination === "dv";

  const donateNames = items
    .filter((i) => typeof i?.name === "string" && i.name.trim())
    .map((i) => `${i.name.trim().slice(0, 200)} (${i.condition === "new" ? "new" : "used"})`);
  if (donateNames.length === 0) {
    return json({ error: "Send 1–50 donate items." }, 400);
  }

  const safetyClause = isDV
    ? `IMPORTANT SAFETY RULE: Domestic violence shelters keep their physical location confidential for resident safety. Do NOT return a street address for any DV shelter. Return their public intake phone number, hotline, or donation-coordination process (many route donations through a separate thrift store, drop-off partner, or wishlist — prefer those). If no safe donation path exists, say so rather than guessing an address.`
    : `Return the organization's address or best-known donation drop-off location.`;

  const prompt = `Search the web for organizations near "${location.trim()}" that fit this donation destination: ${destLabel}, and that currently accept donations of these items: ${donateNames.join(
    ", "
  )}. Prioritize real, currently-operating organizations with an active donation or wishlist program.

For EACH place, list which of the specific items above it accepts (use the item name exactly as written, without the condition parenthetical).

${safetyClause}

Respond with ONLY valid JSON, no preamble, no markdown fences, in this exact shape:
[{"name": "string", "contact": "phone, address, or intake process per the safety rule", "acceptsItems": ["item name", "item name"], "notes": "one short sentence on what they accept or how donation works", "source": "url"}]
Return at most 6 results.`;

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: 110_000,
    maxRetries: 1,
  });
  const model = env.MODEL_ID || MODEL_FALLBACK;
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }];

  try {
    let messages = [{ role: "user", content: prompt }];
    let message = await client.messages.create({ model, max_tokens: 2500, tools, messages });

    // Server-side tool loops can pause at the iteration limit; re-send to resume.
    let continuations = 0;
    while (message.stop_reason === "pause_turn" && continuations < 3) {
      messages = [...messages, { role: "assistant", content: message.content }];
      message = await client.messages.create({ model, max_tokens: 2500, tools, messages });
      continuations++;
    }

    const textBlocks = message.content.filter((b) => b.type === "text");
    const lastText = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "";
    let places;
    try {
      places = extractJsonArray(lastText);
    } catch {
      places = extractJsonArray(textBlocks.map((b) => b.text).join("\n"));
    }

    places = places
      .filter((p) => p && typeof p.name === "string" && p.name.trim())
      .slice(0, 6)
      .map((p) => ({
        name: String(p.name),
        contact: String(p.contact ?? ""),
        acceptsItems: Array.isArray(p.acceptsItems) ? p.acceptsItems.map(String) : [],
        notes: String(p.notes ?? ""),
        source: String(p.source ?? ""),
      }));

    if (isDV) places = scrubAddressesForDV(places);

    return json({ places });
  } catch (err) {
    console.error("find-places failed:", err);
    return json({ error: "Couldn't search for places right now." }, 502);
  }
}
