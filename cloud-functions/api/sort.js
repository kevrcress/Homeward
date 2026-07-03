import Anthropic from "@anthropic-ai/sdk";

// Runs on EdgeOne Cloud Functions (Node 20). The Anthropic key comes from the
// project environment variable ANTHROPIC_API_KEY (set via `edgeone makers env set`
// or the EdgeOne console) — it never reaches the browser.

const MODEL_FALLBACK = "claude-sonnet-4-6";

const DEST_LABELS = {
  general: "General",
  homeless: "Homeless shelter/services",
  dv: "Domestic violence shelter",
  pet: "Pet rescue or shelter",
  refugee: "Refugee resettlement",
  other: "Just find the best fit",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Model output is prompted to be a bare JSON array, but fences/preamble can
// still sneak in — extract the outermost array instead of trusting raw text.
export function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("no JSON array in model output");
  return JSON.parse(text.slice(start, end + 1));
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

  const { items, destination, context: userContext } = body ?? {};
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return json({ error: "Send 1–50 items." }, 400);
  }
  for (const item of items) {
    if (typeof item?.name !== "string" || !item.name.trim() || item.name.length > 200) {
      return json({ error: "Each item needs a name under 200 characters." }, 400);
    }
  }
  const destLabel = DEST_LABELS[destination] ?? DEST_LABELS.other;

  const itemsText = items
    .map((i) => `- ${i.name.trim()} (${i.condition === "new" ? "new / unused" : "used, good condition"})`)
    .join("\n");

  const contextLine =
    typeof userContext === "string" && userContext.trim()
      ? `Context: ${userContext.trim().slice(0, 500)}.`
      : "";

  const prompt = `Someone wants to donate belongings to: ${destLabel}. ${contextLine} Here are their items with condition:

${itemsText}

For each item, decide: "donate" (safe, appropriate, and likely wanted for this destination type and condition), "keep" (sentimental or clearly not meant to be given away), or "dispose" (opened food, expired/prescription items, worn-out or unsafe items no organization could accept).

Consider real constraints: many shelters cannot accept used mattresses or upholstered furniture (liability/bedbug policy). DV shelters and refugee programs often prefer NEW/unopened toiletries and hygiene items for dignity and safety; used versions of those may not be accepted. Homeless services often prioritize non-perishable food, warm layers, and hygiene kits.

Respond with ONLY valid JSON, no preamble, no markdown fences, in this exact shape:
[{"item": "string (echo the item name exactly)", "condition": "new|used", "category": "donate|keep|dispose", "reason": "one short sentence, gentle and practical"}]`;

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: 60_000,
    maxRetries: 1,
  });

  try {
    const message = await client.messages.create({
      model: env.MODEL_ID || MODEL_FALLBACK,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const sorted = extractJsonArray(text).filter(
      (r) => r && typeof r.item === "string" && ["donate", "keep", "dispose"].includes(r.category)
    );
    if (sorted.length === 0) throw new Error("model returned no usable rows");
    return json({ sorted });
  } catch (err) {
    console.error("sort failed:", err);
    return json({ error: "Sorting failed. Try again in a moment." }, 502);
  }
}
