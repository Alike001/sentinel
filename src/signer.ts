/**
 * Signer layer — the hardware boundary.
 *
 * Wraps the confirmed M0 pattern (see speculos/README.md) into two reusable calls:
 *  - connectAndGetSigner() -> opens a Speculos session, derives the device address
 *  - signTxBytes(...)      -> asks the device to sign; resolves with r/s/v after approval
 *
 * The agent never sees a private key. Signing only completes when a human approves
 * on the (emulated) Ledger screen — that human-in-the-loop is the whole point.
 *
 * NOTE: DeviceActionStatus is a type-only export at the package root in this version,
 * so we compare status against its stable string values ("completed"/"error"/"pending").
 */
import "dotenv/config";
import { DeviceManagementKitBuilder } from "@ledgerhq/device-management-kit";
import {
  speculosTransportFactory,
  speculosIdentifier,
} from "@ledgerhq/device-transport-kit-speculos";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { firstValueFrom, filter, map, tap } from "rxjs";
import type { Hex } from "viem";
import type { LedgerSig } from "./chain";

const SPECULOS_URL = process.env.SPECULOS_URL ?? "http://localhost:5000";
const DERIVATION_PATH = process.env.DERIVATION_PATH ?? "44'/60'/0'/0/0";

const STATUS_COMPLETED = "completed";
const STATUS_ERROR = "error";
const STATUS_PENDING = "pending";

export type Signer = Awaited<ReturnType<typeof connectAndGetSigner>>;

/** Connect to Speculos, open a session, and derive the device's Ethereum address. */
export async function connectAndGetSigner() {
  const dmk = new DeviceManagementKitBuilder()
    .addTransport(speculosTransportFactory(SPECULOS_URL))
    .build();

  const device = await firstValueFrom(
    dmk.startDiscovering({ transport: speculosIdentifier }),
  );
  const sessionId = await dmk.connect({ device });
  const signerEth = new SignerEthBuilder({ dmk, sessionId }).build();

  const { observable } = signerEth.getAddress(DERIVATION_PATH, {
    checkOnDevice: false,
  });
  const output = await firstValueFrom(
    observable.pipe(
      filter((s) => s.status === STATUS_COMPLETED || s.status === STATUS_ERROR),
      map((s) => {
        if (s.status === STATUS_ERROR) throw (s as { error: unknown }).error;
        return (s as { output: { address: Hex } }).output;
      }),
    ),
  );

  return { dmk, sessionId, signerEth, address: output.address };
}

/** Ask the device to sign the RLP-encoded unsigned tx; resolves with r/s/v after approval. */
export async function signTxBytes(
  signerEth: Signer["signerEth"],
  bytes: Uint8Array,
): Promise<LedgerSig> {
  const { observable } = signerEth.signTransaction(DERIVATION_PATH, bytes);
  return firstValueFrom(
    observable.pipe(
      tap((s) => {
        if (s.status === STATUS_PENDING) {
          console.log("→ Review and APPROVE the transaction on the Ledger (Speculos) screen …");
        }
      }),
      filter((s) => s.status === STATUS_COMPLETED || s.status === STATUS_ERROR),
      map((s) => {
        if (s.status === STATUS_ERROR) throw (s as { error: unknown }).error;
        const out = (s as { output: { r: Hex; s: Hex; v: number } }).output;
        return { r: out.r, s: out.s, v: Number(out.v) };
      }),
    ),
  );
}
