/**
 * M1 end-to-end proof — sign ONE hardcoded transaction on Sepolia, no agent yet.
 *
 * Flow: connect Speculos -> derive address -> build a 0.001 ETH tx to 0x…dEaD ->
 * ask the device to sign -> reattach the signature -> broadcast -> print Etherscan link.
 *
 * Prereqs:
 *   1. Speculos running with the Ethereum app (see speculos/README.md)
 *   2. The printed `From:` address funded with a little Sepolia ETH
 * Run from a second terminal:  npx tsx src/e2e-hardcoded.ts
 */
import { connectAndGetSigner, signTxBytes } from "./signer";
import { buildUnsignedTx, assembleAndBroadcast } from "./chain";

const TO = "0x000000000000000000000000000000000000dEaD" as const;
const AMOUNT_ETH = "0.001";

async function main() {
  console.log("[e2e] connecting to Speculos …");
  const { signerEth, address } = await connectAndGetSigner();
  console.log(`[e2e] From: ${address}`);

  console.log(`[e2e] building tx: ${AMOUNT_ETH} ETH -> ${TO}`);
  const built = await buildUnsignedTx(address, TO, AMOUNT_ETH);

  const sig = await signTxBytes(signerEth, built.bytes);
  console.log("[e2e] signed ✔  broadcasting …");

  const hash = await assembleAndBroadcast(built, sig);
  console.log(`\n✅ Broadcast: https://sepolia.etherscan.io/tx/${hash}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ [e2e] FAILED:", err);
  process.exit(1);
});
