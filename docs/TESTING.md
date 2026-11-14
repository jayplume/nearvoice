# Testing

```bash
pnpm install
pnpm check                      # Biome lint, TypeScript (every package), all unit and component tests
cd contracts && cargo test      # 20 contract tests
cargo clippy --all-targets -- -D warnings
```

CI runs all of the above on every push (`.github/workflows/ci.yml`) and builds the web app.

## What is covered

| Suite | Tests | What it proves |
|---|---|---|
| `contracts/invoices/src/tests.rs` | 17 | Splits that always add up, with rounding dust to the first recipient; a new invoice is open and pays the issuer by default; paying settles the split and returns any excess; underpaying, paying twice and paying with another token are refused; only the issuer refunds or cancels; the profile's default split and the kill switch (for new invoices and for payments); split shares must sum to 100% with no repeated recipient; the invoice cap; the digest format; lists newest first. Not unit-tested: the `on_payout` callback that holds a failed share for `claim` (cross-contract promise results need a sandbox; see the gaps in AUDIT.md) |
| `contracts/usdc/src/lib.rs` | 3 | Faucet amount and one-hour cooldown; automatic registration of receivers |
| `packages/core/test/core.test.ts` | 13 | Integer money and fractional quantities; seal round trip, a digest mismatch reported, a wrong key and tampered ciphertext refused, the ciphertext not containing the client's name; CSV quoting; attestation against a **real NEAR AI Cloud report** saved with its nonce (`test/fixtures/report.json`): every check passes with our nonce and freshness fails with any other, `report_data` read from the raw TDX quote; EIP-191 signer recovery, and an edited response rejected; the 1Click request body |
| `packages/core/test/relay.test.ts` | 3 | The relayer accepts a Nearvoice account's call to the invoice contract and refuses other contracts, outside accounts, transfers, deposits, unknown methods and excess gas; handle rules |
| `apps/web/src/test/web.test.tsx` | 8 | The browser's split arithmetic against the contract's own test vectors; the invoice paper's lines, exact total, PAID stamp and sealed veil (React Testing Library); status wording; the key vault and that share links carry the key only in the fragment |

## Live checks against testnet and NEAR AI

These spend testnet NEAR and NEAR AI credits, so they are scripts rather than CI jobs.

```bash
# Every server function in-process: onboarding, a relayed invoice, the private
# model with signature verification, Intel and NVIDIA verdicts.
RELAYER_KEY=… NEARAI_API_KEY=… pnpm tsx scripts/api-smoke.ts

# One full paid invoice from the command line: account, sealed invoice with an
# 85/15 split, faucet, payment, and both recipients' balances checked.
pnpm tsx scripts/e2e.ts
```

Last recorded results (14 Nov 2026): onboarding, relayed `create_invoice`, 18/18 local attestation checks, signature verified, Intel TDX verified for all 3 enclaves, NVIDIA verified for 2 GPU nodes of 8 GPUs each; the e2e run paid a 25 USDC invoice and the freelancer received 21.25 USDC and the second recipient 3.75.

## In the browser

`pnpm dev:api` (functions on :3000) and `pnpm dev` (app on :5176). A headless run of the freelancer flow (create an account, draft with the private model, seal and send, open the client link) takes about 35 seconds: account in ~10 s, private draft with 27/27 checks in ~15 s, sealed invoice recorded in ~5 s, decrypted with a matching fingerprint.
