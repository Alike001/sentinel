import { describe, it, expect } from "vitest";
import { checkPolicy } from "../src/policy";

const policy = {
  maxAmountEth: 0.05,
  allowlist: ["0x000000000000000000000000000000000000dEaD"],
};

describe("checkPolicy", () => {
  it("allows an in-policy intent", () => {
    const r = checkPolicy(
      { to: "0x000000000000000000000000000000000000dEaD", amountEth: "0.01" },
      policy,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects over the cap", () => {
    const r = checkPolicy(
      { to: "0x000000000000000000000000000000000000dEaD", amountEth: "1" },
      policy,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cap/i);
  });

  it("rejects a recipient not on the allowlist", () => {
    const r = checkPolicy(
      { to: "0x1111111111111111111111111111111111111111", amountEth: "0.01" },
      policy,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/allowlist/i);
  });

  it("matches the allowlist case-insensitively", () => {
    const r = checkPolicy(
      { to: "0x000000000000000000000000000000000000dead", amountEth: "0.01" },
      policy,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a zero or non-numeric amount", () => {
    expect(checkPolicy({ to: policy.allowlist[0], amountEth: "0" }, policy).ok).toBe(false);
    expect(checkPolicy({ to: policy.allowlist[0], amountEth: "abc" }, policy).ok).toBe(false);
  });
});
