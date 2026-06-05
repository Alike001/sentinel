# Sentinel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Teaching-mode note (Ali):** This is a learning build. Build/CLI commands are meant to be typed by Ali himself, milestone by milestone, with the assistant guiding — not batched unattended. Commit after each task.

**Goal:** Build Sentinel — a policy-guarded AI agent that turns plain-English intents into Ethereum (Sepolia) transactions, screens them against a software policy, and signs only after human approval on a Ledger device emulated by Speculos.

**Architecture:** Five small TypeScript modules (signer, agent, policy, chain, index) plus a Speculos emulator running the Ethereum app. The agent holds no key; signing happens behind the DMK Speculos transport. Two guardrails: a software policy check, then on-device approval.

**Tech Stack:** Node.js + TypeScript, `@ledgerhq/device-management-kit`, `@ledgerhq/device-transport-kit-speculos`, `@ledgerhq/device-signer-kit-ethereum`, `viem`, Groq SDK, Speculos, `tsx` + `vitest`.

---

## File Structure

- `package.json`, `tsconfig.json` — project config
- `.env` — `GROQ_API_KEY`, `SEPOLIA_RPC_URL`, `SPECULOS_URL`, `DERIVATION_PATH` (gitignored)
- `policy.json` — `{ maxAmountEth, allowlist[] }`
- `speculos/README.md` — how to launch Speculos with the ETH app (commands Ali runs)
- `src/policy.ts` — `checkPolicy(intent, policy) -> { ok, reason }` (pure)
- `src/agent.ts` — `parseIntent(text, llmCall) -> { to, amountEth }`
- `src/chain.ts` — `buildUnsignedTx(intent) -> { tx, txBytes, from }`, `assembleAndBroadcast(tx, signature) -> hash`
- `src/signer.ts` — `connectAndGetSigner() -> { signerEth, sessionId, address }`, `signTxBytes(...) -> { r, s, v }`
- `src/index.ts` — CLI wiring: prompt → parse → policy → build → sign → broadcast
- `test/policy.test.ts`, `test/agent.test.ts`, `test/chain.test.ts` — unit tests

---

## Milestone 0 — Spike: prove Speculos + DMK before building anything

**Goal of M0:** A green light. Speculos runs the Ethereum app; a tiny script connects the DMK via the Speculos transport and prints an Ethereum address. If the ETH app cannot be obtained, fall back to message-signing (see Task 0.5).

### Task 0.1: Scaffold the Node/TS project

**Files:** Create `package.json`, `tsconfig.json`

- [ ] **Step 1: Init project and install deps**

Ali types (one line each):
```bash
cd ~/Desktop/sentinel && npm init -y
```
```bash
npm i @ledgerhq/device-management-kit @ledgerhq/device-transport-kit-speculos @ledgerhq/device-signer-kit-ethereum viem rxjs dotenv
```
```bash
npm i -D typescript tsx vitest @types/node
```

- [ ] **Step 2: Add tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Set package.json to ESM + scripts**

Add these keys to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "start": "tsx src/index.ts",
    "spike:address": "tsx src/spike-address.ts"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold sentinel node/ts project"
```

### Task 0.2: Install Ledger's DMK agent-skills (source of exact API)

**Why:** These skills carry the exact, current DMK connect/session/signer patterns. We read them to confirm the `connect() → sessionId` call before writing `signer.ts`.

- [ ] **Step 1: Install the DMK skills**

```bash
npx skills add ledgerhq/agent-skills -s ledger-dmk-implementation dmk-intent-vocabulary dmk-business-logic
```

- [ ] **Step 2: Read the installed skill for the connect/session pattern**

Open the installed skill files (path printed by the command, typically under `.claude/skills/` or `skills/`). Find the exact call that turns a discovered device into a `sessionId`. Record it in `speculos/README.md` under "Confirmed DMK connect API". Expected shape (verify against the skill):
```typescript
const sessionId = await dmk.connect({ device });
```

- [ ] **Step 3: Commit notes**

```bash
git add -A && git commit -m "docs: capture confirmed DMK connect/session API from agent-skills"
```

### Task 0.3: Launch Speculos with the Ethereum app

**Files:** Create `speculos/README.md`

- [ ] **Step 1: Get Speculos running with the ETH app (Docker route, preferred)**

Ali types (one line each). This pulls the official Speculos image and runs it with the Ethereum app ELF mounted. If you do not yet have an ETH app ELF, do Step 2 first.
```bash
docker pull ghcr.io/ledgerhq/speculos:latest
```
```bash
docker run --rm -it -v $PWD/speculos/apps:/apps -p 5000:5000 -p 9999:9999 ghcr.io/ledgerhq/speculos:latest --model nanosp --display headless --api-port 5000 /apps/ethereum.elf
```
Expected: log line showing the API server on `0.0.0.0:5000`. Open `http://localhost:5000` — the emulated device screen appears.

