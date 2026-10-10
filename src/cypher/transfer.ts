import { isRecord } from "@openclaw/normalization-core/record-coerce";
import type { CypherTransactionArgs } from "./ipc.js";
import type { CypherTransferQuote } from "./types.js";

const units = 10n ** 18n;
const maximum = (1n << 256n) - 1n;

export function cypherQuantity(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error("Invalid Cypher quantity");
  }
  return `0x${BigInt(value).toString(16)}`;
}

export function cypherAmountUnits(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,77})(?:\.\d{1,18})?$/.test(value)) {
    throw new Error("Invalid Cypher amount");
  }
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole!) * units + BigInt(fraction.padEnd(18, "0"));
  if (result <= 0n || result > maximum) {
    throw new Error("Invalid Cypher amount");
  }
  return result;
}

export function formatCypherUnits(value: bigint): string {
  const fraction = (value % units).toString().padStart(18, "0").replace(/0+$/, "");
  return `${value / units}${fraction ? `.${fraction}` : ""}`;
}

export function isCypherHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/** Only native-coin transfers are exposed; the node owns estimation and transaction defaults. */
export function filledCypherTransaction(
  value: unknown,
  expected: { from: string; to: string; value: string; chainId: string },
): CypherTransactionArgs {
  if (!isRecord(value) || !isRecord(value.tx)) {
    throw new Error("Invalid filled transaction");
  }
  const tx = value.tx;
  const type = cypherQuantity(tx.type);
  if (
    typeof tx.to !== "string" ||
    tx.to.toLowerCase() !== expected.to.toLowerCase() ||
    cypherQuantity(tx.value) !== expected.value ||
    tx.input !== "0x" ||
    (type !== "0x0" && type !== "0x2")
  ) {
    throw new Error("Invalid native-coin transfer");
  }
  const args: CypherTransactionArgs = {
    ...expected,
    nonce: cypherQuantity(tx.nonce),
    gas: cypherQuantity(tx.gas),
    type,
  };
  if (BigInt(args.gas!) === 0n || BigInt(args.nonce!) > (1n << 64n) - 1n) {
    throw new Error("Invalid transaction limits");
  }
  if (type === "0x2") {
    args.maxFeePerGas = cypherQuantity(tx.maxFeePerGas);
    args.maxPriorityFeePerGas = cypherQuantity(tx.maxPriorityFeePerGas);
    if (BigInt(args.maxPriorityFeePerGas) > BigInt(args.maxFeePerGas)) {
      throw new Error("Invalid transaction fees");
    }
  } else {
    args.gasPrice = cypherQuantity(tx.gasPrice);
  }
  return args;
}

export function sameCypherTransaction(a: CypherTransactionArgs, b: CypherTransactionArgs): boolean {
  return (
    a.from.toLowerCase() === b.from.toLowerCase() &&
    a.to.toLowerCase() === b.to.toLowerCase() &&
    a.value === b.value &&
    a.chainId === b.chainId &&
    a.nonce === b.nonce &&
    a.gas === b.gas &&
    a.type === b.type &&
    a.gasPrice === b.gasPrice &&
    a.maxFeePerGas === b.maxFeePerGas &&
    a.maxPriorityFeePerGas === b.maxPriorityFeePerGas
  );
}

export function quoteCypherFees(
  transaction: CypherTransactionArgs,
): Pick<CypherTransferQuote, "estimatedFee" | "total"> {
  const fee = BigInt(transaction.gas!) * BigInt(transaction.gasPrice ?? transaction.maxFeePerGas!);
  return {
    estimatedFee: formatCypherUnits(fee),
    total: formatCypherUnits(BigInt(transaction.value) + fee),
  };
}
