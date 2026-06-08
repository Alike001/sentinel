/**
 * Agent layer — plain English -> structured intent, via Groq.
 *
 * The LLM is injectable (the `llm` arg) so the parsing/validation logic is unit-tested
 * with a fake model and no network. The default `groqCall` hits Groq's OpenAI-compatible
 * API. Whatever the model returns, we validate hard here — a bad address or amount throws
 * before it can ever reach the policy check or the device.
 */
import "dotenv/config";
import type { Intent } from "./policy";

export type LlmCall = (prompt: string) => Promise<string>;

const SYSTEM = `You convert a user's request into a JSON object {"to": "0x...", "amountEth": "<decimal>"}.
Return ONLY the JSON. "to" must be a 42-char 0x address; "amountEth" a decimal string. No prose.`;

export async function parseIntent(text: string, llm: LlmCall = groqCall): Promise<Intent> {
  const raw = await llm(text);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Model did not return JSON: ${raw}`);

  const obj = JSON.parse(match[0]);
  if (!/^0x[0-9a-fA-F]{40}$/.test(obj.to)) throw new Error(`Bad address: ${obj.to}`);
  if (!/^\d+(\.\d+)?$/.test(String(obj.amountEth))) throw new Error(`Bad amount: ${obj.amountEth}`);

  return { to: obj.to, amountEth: String(obj.amountEth) };
}

async function groqCall(text: string): Promise<string> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set in .env");
  }

  let res: Response;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
      }),
    });
  } catch (e) {
    // fetch() throws (not an HTTP status) on DNS/connection failures
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not reach Groq — check your internet connection (${cause})`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 401 ? " — check GROQ_API_KEY in .env" : res.status === 429 ? " — rate limited, wait a moment" : "";
    throw new Error(`Groq API returned ${res.status} ${res.statusText}${hint}. ${body.slice(0, 200)}`.trim());
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty response");
  return content;
}