- [ ] **Step 2: Obtain the Ethereum app ELF (if you don't have one)**

Primary: build it once with Ledger's app-builder image (one line each):
```bash
git clone https://github.com/LedgerHQ/app-ethereum && cd app-ethereum
```
```bash
docker run --rm -v $PWD:/app ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder:latest bash -lc "make BOLOS_SDK=\$NANOSP_SDK -j"
```
Then copy the produced `bin/app.elf` to `~/Desktop/sentinel/speculos/apps/ethereum.elf`.
Fallback: download a prebuilt `nanosp` Ethereum ELF from the app-ethereum repo's CI artifacts / releases and place it at the same path.

- [ ] **Step 3: Write speculos/README.md**

Document the exact pull/run commands that worked, the ELF source, the API URL (`http://localhost:5000`), and how to approve/reject on the web screen. Commit:
```bash
git add -A && git commit -m "docs: speculos launch instructions for the ethereum app"
```

### Task 0.4: Spike script — connect DMK to Speculos and print an address

**Files:** Create `src/spike-address.ts`

- [ ] **Step 1: Write the spike script**

```typescript
import "dotenv/config";
import { DeviceManagementKitBuilder, ConsoleLogger } from "@ledgerhq/device-management-kit";
import { speculosTransportFactory } from "@ledgerhq/device-transport-kit-speculos";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { firstValueFrom, filter } from "rxjs";

const SPECULOS_URL = process.env.SPECULOS_URL ?? "http://localhost:5000";
const DERIVATION_PATH = process.env.DERIVATION_PATH ?? "44'/60'/0'/0/0";

const dmk = new DeviceManagementKitBuilder()
  .addLogger(new ConsoleLogger())
  .addTransport(speculosTransportFactory(SPECULOS_URL))
  .build();

// Discover the (single) emulated device, then connect to get a sessionId.
const device = await firstValueFrom(
  dmk.listenToAvailableDevices({}).pipe(filter((d: any) => d && d.length > 0))
).then((list: any) => list[0]);

const sessionId = await dmk.connect({ device }); // CONFIRM against Task 0.2 notes

const signerEth = new SignerEthBuilder({ sdk: dmk, sessionId, originToken: "sentinel" }).build();

const { observable } = signerEth.getAddress(DERIVATION_PATH, { checkOnDevice: false });
observable.subscribe({
  next: (state: any) => {
    if (state.status === "completed") console.log("Address:", state.output.address);
  },
  error: (e: any) => { console.error(e); process.exit(1); },
  complete: () => process.exit(0),
});
```

- [ ] **Step 2: Run it (Speculos must be running)**

```bash
npm run spike:address
```
Expected: prints `Address: 0x...`. If `dmk.connect` or the status string differs, fix using the Task 0.2 notes (e.g. `DeviceActionStatus.Completed`).

- [ ] **Step 3: GREEN-LIGHT GATE + commit**

Only proceed past M0 once an address prints. Commit:
```bash
git add -A && git commit -m "spike: connect DMK to speculos and read eth address"
```

### Task 0.5: Fallback (only if the ETH app cannot be loaded)

- [ ] **Step 1:** Switch the spike and later signing to `signerEth.signMessage(DERIVATION_PATH, "Sentinel approved this")` (still a real DMK on-device signing flow). Update the spec's narrative from "sign a transfer" to "sign an agent-authored message under human approval." Note this decision in `speculos/README.md`. The rest of the plan's policy/agent layers are unchanged; the chain broadcast (Task 3.2) is dropped.

---

## Milestone 1 — Sign one hardcoded transaction, end-to-end on Sepolia

### Task 1.1: Chain layer — build an unsigned EIP-1559 tx

**Files:** Create `src/chain.ts`, `test/chain.test.ts`, `.env`

- [ ] **Step 1: Add .env (gitignored)**

```
SPECULOS_URL=http://localhost:5000
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
DERIVATION_PATH=44'/60'/0'/0/0
GROQ_API_KEY=
```

- [ ] **Step 2: Write the failing test for tx encoding**

```typescript
// test/chain.test.ts
import { describe, it, expect } from "vitest";
import { encodeUnsigned } from "../src/chain";

describe("encodeUnsigned", () => {
  it("serializes an unsigned eip1559 tx to a 0x02-prefixed hex and matching bytes", () => {
    const tx = {
      chainId: 11155111,
      nonce: 0,
      to: "0x000000000000000000000000000000000000dEaD" as const,
      value: 10000000000000000n, // 0.01 ETH
      gas: 21000n,
      maxFeePerGas: 30000000000n,
      maxPriorityFeePerGas: 1500000000n,
    };
    const { serialized, bytes } = encodeUnsigned(tx);
    expect(serialized.startsWith("0x02")).toBe(true);
    expect(bytes[0]).toBe(0x02);
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

```bash
npx vitest run test/chain.test.ts
```
Expected: FAIL (`encodeUnsigned` not exported).

- [ ] **Step 4: Implement chain.ts (encode + helpers)**

```typescript
// src/chain.ts
import "dotenv/config";
import {
  createPublicClient, http, serializeTransaction, hexToBytes,
  type Hex, type Address,
} from "viem";
import { sepolia } from "viem/chains";

const RPC = process.env.SEPOLIA_RPC_URL!;
export const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });

