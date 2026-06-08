/**
 * Policy layer — the SOFTWARE guardrail (first of Sentinel's two checks).
 *
 * Pure, deterministic, fully unit-tested. Runs BEFORE the device ever sees a tx:
 * an intent that fails here is refused locally and never reaches the Ledger.
 * The second guardrail is the human approval on the device itself.
 */
export type Intent = { to: string; amountEth: string };
export type Policy = { maxAmountEth: number; allowlist: string[] };
export type Verdict = { ok: boolean; reason: string };

export function checkPolicy(intent: Intent, policy: Policy): Verdict {
  const amount = Number(intent.amountEth);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: `Invalid amount: ${intent.amountEth}` };
  }
  if (amount > policy.maxAmountEth) {
    return { ok: false, reason: `Amount ${amount} exceeds cap ${policy.maxAmountEth} ETH` };
  }
  const allowed = policy.allowlist.map((a) => a.toLowerCase());
  if (!allowed.includes(intent.to.toLowerCase())) {
    return { ok: false, reason: `Recipient ${intent.to} is not on the allowlist` };
  }
  return { ok: true, reason: "ok" };
}
