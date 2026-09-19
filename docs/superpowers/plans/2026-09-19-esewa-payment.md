# eSewa Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let shoppers pay with eSewa (ePay v2) from the cart page, with the order created only after eSewa confirms the payment.

**Architecture:** The backend stores a pending `esewa_payments` row holding the cart snapshot, returns signed form fields, and the browser POSTs them to eSewa. On return, the storefront calls `/api/esewa/verify`; the backend confirms with eSewa's status API and places the order through the existing `placeAgencyOrder`.

**Tech Stack:** Express + Knex (Postgres) + zod on the backend, Next.js app router on the storefront, Node `crypto` HMAC-SHA256, `node:test` via `tsx` for unit tests.

**Spec:** `neko-backend/docs/superpowers/specs/2026-09-19-esewa-payment-design.md`

## Global Constraints
- Store currency is NPR; `price_cents` are paisa. eSewa amount = cents / 100. No conversion.
- Amount string sent in the form must equal the one used in the status query (`formatEsewaAmount`).
- Test merchant defaults: `ESEWA_PRODUCT_CODE=EPAYTEST`, `ESEWA_SECRET_KEY=8gBm/:&EnhH.1/q`, `ESEWA_MODE=test`.
- Payment method value stored on orders: `"esewa"`.
- Backend repo: `neko-backend` (own git remote). Storefront repo: `neko-storefront` (own git remote). Commit in each separately.

---

### Task 1: eSewa service + env (backend)

**Files:**
- Modify: `neko-backend/src/config/env.ts` (add `esewa` block after `stripe`)
- Modify: `neko-backend/.env.example` (append eSewa section)
- Create: `neko-backend/src/services/esewa.ts`
- Test: `neko-backend/src/services/esewa.test.ts`

**Interfaces:**
- Produces: `esewaEnabled(): boolean`, `formatEsewaAmount(cents: number): string`, `signEsewa(fields, secret?)`, `buildEsewaForm({ transactionUuid, amountCents, successUrl, failureUrl }): { action, fields }`, `decodeEsewaData(base64: string): EsewaCallback`, `checkEsewaStatus({ transactionUuid, totalAmount }): Promise<{ status: string; ref_id?: string | null }>`.

- [ ] **Step 1: Failing test** `src/services/esewa.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { buildEsewaForm, decodeEsewaData, formatEsewaAmount, signEsewa } from "./esewa";

test("formatEsewaAmount uses whole rupees when possible", () => {
  assert.equal(formatEsewaAmount(10000), "100");
  assert.equal(formatEsewaAmount(10050), "100.50");
});

test("signEsewa signs total_amount,transaction_uuid,product_code in that order", () => {
  const secret = "8gBm/:&EnhH.1/q";
  const expected = crypto
    .createHmac("sha256", secret)
    .update("total_amount=100,transaction_uuid=11-201-13,product_code=EPAYTEST")
    .digest("base64");
  assert.equal(
    signEsewa({ total_amount: "100", transaction_uuid: "11-201-13", product_code: "EPAYTEST" }, secret),
    expected
  );
});

test("buildEsewaForm produces the v2 form with a matching signature", () => {
  const form = buildEsewaForm({
    transactionUuid: "abc-123",
    amountCents: 25000,
    successUrl: "https://shop.example/payment/success",
    failureUrl: "https://shop.example/payment/failed",
  });
  assert.match(form.action, /esewa\.com\.np\/api\/epay\/main\/v2\/form$/);
  assert.equal(form.fields.total_amount, "250");
  assert.equal(form.fields.amount, "250");
  assert.equal(form.fields.signed_field_names, "total_amount,transaction_uuid,product_code");
  assert.equal(
    form.fields.signature,
    signEsewa({ total_amount: "250", transaction_uuid: "abc-123", product_code: form.fields.product_code })
  );
});

test("decodeEsewaData parses the base64 callback and rejects junk", () => {
  const payload = { status: "COMPLETE", transaction_uuid: "abc-123", total_amount: "250" };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64");
  assert.deepEqual(decodeEsewaData(data), payload);
  assert.throws(() => decodeEsewaData("not-base64-json"));
});
```

- [ ] **Step 2: Run** `cd neko-backend && npx tsx --test src/services/esewa.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** env block in `src/config/env.ts` (after `stripe`):

```ts
  esewa: {
    productCode: process.env.ESEWA_PRODUCT_CODE ?? "EPAYTEST",
    secretKey: process.env.ESEWA_SECRET_KEY ?? "8gBm/:&EnhH.1/q",
    mode: (process.env.ESEWA_MODE === "live" ? "live" : "test") as "test" | "live",
  },
