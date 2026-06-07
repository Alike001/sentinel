# Speculos + DMK — notes

This folder holds the emulator setup and the **confirmed** Ledger Device Management Kit (DMK)
API that `src/signer.ts` depends on. The API below was verified against Ledger's official
`ledgerhq/agent-skills` (skill `ledger-dmk-implementation`) and the installed npm packages — not guessed.

## Runtime gotcha: this project is CommonJS, not ESM

The `@ledgerhq/*` packages (and viem) are bundler-targeted. Their **ESM** builds use
extensionless directory imports that Node's native ESM loader cannot resolve
(`ERR_UNSUPPORTED_DIR_IMPORT` / "does not provide an export named …"). Their **CJS**
builds work perfectly under Node.

Fix (already applied): the project is CommonJS — no `"type": "module"` in `package.json`,
and `tsconfig.json` uses `"module": "CommonJS"`, `"moduleResolution": "node"`. We still
write normal `import { … } from …` syntax; tsx/esbuild transpiles it to `require`, so Node
picks each package's working `require` build. Keep it this way for every `src/*.ts` file.

## Spike result (Task 0.4 — green-light gate ✅)

`npm run spike:address` against Speculos prints the address derived by the emulated device:
```
✅ Address: 0xDad77910DbDFdE764fC21FCD4E74D71bBACA6D8D
```
(That's the address for Speculos' default test seed.) M0 is complete: no hardware required.

## Confirmed DMK connect API

```ts
import { DeviceManagementKitBuilder, DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { speculosTransportFactory } from "@ledgerhq/device-transport-kit-speculos";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { firstValueFrom, filter, map } from "rxjs";

// 1. Build the DMK pointed at Speculos (URL optional; defaults to http://127.0.0.1:5000)
const dmk = new DeviceManagementKitBuilder()
  .addTransport(speculosTransportFactory("http://localhost:5000"))
  .build();

// 2. Discover one device, then connect -> sessionId (Promise<DeviceSessionId>)
//    Speculos discovery uses the exported `speculosIdentifier` (TransportIdentifier).
import { speculosIdentifier } from "@ledgerhq/device-transport-kit-speculos";
const device = await firstValueFrom(dmk.startDiscovering({ transport: speculosIdentifier }));
const sessionId = await dmk.connect({ device });

// 3. Build the Ethereum signer from the same sessionId
const signerEth = new SignerEthBuilder({ dmk, sessionId }).build();
// (originToken is OPTIONAL — omit it and the device shows raw hex, fine for our demo)

// 4. Get address — BIP32 path is a PLAIN STRING, not an array
const { observable } = signerEth.getAddress("44'/60'/0'/0/0", { checkOnDevice: true });
const out = await firstValueFrom(
  observable.pipe(
    filter((s) => s.status === DeviceActionStatus.Completed || s.status === DeviceActionStatus.Error),
    map((s) => { if (s.status === DeviceActionStatus.Error) throw s.error; return s.output; }),
  ),
);
// out.address -> "0x..."   out.publicKey -> "0x..."

// 5. Sign a transaction (txBytes = RLP-encoded Uint8Array of the unsigned EIP-1559 tx)
const { observable: sigObs } = signerEth.signTransaction("44'/60'/0'/0/0", txBytes);
// Completed -> state.output.r, state.output.s, state.output.v
```

### Key facts (source: agent-skills + installed pkgs)

- `dmk.connect({ device })` returns `Promise<DeviceSessionId>`. Every other async op returns
  `{ observable, cancel }`. (sdk-reference.md:55)
- Sessions are chain-agnostic; one `sessionId` works for any signer. Don't disconnect between ops.
- `speculosTransportFactory(speculosUrl?, isE2E?, deviceModelId?)` — all args optional; URL defaults
  to `http://127.0.0.1:5000`. Package also exports `SpeculosTransport`.
- Device-action status is the string enum `DeviceActionStatus` → `.Completed` / `.Error` /
  `.Pending` / `.NotStarted` / `.Stopped`.
- User rejection surfaces as `RefusedByUserDAError` (status words `5501` / `6985`) — treat as a
  distinct "rejected" outcome, NOT a red error.
- Observable → single value via `firstValueFrom(obs.pipe(filter(Completed||Error), map(...)))`.

## Speculos launch (Task 0.3)

### 1. Get the Ethereum app ELF (no compilation — Ledger CI prebuilt)

The Ethereum app `.elf` is **not** redistributed in this repo (gitignored). Fetch it from Ledger's
own CI build artifact with an authenticated `gh`:

```bash
# 'ragger_elfs' contains app.elf for every device model. nanos2 == Nano S Plus (nanosp).
gh run download 27026623553 -R LedgerHQ/app-ethereum -n ragger_elfs -D speculos/elfs
cp speculos/elfs/nanos2/bin/app.elf speculos/apps/ethereum.elf
```

Verified binary: ELF 32-bit ARM, **Ethereum app v1.23.0-dev**, supports both `signTransaction`
and `signMessage`. If that run ID has expired (>90d), list newer ones with:
`gh api "repos/LedgerHQ/app-ethereum/actions/runs?status=success&per_page=20" --jq '.workflow_runs[]|"\(.id) \(.name)"'`
and pick a "Build and run functional tests" run that still has a non-expired `ragger_elfs` artifact.

### 2. Run Speculos with the app (Docker)

```bash
docker pull ghcr.io/ledgerhq/speculos:latest
docker run --rm -it -v $PWD/speculos/apps:/apps -p 5000:5000 \
  ghcr.io/ledgerhq/speculos:latest \
  --model nanosp --display headless --api-port 5000 /apps/ethereum.elf
```

- API + web screen: **http://localhost:5000** (the DMK Speculos transport talks HTTP to this URL).
- Approve / reject on the web screen: the two buttons emulate the device's left/right buttons;
  press both (or the on-screen approve control) to confirm, reject to refuse.
- Leave this running in its own terminal; run the app/spike from a second terminal.