export type Eip1559 = {
  chainId: number; nonce: number; to: Address; value: bigint;
  gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint;
};

export function encodeUnsigned(tx: Eip1559): { serialized: Hex; bytes: Uint8Array } {
  const serialized = serializeTransaction({ type: "eip1559", ...tx });
  return { serialized, bytes: hexToBytes(serialized) };
}

export async function buildUnsignedTx(from: Address, to: Address, amountEth: string): Promise<Eip1559 & { serialized: Hex; bytes: Uint8Array }> {
  const value = BigInt(Math.round(Number(amountEth) * 1e18));
  const nonce = await publicClient.getTransactionCount({ address: from });
  const fees = await publicClient.estimateFeesPerGas();
  const tx: Eip1559 = {
    chainId: sepolia.id, nonce, to, value, gas: 21000n,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };
  return { ...tx, ...encodeUnsigned(tx) };
}

export async function assembleAndBroadcast(tx: Eip1559, sig: { r: Hex; s: Hex; v: number }): Promise<Hex> {
  const serialized = serializeTransaction({ type: "eip1559", ...tx }, { r: sig.r, s: sig.s, yParity: sig.v & 1 });
  return publicClient.sendRawTransaction({ serializedTransaction: serialized });
}
```

- [ ] **Step 5: Run the test — verify it passes**

```bash
npx vitest run test/chain.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: chain layer — encode/build/broadcast eip1559 on sepolia"
```

### Task 1.2: Signer layer — wrap the M0 spike into reusable functions

**Files:** Create `src/signer.ts`

- [ ] **Step 1: Implement signer.ts using the confirmed M0 pattern**

```typescript
// src/signer.ts
import "dotenv/config";
import { DeviceManagementKitBuilder, ConsoleLogger } from "@ledgerhq/device-management-kit";
import { speculosTransportFactory } from "@ledgerhq/device-transport-kit-speculos";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { firstValueFrom, filter } from "rxjs";
import type { Hex } from "viem";

const SPECULOS_URL = process.env.SPECULOS_URL ?? "http://localhost:5000";
const DERIVATION_PATH = process.env.DERIVATION_PATH ?? "44'/60'/0'/0/0";

export async function connectAndGetSigner() {
  const dmk = new DeviceManagementKitBuilder()
    .addLogger(new ConsoleLogger())
    .addTransport(speculosTransportFactory(SPECULOS_URL))
    .build();
  const device = await firstValueFrom(
    dmk.listenToAvailableDevices({}).pipe(filter((d: any) => d && d.length > 0))
  ).then((list: any) => list[0]);
  const sessionId = await dmk.connect({ device });
  const signerEth = new SignerEthBuilder({ sdk: dmk, sessionId, originToken: "sentinel" }).build();
  const address = await new Promise<`0x${string}`>((resolve, reject) => {
    const { observable } = signerEth.getAddress(DERIVATION_PATH, { checkOnDevice: false });
    observable.subscribe({
      next: (s: any) => { if (s.status === "completed") resolve(s.output.address); },
      error: reject,
    });
  });
  return { dmk, signerEth, address };
}

export function signTxBytes(signerEth: any, bytes: Uint8Array): Promise<{ r: Hex; s: Hex; v: number }> {
  return new Promise((resolve, reject) => {
    const { observable } = signerEth.signTransaction(DERIVATION_PATH, bytes, {});
    observable.subscribe({
      next: (s: any) => {
        if (s.status === "pending") console.log("→ Review and APPROVE on the Ledger screen:", s.intermediateValue?.requiredUserInteraction);
        if (s.status === "completed") resolve({ r: s.output.r, s: s.output.s, v: Number(s.output.v) });
      },
      error: reject,
    });
  });
}
```
(Adjust `"completed"`/`"pending"` to the enum confirmed in M0 if different.)

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: signer layer — connect, getAddress, signTxBytes via speculos"
```

