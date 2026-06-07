/**
 * M0 spike — the green-light gate.
 *
 * Proves the no-hardware path end to end: build the DMK pointed at Speculos,
 * discover the emulated device, open a session, and derive an Ethereum address.
 * If this prints an address, signer.ts can be built with confidence.
 *
 * Prereq: Speculos running with the Ethereum app on http://localhost:5000
 *   (see speculos/README.md). Run this from a SECOND terminal:
 *     npm run spike:address
 */
import "dotenv/config";
import { DeviceManagementKitBuilder } from "@ledgerhq/device-management-kit";
import {
  speculosTransportFactory,
  speculosIdentifier,
} from "@ledgerhq/device-transport-kit-speculos";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { firstValueFrom, filter, map } from "rxjs";

// DMK's DeviceActionStatus enum is type-only at the package root in this version
// (not a runtime value export), so we match its stable string values directly.
const STATUS_COMPLETED = "completed";
const STATUS_ERROR = "error";

const SPECULOS_URL = process.env.SPECULOS_URL ?? "http://localhost:5000";
const DERIVATION_PATH = "44'/60'/0'/0/0";

async function main() {
  console.log(`[spike] connecting to Speculos at ${SPECULOS_URL} ...`);

  const dmk = new DeviceManagementKitBuilder()
    .addTransport(speculosTransportFactory(SPECULOS_URL))
    .build();

  // Discover the single emulated device, then open a session -> sessionId.
  const device = await firstValueFrom(
    dmk.startDiscovering({ transport: speculosIdentifier }),
  );
  console.log("[spike] device discovered, opening session ...");

  const sessionId = await dmk.connect({ device });
  console.log(`[spike] session opened: ${sessionId}`);

  // Build the Ethereum signer from the same session and derive the address.
  const signerEth = new SignerEthBuilder({ dmk, sessionId }).build();
  const { observable } = signerEth.getAddress(DERIVATION_PATH, {
    checkOnDevice: false,
  });

  const output = await firstValueFrom(
    observable.pipe(
      filter(
        (s) =>
          s.status === STATUS_COMPLETED || s.status === STATUS_ERROR,
      ),
      map((s) => {
        if (s.status === STATUS_ERROR) throw (s as { error: unknown }).error;
        return (s as { output: { address: string; publicKey: string } }).output;
      }),
    ),
  );

  console.log(`\n✅ Address: ${output.address}`);
  console.log(`   Public key: ${output.publicKey}`);

  await dmk.disconnect({ sessionId });
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ [spike] FAILED:", err);
  process.exit(1);
});
