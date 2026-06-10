# Signet

*A Ledger-guarded AI agent.*

**An AI agent that proposes Ethereum transactions but cannot move a single wei without a human approving on a Ledger device.**

**[Watch the demo (1:36) →](https://youtu.be/ZVlNclt1jbs)**

*Built for the Ledger "Agent Stack: Build & Show" bounty (2026). Sponsor targeted: Ledger — Device Management Kit + Ethereum signer kit + Speculos.*

Live proof on Sepolia: an agent-built transaction, approved on the device, broadcast on-chain — [`0xe4e8f7…05add0`](https://sepolia.etherscan.io/tx/0xe4e8f72664d5f11fc2e4240f2500403ce5ca759bd1b28b2433096e22eb05add0).

---

## The problem

AI agents that transact today hold a raw private key — in an environment variable, a config file, or memory. That key is the whole bank account. One prompt injection, one leaked `.env`, one over-eager tool call, and the agent (or whoever hijacked it) can drain the wallet with no one in the loop. Agents are gaining autonomy far faster than they are gaining accountability, and a software key gives an agent unchecked, irreversible spending power. The missing layer is a checkpoint between an agent's *decision* to spend and the *irreversible* on-chain action.

## The solution

Signet turns plain English into a Sepolia transaction, then forces every signature through two independent guardrails: a **software policy** (spending cap + recipient allowlist) that runs first, and a **hardware approval** on a Ledger device that runs last. The agent holds no private key — the key never leaves the device. An intent that breaks policy is refused locally and the device is never touched; an intent that passes still cannot move funds until a human approves it on the device screen.

## What the demo shows

No setup needed to follow along — the video runs three plain-English commands, one after another:

1. **A valid payment goes through — but only after a human approves.** *"send 0.001 ETH to 0x…dEaD"* — the agent reads the request and the policy approves it, then it stops and waits. Nothing moves until a person presses approve on the Ledger screen. After approval, the payment sends and a public Etherscan receipt appears.
2. **A payment to the wrong recipient is blocked.** The same small amount, but to an address that isn't on the approved list — Signet refuses it on its own, instantly, and the Ledger is never even asked.
3. **A payment that is too large is blocked.** The right recipient, but more than the set limit — again refused before the device is ever involved.

Together they show the single idea behind Signet: the agent can *suggest* a payment, but it can never *spend* on its own.

## Quick start

> Just want to see it work? The demo video above shows the whole flow end to end — running it yourself is optional and only needed to reproduce it. It requires [Docker](https://docs.docker.com/get-docker/).

```bash
git clone https://github.com/Alike001/signet.git
cd signet
npm install
```

Set these in a `.env` file at the repo root (it is gitignored):

```bash
GROQ_API_KEY=your_groq_key          # console.groq.com (free)
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
SPECULOS_SEED=your throwaway twelve word testnet mnemonic
DERIVATION_PATH=44'/60'/0'/0/0
SPECULOS_URL=http://localhost:5000
```

Start the emulated Ledger (Speculos running the Ethereum app — see [`speculos/README.md`](speculos/README.md) for the one-time app setup), fund the device address on Sepolia, then:

```bash
npm start -- "send 0.001 ETH to 0x000000000000000000000000000000000000dEaD"
```

You review and approve on the device screen at [localhost:5000](http://localhost:5000); on approval, Signet prints the Etherscan link. No physical Ledger required — Speculos is a valid emulator of the real device, and the same code targets hardware by swapping the transport.

## Stack

| Layer | Technology |
| ----- | ---------- |
| Intent parsing | **Groq** (`llama-3.3-70b-versatile`, JSON mode) |
| Hardware signer | **Ledger Device Management Kit** + `device-signer-kit-ethereum` |
| Device | **Speculos** emulator running the Ethereum app |
| Transport | **`@ledgerhq/device-transport-kit-speculos`** |
| Chain client | viem (EIP-1559, Sepolia) |
| Runtime / tests | Node.js + TypeScript (tsx), vitest (TDD) |

## How it works

```
  "send 0.001 ETH to 0x…dEaD"
            │
            ▼
   ┌─────────────────┐   parse    ┌──────────┐
   │  agent (Groq)   │ ─────────► │  intent  │
   └─────────────────┘            └────┬─────┘
                       GUARDRAIL 1     │
                  ┌────────────────────▼─────────────────┐
                  │ policy: spending cap + allowlist      │── fail ─► refused locally
                  └────────────────────┬──────────────────┘          (device untouched)
                                       │ pass
                  ┌────────────────────▼──────────────────┐
                  │ chain: build unsigned EIP-1559 tx      │
                  └────────────────────┬──────────────────┘
        ── hardware boundary ──────────┼──── key never crosses this line ──
                       GUARDRAIL 2      ▼
                  ┌───────────────────────────────────────┐
                  │ Ledger device (Speculos)              │── reject ─► aborted
                  │ human reviews + approves on screen     │
                  └────────────────────┬──────────────────┘
                                       │ r, s, v
                                       ▼
                            broadcast ─► Sepolia
```

Five small modules: `agent.ts` (NL → intent), `policy.ts` (the software guard, pure and unit-tested), `chain.ts` (build/encode/broadcast the EIP-1559 tx), `signer.ts` (the hardware boundary via DMK + Speculos), and `index.ts` (the CLI that wires them). The agent never sees a key; signing happens behind the device transport, and only a human approval produces the `r, s, v` needed to broadcast.

## Bounty alignment — Ledger

- **Device Management Kit is the core, not a bolt-on.** Signet uses DMK, the Ethereum signer kit, and the Speculos transport to make every signature require on-device human approval — exactly the agent-plus-hardware-accountability layer the bounty asks for.
- **Proof of use without hardware.** The full flow runs against the Speculos emulator and broadcasts real Sepolia transactions, so the demo is reproducible by any judge with Docker — no physical Ledger needed.
- **Two guardrails, not one.** The software policy and the hardware approval are independent: bypassing the agent's logic still hits the device, and breaking policy never reaches it.

## Future roadmap

- Clear-signing (EIP-712 / origin token) so the device shows decoded intent instead of raw hex
- Richer policy engine: daily ceilings, rate limits, per-recipient caps, time windows
- ERC-20 transfers and allowlisted contract calls (function-selector allowlist), not just ETH sends
- Real Ledger hardware path — same code, swap the Speculos transport for USB/BLE
- Signed audit log of every approved and refused intent

## Limitations

Sepolia testnet only; no custody of real funds. The signer runs against the Speculos emulator (the same DMK code targets a physical device by changing the transport). The policy is a deliberately simple cap-and-allowlist guard, not a production policy engine. These are scoping choices for the bounty, called out honestly rather than hidden.

## Team

- **Hammed Ali Oyeleye** — solo build (agent, policy, chain, hardware signer, CLI) — [GitHub](https://github.com/Alike001) · [Telegram](https://t.me/IamAlikeX)

## Acknowledgements

Built on Ledger's [Device Management Kit](https://github.com/LedgerHQ/device-sdk-ts) and [Speculos](https://github.com/LedgerHQ/speculos), with the Ethereum app from [LedgerHQ/app-ethereum](https://github.com/LedgerHQ/app-ethereum).