### Task 1.3: Hardcoded end-to-end signing script

**Files:** Create `src/e2e-hardcoded.ts`

- [ ] **Step 1: Write the script**

```typescript
// src/e2e-hardcoded.ts
import { connectAndGetSigner, signTxBytes } from "./signer";
import { buildUnsignedTx, assembleAndBroadcast } from "./chain";

const { signerEth, address } = await connectAndGetSigner();
console.log("From:", address);
const built = await buildUnsignedTx(address, "0x000000000000000000000000000000000000dEaD", "0.001");
const sig = await signTxBytes(signerEth, built.bytes);
const hash = await assembleAndBroadcast(built, sig);
console.log("Broadcast:", `https://sepolia.etherscan.io/tx/${hash}`);
process.exit(0);
```

- [ ] **Step 2: Fund the address, then run (Speculos running)**

Get the printed `From:` address, fund it from a Sepolia faucet, then:
```bash
npx tsx src/e2e-hardcoded.ts
```
Expected: prompts you to approve on the Speculos screen; after approval, prints an Etherscan link. Open it — tx confirmed.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: hardcoded end-to-end sign+broadcast on sepolia"
```

---

## Milestone 2 — Add the agent + policy layers

### Task 2.1: Policy layer (pure, TDD)

**Files:** Create `src/policy.ts`, `policy.json`, `test/policy.test.ts`

- [ ] **Step 1: Add policy.json**

```json
{ "maxAmountEth": 0.05, "allowlist": ["0x000000000000000000000000000000000000dEaD"] }
```

- [ ] **Step 2: Write failing tests**

```typescript
// test/policy.test.ts
import { describe, it, expect } from "vitest";
import { checkPolicy } from "../src/policy";

const policy = { maxAmountEth: 0.05, allowlist: ["0x000000000000000000000000000000000000dEaD"] };

describe("checkPolicy", () => {
  it("allows an in-policy intent", () => {
    expect(checkPolicy({ to: "0x000000000000000000000000000000000000dEaD", amountEth: "0.01" }, policy).ok).toBe(true);
  });
  it("rejects over the cap", () => {
    const r = checkPolicy({ to: "0x000000000000000000000000000000000000dEaD", amountEth: "1" }, policy);
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/cap/i);
  });
  it("rejects a recipient not on the allowlist", () => {
    const r = checkPolicy({ to: "0x1111111111111111111111111111111111111111", amountEth: "0.01" }, policy);
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/allowlist/i);
  });
});
```

- [ ] **Step 3: Run — verify fail**

```bash
npx vitest run test/policy.test.ts
```
Expected: FAIL (`checkPolicy` not exported).

- [ ] **Step 4: Implement policy.ts**

```typescript
// src/policy.ts
export type Intent = { to: string; amountEth: string };
export type Policy = { maxAmountEth: number; allowlist: string[] };

export function checkPolicy(intent: Intent, policy: Policy): { ok: boolean; reason: string } {
  const amount = Number(intent.amountEth);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "Invalid amount" };
  if (amount > policy.maxAmountEth) return { ok: false, reason: `Amount ${amount} exceeds cap ${policy.maxAmountEth} ETH` };
  const allowed = policy.allowlist.map((a) => a.toLowerCase());
  if (!allowed.includes(intent.to.toLowerCase())) return { ok: false, reason: `Recipient ${intent.to} is not on the allowlist` };
  return { ok: true, reason: "ok" };
}
```

- [ ] **Step 5: Run — verify pass; commit**

```bash
npx vitest run test/policy.test.ts && git add -A && git commit -m "feat: software policy guardrail (cap + allowlist)"
```

### Task 2.2: Agent layer (Groq NL → intent)

**Files:** Create `src/agent.ts`, `test/agent.test.ts`

- [ ] **Step 1: Write failing test for JSON extraction (injectable LLM)**

```typescript
// test/agent.test.ts
import { describe, it, expect } from "vitest";
import { parseIntent } from "../src/agent";

describe("parseIntent", () => {
  it("parses a structured intent from the model's JSON reply", async () => {
    const fakeLlm = async () => '{"to":"0x000000000000000000000000000000000000dEaD","amountEth":"0.01"}';
    const intent = await parseIntent("send 0.01 ETH to 0x...dEaD", fakeLlm);
    expect(intent).toEqual({ to: "0x000000000000000000000000000000000000dEaD", amountEth: "0.01" });
  });
  it("throws on non-JSON model output", async () => {
    const fakeLlm = async () => "I cannot help with that";
    await expect(parseIntent("hello", fakeLlm)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npx vitest run test/agent.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement agent.ts**

```typescript
// src/agent.ts
import "dotenv/config";

