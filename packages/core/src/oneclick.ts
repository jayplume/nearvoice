/**
 * "Pay from any chain" through NEAR Intents' 1Click API. Nearvoice asks for a
 * dry EXACT_OUTPUT quote: the freelancer must receive exactly the invoice
 * amount in USDC on NEAR, and 1Click says what the client would send from the
 * chain and token they hold. Dry quotes move no funds and need no key.
 * 1Click runs on mainnet only (there is no testnet), so on testnet the page
 * shows the quote and settles with test USDC.
 */
export const ONECLICK_API = "https://1click.chaindefuser.com/v0";
/** Native USDC on NEAR mainnet, as 1Click names it. */
export const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export interface PayFrom {
  id: string;
  label: string;
  chain: string;
  assetId: string;
  decimals: number;
}

export const PAY_FROM: PayFrom[] = [
  { id: "base-usdc", label: "USDC", chain: "Base", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6 },
  { id: "arb-usdc", label: "USDC", chain: "Arbitrum", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6 },
  { id: "eth-usdc", label: "USDC", chain: "Ethereum", assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6 },
  { id: "eth-usdt", label: "USDT", chain: "Ethereum", assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", decimals: 6 },
  { id: "sol-usdc", label: "USDC", chain: "Solana", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6 },
  { id: "near-usdt", label: "USDT", chain: "NEAR", assetId: "nep141:usdt.tether-token.near", decimals: 6 },
];

export interface PayQuote {
  from: PayFrom;
  /** What the client sends, in the origin token's smallest unit. */
  amountIn: bigint;
  amountInFormatted: string;
  amountInUsd: string;
  /** Exactly the invoice amount, in USDC units. */
  amountOut: bigint;
  /** Seconds 1Click expects the swap to take. */
  timeEstimate: number;
  /** Network fee kept by 1Click when the client pays, in origin units. */
  feeUsd: number;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * An account that exists on NEAR mainnet, used as recipient and refund target
 * of *dry* quotes only. 1Click validates both (it refuses burn addresses and
 * unknown accounts) but a dry quote moves nothing, so any real account works.
 */
export const DRY_QUOTE_ACCOUNT = "intents.near";

/**
 * A dry EXACT_OUTPUT quote: what `from` must send so `recipient` receives
 * `amountOutUnits` USDC on NEAR. A failed swap refunds inside NEAR Intents
 * (refundType INTENTS), which works the same for every origin chain.
 */
export async function quotePayment(from: PayFrom, amountOutUnits: bigint, recipient: string = DRY_QUOTE_ACCOUNT, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<PayQuote> {
  const body = {
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: from.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_USDC,
    amount: amountOutUnits.toString(),
    refundTo: recipient,
    refundType: "INTENTS",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const res = await fetcher(`${ONECLICK_API}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok || !json.quote) throw new Error(`1Click could not quote ${from.label} on ${from.chain}: ${json.message ?? res.status}`);
  const q = json.quote;
  const inUsd = Number(q.amountInUsd);
  const outUsd = Number(q.amountOutUsd);
  return {
    from,
    amountIn: BigInt(q.amountIn),
    amountInFormatted: q.amountInFormatted,
    amountInUsd: q.amountInUsd,
    amountOut: BigInt(q.amountOut),
    timeEstimate: q.timeEstimate,
    feeUsd: Math.max(0, Math.round((inUsd - outUsd) * 100) / 100),
  };
}
