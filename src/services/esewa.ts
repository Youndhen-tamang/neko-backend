import crypto from "crypto";
import { env } from "../config/env";
import { HttpError } from "../utils/http";

const HOSTS = {
  test: {
    form: "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
    status: "https://rc.esewa.com.np/api/epay/transaction/status/",
  },
  live: {
    form: "https://epay.esewa.com.np/api/epay/main/v2/form",
    status: "https://epay.esewa.com.np/api/epay/transaction/status/",
  },
} as const;

export function esewaEnabled() {
  return Boolean(env.esewa.productCode && env.esewa.secretKey);
}

/** eSewa wants the same amount string in the form and in the status query. */
export function formatEsewaAmount(cents: number): string {
  const rupees = cents / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

export function signEsewa(
  fields: { total_amount: string; transaction_uuid: string; product_code: string },
  secret = env.esewa.secretKey
): string {
  const message = `total_amount=${fields.total_amount},transaction_uuid=${fields.transaction_uuid},product_code=${fields.product_code}`;
  return crypto.createHmac("sha256", secret).update(message).digest("base64");
}

export type EsewaForm = { action: string; fields: Record<string, string> };

export function buildEsewaForm(input: {
  transactionUuid: string;
  amountCents: number;
  successUrl: string;
  failureUrl: string;
}): EsewaForm {
  const total = formatEsewaAmount(input.amountCents);
  const productCode = env.esewa.productCode;
  return {
    action: HOSTS[env.esewa.mode].form,
    fields: {
      amount: total,
      tax_amount: "0",
      total_amount: total,
      transaction_uuid: input.transactionUuid,
      product_code: productCode,
      product_service_charge: "0",
      product_delivery_charge: "0",
      success_url: input.successUrl,
      failure_url: input.failureUrl,
      signed_field_names: "total_amount,transaction_uuid,product_code",
      signature: signEsewa({ total_amount: total, transaction_uuid: input.transactionUuid, product_code: productCode }),
    },
  };
}

export type EsewaCallback = {
  transaction_code?: string;
  status?: string;
  total_amount?: string;
  transaction_uuid?: string;
  product_code?: string;
  signed_field_names?: string;
  signature?: string;
};

/** eSewa redirects to success_url?data=<base64 JSON>. */
export function decodeEsewaData(data: string): EsewaCallback {
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as EsewaCallback;
  } catch {
    throw new HttpError(400, "Invalid eSewa response");
  }
}

export type EsewaStatus = {
  status: string;
  ref_id?: string | null;
  transaction_uuid?: string;
  total_amount?: number | string;
};

/** Server-to-server confirmation. Never trust the redirect alone. */
export async function checkEsewaStatus(input: { transactionUuid: string; totalAmount: string }): Promise<EsewaStatus> {
  const url = new URL(HOSTS[env.esewa.mode].status);
  url.searchParams.set("product_code", env.esewa.productCode);
  url.searchParams.set("total_amount", input.totalAmount);
  url.searchParams.set("transaction_uuid", input.transactionUuid);

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new HttpError(502, "Could not reach eSewa to confirm the payment");
  }
  if (!response.ok) {
    console.warn("eSewa status check failed", response.status, (await response.text()).slice(0, 300));
    throw new HttpError(502, "eSewa could not confirm the payment");
  }
  return (await response.json()) as EsewaStatus;
}
