# Nearvoice

**Private invoices that get paid in stablecoins, without the freelancer ever touching crypto.**

This page is written for the person who keeps the books.

## What it does, in plain words

1. **A freelancer writes an invoice.** Type the work in your own words ("3 days of logo design at $400 a day, rush fee $150, due 1 December") and a private AI turns it into line items. You check it, set a due date, and get a link.
2. **The client opens the link and pays.** They see the invoice, connect a wallet and pay in USDC. If their money sits on another chain (Base, Arbitrum, Solana, Ethereum), the page shows exactly what they would send from there.
3. **You get paid, already split.** The payment lands in USDC on NEAR and is divided the way you set it up: for example 80% to you, 15% to a tax reserve, 5% to a collaborator.
4. **Your accountant gets a CSV.** One row per invoice: number, client, issue date, due date, paid date, amount, currency, status, and the transaction link that proves it.

## What a bookkeeper should know

| Question | Answer |
|---|---|
| Who can see an invoice? | Only people with the link. The invoice details are encrypted in the browser before they are stored; the public record holds only the amount owed, the currency, the status and a fingerprint of the details. |
| Is "paid" trustworthy? | Yes. An invoice is marked paid only by the payment itself, in the same transaction, and every status links to that transaction on a public explorer. |
| Can a paid invoice be reversed? | Yes, as a refund: the freelancer sends the money back through the invoice, and its status becomes "refunded" with a link to that transaction. |
| Does the freelancer need crypto? | No. The account is created for them and every action they take is paid for by Nearvoice's relayer. |
| What currency? | USDC (on this test network, a test version of it). Amounts are kept in whole cents. |
| Who saw my invoice text when the AI read it? | Nobody: it runs on NEAR AI Cloud inside a sealed hardware enclave (TEE). The app checks the enclave's hardware attestation each time and shows what was checked. Nothing is stored after the answer returns. |

## Status of this build

Runs on NEAR **testnet** with test USDC. No real money moves.

Technical documentation for developers: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (added as the build progresses).
