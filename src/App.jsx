import { useEffect, useState } from "react";
import {
  Package,
  MapPin,
  Heart,
  Trash2,
  Gift,
  Loader2,
  ArrowRight,
  ShieldAlert,
  Phone,
  Plus,
  X,
  Check,
  Star,
} from "lucide-react";

const CATEGORY_STYLES = {
  donate: { label: "Donate", color: "#3D5A45", bg: "#E8EFE7", icon: Gift },
  keep: { label: "Keep", color: "#9C5B3C", bg: "#F5EAE1", icon: Heart },
  dispose: { label: "Dispose properly", color: "#7A4A5C", bg: "#F1E5EA", icon: Trash2 },
};

const DESTINATIONS = [
  { id: "general", label: "General / homeless services" },
  { id: "dv", label: "Domestic violence shelter" },
  { id: "pet", label: "Pet rescue or shelter" },
  { id: "refugee", label: "Refugee resettlement" },
  { id: "other", label: "Just find the best fit" },
];

let nextId = 1;

// Anonymous per-browser id so the contact list survives reloads (stored in KV
// server-side, keyed by this token). Alphanumeric only — KV key constraint.
function getListId() {
  const KEY = "homeward-list-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    ).replace(/-/g, "");
    localStorage.setItem(KEY, id);
  }
  return id;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function DonationFinder() {
  const [context, setContext] = useState("");
  const [destination, setDestination] = useState("general");
  const [itemList, setItemList] = useState([]); // {id, name, condition}
  const [draftName, setDraftName] = useState("");
  const [draftCondition, setDraftCondition] = useState("used");
  const [location, setLocation] = useState("");
  const [step, setStep] = useState("input");
  const [sorted, setSorted] = useState(null);
  const [places, setPlaces] = useState(null);
  const [contactList, setContactList] = useState([]); // saved place objects, persisted in KV
  const [error, setError] = useState(null);

  // Restore the saved contact list on load.
  useEffect(() => {
    fetch(`/api/contacts?list=${getListId()}`)
      .then((r) => (r.ok ? r.json() : { contacts: [] }))
      .then((data) => setContactList(Array.isArray(data.contacts) ? data.contacts : []))
      .catch(() => {});
  }, []);

  function addItem() {
    if (!draftName.trim()) return;
    setItemList((prev) => [...prev, { id: nextId++, name: draftName.trim(), condition: draftCondition }]);
    setDraftName("");
    setDraftCondition("used");
  }

  function removeItem(id) {
    setItemList((prev) => prev.filter((i) => i.id !== id));
  }

  async function handleSort() {
    if (itemList.length === 0) {
      setError("Add at least one item first.");
      return;
    }
    setError(null);
    setStep("sorting");
    try {
      const data = await postJSON("/api/sort", {
        items: itemList.map(({ name, condition }) => ({ name, condition })),
        destination,
        context,
      });
      setSorted(data.sorted);
      setStep("sorted");
    } catch (e) {
      setError("Something went wrong sorting your items. Try again?");
      setStep("input");
    }
  }

  async function handleFindPlaces() {
    if (!location.trim()) {
      setError("Add your city or zip code so we can search nearby.");
      return;
    }
    setStep("searching");
    setError(null);
    try {
      const donateItems = sorted
        .filter((i) => i.category === "donate")
        .map(({ item, condition }) => ({ name: item, condition }));
      const data = await postJSON("/api/find-places", {
        items: donateItems,
        destination,
        location,
      });
      setPlaces(data.places);
      setStep("done");
    } catch (e) {
      setError("Couldn't find places right now. You can still use the sorted checklist.");
      setStep("sorted");
    }
  }

  function persistContacts(next) {
    setContactList(next);
    postJSON("/api/contacts", { listId: getListId(), contacts: next }).catch(() => {});
  }

  function toggleContact(place) {
    const exists = contactList.some((c) => c.name === place.name);
    const next = exists
      ? contactList.filter((c) => c.name !== place.name)
      : [
          ...contactList,
          {
            name: place.name,
            contact: place.contact,
            acceptsItems: place.acceptsItems ?? [],
            notes: place.notes ?? "",
            source: place.source ?? "",
          },
        ];
    persistContacts(next);
  }

  const grouped = sorted
    ? {
        donate: sorted.filter((i) => i.category === "donate"),
        keep: sorted.filter((i) => i.category === "keep"),
        dispose: sorted.filter((i) => i.category === "dispose"),
      }
    : null;

  const savedNames = new Set(contactList.map((c) => c.name));

  const contactCard = contactList.length > 0 && (
    <div style={{ marginBottom: 28, background: "#EEF3EC", borderRadius: 12, padding: "16px 18px", border: "1px solid #CBDAC6" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Star size={16} color="#3D5A45" fill="#3D5A45" />
        <span style={{ fontFamily: "'Helvetica Neue', sans-serif", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, color: "#3D5A45" }}>
          Your contact list ({contactList.length})
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {contactList.map((s, idx) => (
          <div key={idx} style={{ fontFamily: "'Helvetica Neue', sans-serif", fontSize: 13, color: "#2A2622" }}>
            <strong>{s.name}</strong> — {s.contact}
            {s.acceptsItems?.length ? (
              <span style={{ color: "#6B6459" }}> · for {s.acceptsItems.join(", ")}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F6F3EE", fontFamily: "'Iowan Old Style', 'Georgia', serif" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px 80px" }}>
        <header style={{ marginBottom: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Package size={22} color="#3D5A45" />
            <span
              style={{
                fontFamily: "'Helvetica Neue', sans-serif",
                fontSize: 12,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#3D5A45",
                fontWeight: 600,
              }}
            >
              Give Well
            </span>
          </div>
          <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: 0, color: "#2A2622" }}>
            Find where what you have is actually needed.
          </h1>
          <p style={{ fontFamily: "'Helvetica Neue', sans-serif", color: "#6B6459", fontSize: 15, marginTop: 12, lineHeight: 1.5 }}>
            List what you have. Tell us who it's for. We'll sort it, then find real places nearby
            with an active need — and help you build a shortlist to contact.
          </p>
        </header>

        {(step === "input" || step === "sorting") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {contactCard}
            <Field label="Who is this for?">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {DESTINATIONS.map((d) => (
                  <label
                    key={d.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: destination === d.id ? "1.5px solid #3D5A45" : "1px solid #E8E3D9",
                      background: destination === d.id ? "#E8EFE7" : "#fff",
                      cursor: "pointer",
                      fontFamily: "'Helvetica Neue', sans-serif",
                      fontSize: 14,
                      color: "#2A2622",
                    }}
                  >
                    <input
                      type="radio"
                      name="destination"
                      checked={destination === d.id}
                      onChange={() => setDestination(d.id)}
                      style={{ accentColor: "#3D5A45" }}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </Field>

            {destination === "dv" && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#F1E5EA", borderRadius: 10, padding: "12px 14px" }}>
                <ShieldAlert size={16} color="#7A4A5C" style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ fontFamily: "'Helvetica Neue', sans-serif", fontSize: 13, color: "#5C3E48", lineHeight: 1.5 }}>
                  DV shelter locations are kept confidential for resident safety. We'll surface
                  intake phone numbers and donation partners instead of addresses.
                </div>
              </div>
            )}

            <Field label="Any context? (optional)">
              <input
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="e.g. clearing out after a move, or downsizing"
                style={inputStyle}
              />
            </Field>

            <Field label="What do you have?">
              <div style={{ display: "flex", gap: 8, marginBottom: itemList.length ? 12 : 0 }}>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addItem()}
                  placeholder="e.g. dog bed, kitchenware, unopened toiletries"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={addItem} style={{ ...buttonStyle, width: "auto", padding: "0 16px", flexShrink: 0 }}>
                  <Plus size={16} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {["used", "new"].map((c) => (
                  <button
                    key={c}
                    onClick={() => setDraftCondition(c)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      borderRadius: 8,
                      border: draftCondition === c ? "1.5px solid #3D5A45" : "1px solid #E8E3D9",
                      background: draftCondition === c ? "#E8EFE7" : "#fff",
                      color: "#2A2622",
                      fontFamily: "'Helvetica Neue', sans-serif",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {c === "used" ? "Used, good condition" : "New / unused"}
                  </button>
                ))}
              </div>

              {itemList.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
                  {itemList.map((i) => (
                    <div
                      key={i.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "#fff",
                        border: "1px solid #E8E3D9",
                        borderRadius: 8,
                        padding: "8px 12px",
                      }}
                    >
                      <span style={{ fontFamily: "'Helvetica Neue', sans-serif", fontSize: 14, color: "#2A2622" }}>
                        {i.name}
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: i.condition === "new" ? "#3D5A45" : "#9C5B3C",
                          }}
                        >
                          {i.condition === "new" ? "New" : "Used"}
                        </span>
                      </span>
                      <button onClick={() => removeItem(i.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A79E8E", display: "flex" }}>
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Field>

            <Field label="Your city or zip code">
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="San Francisco, CA" style={inputStyle} />
            </Field>

            {error && <div style={{ color: "#A44A3F", fontSize: 14, fontFamily: "'Helvetica Neue', sans-serif" }}>{error}</div>}
            <button onClick={handleSort} disabled={step === "sorting"} style={buttonStyle}>
              {step === "sorting" ? (
                <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Sorting...</>
              ) : (
                <>Sort my items <ArrowRight size={16} /></>
              )}
            </button>
          </div>
        )}

        {grouped && (step === "sorted" || step === "searching" || step === "done") && (
          <div style={{ marginTop: 8 }}>
            {["donate", "keep", "dispose"].map((cat) => {
              const style = CATEGORY_STYLES[cat];
              const Icon = style.icon;
              if (grouped[cat].length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 28 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Icon size={16} color={style.color} />
                    <span style={{ fontFamily: "'Helvetica Neue', sans-serif", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, color: style.color }}>
                      {style.label}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {grouped[cat].map((i, idx) => (
                      <div key={idx} style={{ background: style.bg, borderRadius: 10, padding: "12px 16px" }}>
                        <div style={{ fontWeight: 600, color: "#2A2622", fontSize: 15 }}>
                          {i.item}
                          {i.condition && (
                            <span style={{ marginLeft: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8A8272", fontFamily: "'Helvetica Neue', sans-serif" }}>
                              {i.condition === "new" ? "New" : "Used"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontFamily: "'Helvetica Neue', sans-serif", fontSize: 13, color: "#6B6459", marginTop: 2 }}>{i.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {step === "sorted" && grouped.donate.length > 0 && (
              <button onClick={handleFindPlaces} style={buttonStyle}>
                <MapPin size={16} /> Find places near {location || "you"} that need these
              </button>
            )}

            {step === "searching" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "'Helvetica Neue', sans-serif", color: "#6B6459" }}>
                <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Searching near {location}...
              </div>
            )}

            {error && step === "sorted" && (
              <div style={{ color: "#A44A3F", fontSize: 14, marginTop: 10, fontFamily: "'Helvetica Neue', sans-serif" }}>{error}</div>
            )}

            {step === "done" && contactCard}

            {step === "done" && places && (
              <div style={{ marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <MapPin size={16} color="#3D5A45" />
                  <span style={{ fontFamily: "'Helvetica Neue', sans-serif", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, color: "#3D5A45" }}>
                    Places to donate
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {places.map((s, idx) => {
                    const saved = savedNames.has(s.name);
                    return (
                      <div key={idx} style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", border: "1px solid #E8E3D9" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ fontWeight: 600, color: "#2A2622" }}>{s.name}</div>
                          <button
                            onClick={() => toggleContact(s)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              flexShrink: 0,
                              padding: "5px 10px",
                              borderRadius: 7,
                              border: saved ? "none" : "1px solid #CBDAC6",
                              background: saved ? "#3D5A45" : "#fff",
                              color: saved ? "#fff" : "#3D5A45",
                              fontFamily: "'Helvetica Neue', sans-serif",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {saved ? <><Check size={13} /> Saved</> : <><Star size={13} /> Save</>}
                          </button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'Helvetica Neue', sans-serif", fontSize: 13, color: "#6B6459", marginTop: 4 }}>
                          {destination === "dv" && <Phone size={12} />}
                          {s.contact}
                        </div>
                        {s.acceptsItems?.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {s.acceptsItems.map((it, k) => (
                              <span key={k} style={{ fontFamily: "'Helvetica Neue', sans-serif", fontSize: 11, background: "#E8EFE7", color: "#3D5A45", padding: "3px 8px", borderRadius: 100 }}>
                                {it}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div style={{ fontFamily: "'Helvetica Neue', sans-serif", fontSize: 13, color: "#6B6459", marginTop: 8 }}>{s.notes}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontFamily: "'Helvetica Neue', sans-serif", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9C5B3C", fontWeight: 600, marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #E8E3D9",
  fontSize: 15,
  background: "#fff",
  color: "#2A2622",
  boxSizing: "border-box",
  fontFamily: "'Iowan Old Style', 'Georgia', serif",
};

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  justifyContent: "center",
  padding: "13px 22px",
  borderRadius: 10,
  border: "none",
  background: "#3D5A45",
  color: "#fff",
  fontFamily: "'Helvetica Neue', sans-serif",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  width: "100%",
};
