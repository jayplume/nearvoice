# Security model

What Nearvoice protects, against whom, and where it stops. If you find a problem, open an issue (testnet only, no real funds).

## What is private, and from whom

| Data | Stored where | Readable by |
|---|---|---|
| Line items, prices, client and freelancer names, emails, notes | On chain as AES-256-GCM ciphertext | Anyone holding the link (the key is in its `#fragment`) |
| Invoice key | The link's fragment; the freelancer's browser (`localStorage`); their backup file | The freelancer and whoever they send the link to. Browsers never send a fragment to a server, so Vercel and Nearvoice never see it |
| The notes typed for the AI | Nowhere | Nearvoice's `/api/ai` function forwards them to NEAR AI Cloud for the life of one request and logs nothing; the model reads them inside a TEE |
| Amount, token, due date, status, issuer, payer, split | On chain in the clear | Everyone. The contract needs them to enforce payment and splits |
| Digest (sha256 of the canonical details) | On chain | Everyone. It lets a client check that the decrypted invoice is exactly what was issued; it reveals nothing useful unless an attacker can guess the entire invoice |

**Not hidden:** that an account issued an invoice, its amount, and who paid it. Nearvoice offers confidentiality of invoice contents, not payment anonymity.

## Threats and answers

| Threat | Answer |
|---|---|
| A stranger reads an invoice from the chain | Ciphertext only. AES-256-GCM with a fresh random key and IV per invoice |
| Someone alters the details before the client sees them | GCM authentication fails on tampered ciphertext; a re-encrypted forgery fails the on-chain digest check, and the page says not to pay |
| The client pays the wrong amount | `ft_on_transfer` rejects less than the invoice amount and returns any excess in the same transaction |
| An invoice is paid twice | Only an `open` invoice can be paid; the status changes in the same call |
| A split recipient's account cannot receive | `on_payout` records the share as claimable for that recipient (`claim`), so the money is never stuck in limbo |
| The relayer is abused to spend its NEAR | The relay policy (`packages/core/src/relay-policy.ts`, unit-tested) allows only `create_invoice`, `cancel_invoice` and `set_profile` on the invoice contract, from `*.nearvoice.testnet` senders, with no deposit and at most 100 Tgas. Per-instance rate limits add friction; testnet NEAR bounds the cost |
| Onboarding is spammed | 5 accounts per IP per hour per instance; each costs the relayer 0.02 NEAR of storage funding. On mainnet this would need proof of personhood or a captcha |
| The AI provider reads or alters the notes | The browser verifies a fresh attestation (nonce, TDX quote, report data binding the signing key, NVIDIA evidence), Intel and NVIDIA verify the hardware, and the browser checks the enclave's signature over the hashes of the exact request and response |
| Nearvoice's server lies about the AI answer | It cannot: the signature covers sha256 of the response bytes, and the browser recomputes it |
| A refund is sent to the wrong person | Refunds go through the contract, which forwards them to the recorded payer; only the issuer can send one |
| A business is compromised | The pause switch (`set_profile` with `paused`) stops new invoices and refuses payments to open ones |

## Trust assumptions, stated plainly

- **The link is the key.** Whoever has it can read the invoice. Send it like you would send a PDF.
- **The freelancer's key lives in the browser.** If they clear storage without downloading the backup, the account and invoice keys are gone (the invoices on chain stay, sealed).
- **The `/api/ai` function sees the notes in transit.** It is open-source and stateless, and the enclave signature proves the answer was not changed, but you are trusting the deployment not to log the request. A future version can call NEAR AI Cloud straight from the browser with a per-user key.
- **Attestation checks the code identity NEAR AI publishes.** We verify that the hardware is genuine and bound to our nonce and the signing key; we do not rebuild NEAR AI's images to compare measurements.
- **Contract accounts still have their deploy keys.** `invoices.nearvoice.testnet` and `usdc.nearvoice.testnet` keep a full-access key held by the deployer, so the code could be upgraded. A mainnet deployment would remove the key (or hand it to a multisig) after an audit.
- **Testnet.** Test USDC has no value, and the faucet is open to anyone.

## Secrets

`RELAYER_KEY` and `NEARAI_API_KEY` exist only as Vercel environment variables and in the maintainer's local `.env` (git-ignored). Nothing secret is in the repository or in the browser bundle.