```

`.env.example` (append):

```
# eSewa ePay v2. Defaults are eSewa's public sandbox merchant (EPAYTEST).
# Live: set ESEWA_MODE=live plus your merchant product code and secret from eSewa.
ESEWA_PRODUCT_CODE=EPAYTEST
ESEWA_SECRET_KEY=8gBm/:&EnhH.1/q
ESEWA_MODE=test
```

`src/services/esewa.ts`:

```ts
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

/** eSewa wants the same amount string in the form and the status query. */
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
```

- [ ] **Step 4: Run** the test → PASS (4 tests).
- [ ] **Step 5: Commit** in `neko-backend`: `feat: add eSewa ePay v2 service and env config`.

---

### Task 2: Pending payments table, fulfillment, routes (backend)

**Files:**
- Create: `neko-backend/migrations/013_esewa_payments.ts`
- Modify: `neko-backend/src/services/fulfillment.ts` (widen `paymentMethod`, extract `buildOrderLines`, add `createEsewaPayment`, `fulfillEsewaPayment`)
- Create: `neko-backend/src/modules/esewa/esewa.routes.ts`
- Modify: `neko-backend/src/app.ts:72` (mount `/api/esewa`)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `POST /api/esewa/initiate` → `{ action, fields }`; `POST /api/esewa/verify { data }` → `{ order }`; `GET /api/esewa/status` → `{ enabled }`.

- [ ] **Step 1: Migration**

```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("esewa_payments", (table) => {
    table.uuid("id").primary(); // doubles as eSewa transaction_uuid
    table.uuid("agency_id").notNullable().references("id").inTable("agencies").onDelete("CASCADE");
    table.integer("amount_cents").notNullable();
    table.string("status").notNullable().defaultTo("pending"); // pending | processing | complete | failed
    table.string("ref_id");
    table.uuid("order_id");
    table.jsonb("payload").notNullable();
    table.timestamps(true, true);
    table.index(["agency_id", "status"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("esewa_payments");
}
```

- [ ] **Step 2: fulfillment.ts** — change `paymentMethod: "stripe" | "cod"` to `"stripe" | "cod" | "esewa"`; legacy insert fallback: `if (input.paymentMethod !== "stripe") legacy.stripe_payment_intent_id = legacy.stripe_payment_intent_id || input.paymentMethod;`; pay note: `input.paymentMethod === "cod" ? "Cash on delivery" : input.paymentMethod === "esewa" ? "Paid with eSewa" : "Paid with Stripe"`. Replace the product lookup inside `createCodOrder` with a shared helper and add the two eSewa functions:

```ts
export async function buildOrderLines(agency: Agency, items: { productId: string; quantity: number }[]): Promise<OrderLine[]> {
  const products = await db("products")
    .whereIn("id", items.map((item) => item.productId))
    .andWhere({ agency_id: agency.id, status: "published" });
  if (products.length !== items.length) throw new HttpError(400, "One or more products are unavailable");
  return items.map((item) => {
    const product = products.find((row) => row.id === item.productId)!;
    if (product.stock < item.quantity) throw new HttpError(400, `${product.name} does not have enough stock`);
    return {
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPriceCents: product.price_cents as number,
      imageUrl: productImages(product.images)[0] ?? null,
    };
  });
}

type EsewaPayload = {
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  shippingAddress: string;
  items: OrderLine[];
  channel?: string;
  waUser?: string;
};

export async function createEsewaPayment(input: {
  agency: Agency;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  shippingAddress: string;
  items: { productId: string; quantity: number }[];
  channel?: string;
  waUser?: string;
}): Promise<{ id: string; amountCents: number }> {
  const lines = await buildOrderLines(input.agency, input.items);
  const amountCents = lines.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  if (amountCents <= 0) throw new HttpError(400, "Order total must be greater than zero");
  const id = crypto.randomUUID();
  const payload: EsewaPayload = {
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone ?? null,
    shippingAddress: input.shippingAddress,
    items: lines,
    channel: input.channel,
    waUser: input.waUser,
  };
  await db("esewa_payments").insert({
    id,
    agency_id: input.agency.id,
    amount_cents: amountCents,
    status: "pending",
    payload: JSON.stringify(payload),
  });
  return { id, amountCents };
}

async function orderWithItems(orderId: string): Promise<PlacedOrder | null> {
  const order = await db("orders").where({ id: orderId }).first();
  if (!order) return null;
  const items = await db("order_items").where({ order_id: orderId });
  return { ...order, items };
}

/** Confirms the payment with eSewa and places the order once. Returns null when eSewa has not completed it. */
export async function fulfillEsewaPayment(transactionUuid: string, agencyId: string): Promise<PlacedOrder | null> {
  const payment = await db("esewa_payments").where({ id: transactionUuid, agency_id: agencyId }).first();
  if (!payment) return null;
  if (payment.order_id) return orderWithItems(payment.order_id);

  const status = await checkEsewaStatus({
    transactionUuid,
    totalAmount: formatEsewaAmount(payment.amount_cents),
  });
  if (status.status !== "COMPLETE") {
    if (["CANCELED", "NOT_FOUND", "FULL_REFUND", "PARTIAL_REFUND", "AMBIGUOUS"].includes(status.status)) {
      await db("esewa_payments").where({ id: transactionUuid }).update({ status: "failed", updated_at: new Date() });
    }
    return null;
  }

  // Claim the row so two concurrent verifies cannot both place an order.
  const claimed = await db("esewa_payments")
    .where({ id: transactionUuid, status: "pending" })
    .update({ status: "processing", updated_at: new Date() });
  if (!claimed) {
    const again = await db("esewa_payments").where({ id: transactionUuid }).first();
    if (again?.order_id) return orderWithItems(again.order_id);
    throw new HttpError(409, "Payment is still being confirmed. Please refresh in a moment.");
  }

  const agency = await db("agencies").where({ id: payment.agency_id }).first();
  if (!agency) return null;
  const payload: EsewaPayload = typeof payment.payload === "string" ? JSON.parse(payment.payload) : payment.payload;

  try {
    const order = await placeAgencyOrder({
      agency,
      customerName: payload.customerName,
      customerEmail: payload.customerEmail,
      customerPhone: payload.customerPhone,
      shippingAddress: payload.shippingAddress,
      items: payload.items,
      paymentMethod: "esewa",
      channel: payload.channel,
      waUser: payload.waUser,
    });
    await db("esewa_payments")
      .where({ id: transactionUuid })
      .update({ status: "complete", ref_id: status.ref_id ?? null, order_id: order.id, updated_at: new Date() });
    return order;
  } catch (error) {
    await db("esewa_payments").where({ id: transactionUuid }).update({ status: "pending", updated_at: new Date() });
    throw error;
  }
}
```

Imports to add at top of fulfillment.ts: `import { checkEsewaStatus, formatEsewaAmount } from "./esewa";`

- [ ] **Step 3: Routes** `src/modules/esewa/esewa.routes.ts`

```ts
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { resolveTenant } from "../../middleware/tenant";
import { buildEsewaForm, decodeEsewaData, esewaEnabled } from "../../services/esewa";
import { createEsewaPayment, fulfillEsewaPayment } from "../../services/fulfillment";
import { asyncHandler, HttpError } from "../../utils/http";
import { storeUrlForSlug } from "../../utils/tenant";

const router = Router();

const checkoutSchema = z.object({
  customerName: z.string().min(2),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional(),
  shippingAddress: z.string().min(2),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
});

router.get("/status", (_req, res) => {
  res.json({ enabled: esewaEnabled(), mode: env.esewa.mode });
});

router.post(
  "/initiate",
  resolveTenant,
  asyncHandler(async (req, res) => {
    if (!esewaEnabled()) throw new HttpError(503, "eSewa is not configured");
    const body = checkoutSchema.parse(req.body);
    const agency = req.agency!;
    const payment = await createEsewaPayment({ agency, ...body, channel: "web" });
    const form = buildEsewaForm({
      transactionUuid: payment.id,
      amountCents: payment.amountCents,
      successUrl: storeUrlForSlug(env.storeUrl, agency.slug, "/payment/success"),
      failureUrl: storeUrlForSlug(env.storeUrl, agency.slug, "/payment/failed"),
    });
    res.json(form);
  })
);

router.post(
  "/verify",
  resolveTenant,
  asyncHandler(async (req, res) => {
    const { data } = z.object({ data: z.string().min(1) }).parse(req.body);
    const callback = decodeEsewaData(data);
    if (!callback.transaction_uuid) throw new HttpError(400, "Missing eSewa transaction id");
    const order = await fulfillEsewaPayment(callback.transaction_uuid, req.agency!.id);
    if (!order) throw new HttpError(402, "Payment not completed");
    res.json({ order });
  })
);

export default router;
```

- [ ] **Step 4: Mount** in `src/app.ts`: `import esewaRoutes from "./modules/esewa/esewa.routes";` and `app.use("/api/esewa", esewaRoutes);` right after the `/api/orders` line.
- [ ] **Step 5: Verify** `npx tsc -p tsconfig.json --noEmit` passes; `npx tsx --test src/services/esewa.test.ts` passes.
- [ ] **Step 6: Commit** in `neko-backend`: `feat: eSewa checkout initiate/verify routes and pending payments table`.

---

### Task 3: Storefront button, return pages, labels

**Files:**
- Create: `neko-storefront/src/components/shop/esewa-button.tsx`
- Modify: `neko-storefront/src/app/cart/page.tsx` (validation helper, third button, helper text)
- Create: `neko-storefront/src/app/payment/success/page.tsx`, `neko-storefront/src/app/payment/failed/page.tsx`
- Modify: `neko-storefront/src/lib/utils.ts` (add `paymentMethodLabel`), `src/app/admin/orders/page.tsx:128`, `src/components/shop/order-confirmed.tsx:22`, `src/lib/receipt-pdf.ts` (`paidLabel`)

**Interfaces:**
- Consumes: `POST /api/esewa/initiate` → `{ action, fields }`, `POST /api/esewa/verify { data }` → `{ order }`.

- [ ] **Step 1: `esewa-button.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export type EsewaCheckoutPayload = {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  shippingAddress: string;
  items: { productId: string; quantity: number }[];
};

type EsewaForm = { action: string; fields: Record<string, string> };

/** eSewa only accepts a browser form POST, so build one and submit it. */
export function submitEsewaForm(form: EsewaForm) {
  const el = document.createElement("form");
  el.method = "POST";
  el.action = form.action;
  el.style.display = "none";
  for (const [name, value] of Object.entries(form.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    el.appendChild(input);
  }
  document.body.appendChild(el);
  el.submit();
}

export function EsewaButton({
  payload,
  label,
  disabled,
  validate,
  onError,
}: {
  payload: EsewaCheckoutPayload;
  label: string;
  disabled?: boolean;
  validate?: () => boolean;
  onError?: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function pay() {
    if (validate && !validate()) return;
    setLoading(true);
    try {
      const form = await api<EsewaForm>("/api/esewa/initiate", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      submitEsewaForm(form);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "eSewa checkout failed");
      setLoading(false);
    }
  }

  return (
    <Button
      className="w-full bg-[#60bb46] text-white hover:bg-[#4ea338]"
      size="lg"
      type="button"
      disabled={disabled || loading}
      onClick={() => void pay()}
    >
      {loading ? "Redirecting to eSewa..." : label}
    </Button>
  );
}
```

- [ ] **Step 2: Cart page** — extract the field check into `function validateCustomer(): boolean` (returns false and toasts when a field is missing), use it at the top of `checkout`, and add after the Stripe button:

```tsx
<EsewaButton
  payload={{
    customerName,
    customerEmail,
    customerPhone,
    shippingAddress,
    items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
  }}
  label={`Pay ${money(total)} with eSewa`}
  disabled={loading}
  validate={validateCustomer}
  onError={(message) => toast.error(message)}
/>
```
Helper text becomes: "Stripe and eSewa open a secure page where you complete the payment yourself. Cash on delivery is paid when the order arrives."

- [ ] **Step 3: `payment/success/page.tsx`** — same shape as `checkout/success/page.tsx` but reads `data`, POSTs `/api/esewa/verify`, clears the cart only after a successful verify, and passes `error` to `OrderConfirmed`. `payment/failed/page.tsx` renders inside `ShopShell`: heading "Payment not completed", body "Your eSewa payment was cancelled or did not go through. Nothing was charged and your bag is still saved.", `Button asChild` → `<Link href="/cart">Back to your bag</Link>` and a text link to `/`.

- [ ] **Step 4: Labels** — in `src/lib/utils.ts`:

```ts
export function paymentMethodLabel(method?: string | null) {
  if (method === "cod") return "Cash on delivery";
  if (method === "esewa") return "eSewa";
  return "Stripe";
}
```
Use it in `admin/orders/page.tsx` (`{paymentMethodLabel(order.payment_method)} · `), in `order-confirmed.tsx` `paymentSteps` body (`${provider} confirmed this order...` where provider comes from the label), and in `receipt-pdf.ts` nothing changes (non-COD already reads "Paid").

- [ ] **Step 5: Verify** `cd neko-storefront && npx tsc --noEmit` passes and `npm run build` succeeds.
- [ ] **Step 6: Commit** in `neko-storefront`: `feat: add eSewa checkout button and payment return pages`.

---

### Task 4: Push and deploy notes

- [ ] Push `neko-backend` and `neko-storefront` `main` to origin.
- [ ] Render: run migrations on deploy (`npm run migrate:latest` is part of the start/build step? if not, run once) and set `ESEWA_PRODUCT_CODE`, `ESEWA_SECRET_KEY`, `ESEWA_MODE=test`. Confirm `FRONTEND_STORE_URL` and `PUBLIC_API_URL` are set.
- [ ] Sandbox test: cart → Pay with eSewa → eSewa test login → land on `/payment/success` with the order confirmation.
