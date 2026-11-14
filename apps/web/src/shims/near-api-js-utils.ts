/**
 * @meteorwallet/sdk 1.0.x still imports `utils` from near-api-js, which v7
 * removed. It only calls utils.serialize.base_decode, so this shim re-exports
 * near-api-js v7 and adds that one function. vite.config.ts points only the
 * Meteor SDK's import here; everything else uses near-api-js directly.
 */
import { baseDecode } from "near-api-js";

export * from "near-api-js";
export const utils = { serialize: { base_decode: baseDecode } };
