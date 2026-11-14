/**
 * POST /api/ai  { text }
 * The private bookkeeper: turns a freelancer's notes into invoice lines with a
 * model that runs inside NEAR AI Cloud's TEE. Returns the exact request and
 * response bytes plus the enclave's signature over their hashes, so the
 * browser verifies them itself (packages/core/src/signature.ts).
 * Nothing is logged or stored: the text exists only for the life of this request.
 */
import { NEARAI_API, PRIVATE_MODEL } from "@nearvoice/core";
import { HttpError, handle, json, rateLimit, secret } from "./_lib/env.js";

const SYSTEM = `You turn a freelancer's notes into invoice lines. Reply with JSON only, no prose:
{"client": string|null, "items": [{"description": string, "quantity": number, "unitPrice": number}], "dueInDays": number|null, "notes": string|null}
unitPrice is in US dollars. Use quantity for days, hours or units mentioned. Do not invent work that is not in the notes.`;

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "").trim();
    if (text.length < 5 || text.length > 2_000) throw new HttpError(400, "Write 5 to 2,000 characters");
    rateLimit(`ai:${req.headers.get("x-forwarded-for") ?? "?"}`, 20, 60 * 60_000);
    // A daily inference budget for the whole deployment (per instance), set by the operator.
    rateLimit("ai:day", Number(process.env.AI_DAILY_REQUESTS ?? 500), 24 * 60 * 60_000);
    const key = secret("NEARAI_API_KEY");
    // The exact bytes we send are what the enclave hashes and signs.
    const requestBody = JSON.stringify({
      model: PRIVATE_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
      stream: false,
    });
    const res = await fetch(`${NEARAI_API}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: requestBody,
    });
    const responseText = await res.text();
    if (!res.ok) throw new HttpError(502, `NEAR AI Cloud answered ${res.status}: ${responseText.slice(0, 200)}`);
    const chatId = JSON.parse(responseText).id as string;
    const sig = await fetch(`${NEARAI_API}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(PRIVATE_MODEL)}&signing_algo=ecdsa`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const signature = sig.ok ? await sig.json() : null;
    return json({ model: PRIVATE_MODEL, requestBody, responseText, signature });
  });
}