export type Intent = { to: string; amountEth: string };
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
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }],
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
```

- [ ] **Step 4: Run — verify pass; commit**

```bash
npx vitest run test/agent.test.ts && git add -A && git commit -m "feat: agent layer — groq NL to structured intent"
```

---

## Milestone 3 — Wire the CLI and record

### Task 3.1: CLI entrypoint

**Files:** Create `src/index.ts`

- [ ] **Step 1: Implement index.ts**

```typescript
// src/index.ts
import { readFileSync } from "node:fs";
import { parseIntent } from "./agent";
import { checkPolicy, type Policy } from "./policy";
import { buildUnsignedTx, assembleAndBroadcast } from "./chain";
import { connectAndGetSigner, signTxBytes } from "./signer";

const prompt = process.argv.slice(2).join(" ");
if (!prompt) { console.error('Usage: npm start -- "send 0.01 ETH to 0x..."'); process.exit(1); }

const policy: Policy = JSON.parse(readFileSync("policy.json", "utf8"));

console.log("🤖 Sentinel: parsing intent...");
const intent = await parseIntent(prompt);
console.log("   Intent:", intent);

console.log("🛡️  Software policy check...");
const verdict = checkPolicy(intent, policy);
if (!verdict.ok) { console.error("   ❌ Refused locally:", verdict.reason); process.exit(2); }
console.log("   ✅ Policy passed.");

console.log("🔌 Connecting to Ledger (Speculos)...");
const { signerEth, address } = await connectAndGetSigner();
console.log("   From:", address);

const built = await buildUnsignedTx(address, intent.to as `0x${string}`, intent.amountEth);
console.log("🔐 Hardware approval required — review on the device screen...");
const sig = await signTxBytes(signerEth, built.bytes);

const hash = await assembleAndBroadcast(built, sig);
console.log("📡 Broadcast:", `https://sepolia.etherscan.io/tx/${hash}`);
process.exit(0);
```

- [ ] **Step 2: Run the full flow (Speculos running, address funded)**

```bash
npm start -- "send 0.01 ETH to 0x000000000000000000000000000000000000dEaD"
```
Expected: parse → policy pass → device approval prompt → approve → Etherscan link. Also test a refusal:
```bash
npm start -- "send 5 ETH to 0x1111111111111111111111111111111111111111"
```
Expected: `❌ Refused locally: Amount 5 exceeds cap ...` (device never touched).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: sentinel CLI — intent → policy → hardware approval → broadcast"
```

### Task 3.2: Record proof-of-use

- [ ] **Step 1:** Screen-record one happy path (approval → Etherscan) and one policy refusal, showing the Speculos screen at `http://localhost:5000`. Save as `demo.mp4`. This recording is the bounty's proof-of-use.

---

## Milestone 4 — Ship deliverables

### Task 4.1: README

- [ ] **Step 1:** Write `README.md`: problem (agents on stealable software keys) → what Sentinel does → the two guardrails → architecture diagram (the flow block from the spec) → exact run instructions (Speculos + `npm start`) → demo clip → honest limitations (Sepolia only, emulator, no custody). Make no security/financial claims that aren't backed. Commit.

### Task 4.2: Publish + submit

- [ ] **Step 1:** Push the repo to `github.com/Alike001/sentinel` (public).
- [ ] **Step 2:** Post on X and/or LinkedIn: short story + demo clip, tag **@Ledger**, include a visible **#LedgerSponsor** disclosure, link the repo.
- [ ] **Step 3:** File the official Google Form on college.xyz bounty #38 with repo + post links. Confirm before the **12 June 2026, 23:59 CET** deadline.

---

## Self-Review notes

- **Spec coverage:** signer (Tasks 0.4, 1.2) · agent (2.2) · policy (2.1) · chain (1.1) · Speculos (0.3) · two-guardrail flow (3.1) · deliverables/README/post/form (M4). All spec sections mapped.
- **Type consistency:** `Intent = { to, amountEth }` shared by agent + policy; `Eip1559` shared by chain + signer call site; signature `{ r, s, v }` produced by `signTxBytes`, consumed by `assembleAndBroadcast` (maps `v` → `yParity`).
- **Known unknowns pinned to M0:** the exact `dmk.connect()` call and the device-action status enum string are confirmed from the installed agent-skills in Task 0.2 before any later task depends on them; the ETH-app-in-Speculos risk has the Task 0.5 message-signing fallback.
