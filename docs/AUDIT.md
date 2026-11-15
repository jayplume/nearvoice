# Self-audit

We judged Nearvoice against each track prompt it fits (from `nearai/near-hackathon-prompt-examples`) and against the usual judging dimensions: technical implementation, design, impact, originality and sustainability. ✅ means done and demonstrable on testnet; ◐ means partly; ✗ means not done, with the reason.

## Real-World Money (`realworld`)

The prompt's example is ours almost word for word: crypto invoicing for freelancers who don't care about crypto.

| Prompt asks | Status | Where |
|---|---|---|
| README written first, for a bookkeeper | ✅ | `README.md` (first commit) |
| Invoice page with amount, due date, line items and a pay button | ✅ | `/i/:id`: decrypted invoice, amount, due date, lines, Pay button |
| The client pays from whatever chain and token they hold, through the 1Click API | ◐ | Live 1Click quotes for USDC on Base, Arbitrum, Ethereum and Solana, USDT on Ethereum and NEAR, each into exactly the invoice amount of USDC on NEAR. 1Click runs on mainnet only, so on testnet the payment itself settles in test USDC through `ft_transfer_call`. On mainnet the same page would request a non-dry quote and show the deposit address |
| Freelancer receives USDC on NEAR and never buys NEAR | ✅ | Account created by `/api/onboard`; every call relayed as a NEP-366 meta transaction |
| The relayer only pays for calls to our own contract | ✅ | `relay-policy.ts` (unit-tested), enforced in `/api/relay` before signing |
| Trustworthy statuses (paid, pending, refunded) with links to the transactions | ✅ | Statuses change only inside the contract; every status on the invoice page links its transaction, found by matching the contract's recorded timestamps against NearBlocks receipts (`lib/proofs.ts`) |
| CSV an accountant opens without questions | ✅ | One row per invoice: number, client, dates, amount in plain dollars, currency, status, payer, transaction link |
| One full paid-invoice flow on testnet before anything else | ✅ | `scripts/e2e.ts`, then the same flow in the browser |

## Privacy & Private AI (`privacy`)

| Prompt asks | Status | Where |
|---|---|---|
| NEAR AI Cloud through its OpenAI-compatible API, key in `.env`, a TEE-hosted model | ✅ | `/api/ai`, `deepseek-ai/DeepSeek-V4.1-Flash-1017` |
| Attestation fetched with a fresh random nonce and verified as the docs describe | ✅ | The browser fetches the report itself and runs 18+ checks (nonce echo, signing key and nonce in TDX `report_data`, TEE type, NVIDIA nonce); Intel DCAP and NVIDIA NRAS verdicts through `/api/attest`; the enclave's ECDSA signature over the request and response hashes |
| A "Verified" panel listing what was checked | ✅ | The proof panel on `/app/new` and `/verify` (27 checks with a drafted answer, 23 without) |
| Keep nothing server-side after a response | ✅ | No database anywhere; `/api/ai` keeps nothing and says so in its header comment and in SECURITY.md |
| Fictional sample documents | ✅ | Three sample notes (designer, developer, translator) on the new-invoice page |
| Beyond the prompt | ✅ | The invoice itself is private: AES-256-GCM in the browser, key only in the link fragment, digest on chain so the client can check it |

## Autonomous Business (`business`)

Nearvoice is not an autonomous agent; it is the payment rail an AI-native business would invoice with. It meets the prompt's rules on the business side.

| Prompt asks | Status | Where |
|---|---|---|
| Customers pay in whatever token they hold through NEAR Intents | ◐ | Quotes as above; settlement on testnet in test USDC |
| Buys its own inference from NEAR AI Cloud | ✅ | The deployment pays for the private model per request |
| Maximum inference spend per day | ◐ | `AI_DAILY_REQUESTS` caps requests per day per server instance; there is no global counter because there is no database |
| Minimum price per report / invoice rules | ✅ | Per-business maximum invoice amount, enforced by the contract |
| Revenue split percentages | ✅ | Up to 5 recipients in basis points, paid in the client's transaction; failed shares held for `claim` |
| A kill switch | ✅ | `paused` in the business profile: refuses new invoices and payments |
| No full-access key in plain text | ◐ | The relayer key exists only as a Vercel secret. The freelancer's key is a full-access key in their own browser storage, because refunds move money and need a deposit, which function-call keys cannot attach |
| A public ledger of every sale and payout | ✅ | `/ledger`, read live from the contract, plus NEP-297 events |
| Demo mode: one full loop in under two minutes | ✅ | The browser flow takes about 35 seconds to a sent invoice; `scripts/e2e.ts` runs sale to payout |

## Open Innovation (`open`)

A private invoice is a new thing on a public chain: the amount is enforceable by a contract while the contents are readable only by the two parties, the AI that writes it proves it ran in an enclave, and the payment splits itself on arrival.

## Judging dimensions

| Dimension | Evidence |
|---|---|
| Technical implementation | Two Rust contracts (20 tests, clippy-clean) with cross-contract payouts and failure-safe callbacks; NEP-366 relaying with a tested policy; in-browser AES-GCM sealing with an on-chain digest; in-browser verification of TDX attestation and secp256k1 enclave signatures, plus Intel and NVIDIA hardware verdicts; 1Click quotes across six source assets; transaction proofs matched from NearBlocks; 28 TypeScript tests, including a real attestation fixture and React component tests; CI for both languages |
| Design | A distinct visual identity (carbon-copy blue, stamp green, seal violet), light and dark themes designed separately, an invoice that visibly seals and gets stamped PAID, reduced-motion support, responsive down to phone width |
| Impact | Freelancers lose time and fees on cross-border invoicing; Nearvoice gives them stablecoin payment without a wallet, gas or a public record of their rates |
| Originality | Confidential invoice contents with public, contract-enforced settlement; an AI bookkeeper whose privacy the user's own browser checks |
| Sustainability | Stateless functions and public RPCs; the contract needs no operator; a mainnet version could take a small fee in the payout split |

## Known gaps, in one place

- 1Click quotes are live, but testnet settlement is in test USDC (1Click has no testnet).
- The `on_payout` failure path is reviewed but not unit-tested (cross-contract results need a sandbox test).
- Contract accounts keep their deploy keys on testnet (SECURITY.md).
- Rate limits and the AI budget are per serverless instance.
- Freelancer keys live in browser storage; the backup file is the recovery path.
