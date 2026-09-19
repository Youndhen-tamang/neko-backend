# eSewa payment integration

## Goal
Add eSewa (ePay v2) as a third checkout option next to Stripe and cash on delivery. One platform merchant account is shared by all stores, same as Stripe today. Store currency is already NPR (prices stored as paisa), so no conversion.

## Flow
1. Cart page → `POST /api/esewa/initiate` with the same payload as COD (customer details + items).
2. Backend validates products/stock, computes total, stores a `esewa_payments` row (status `pending`) holding the customer details and order lines as JSON, and returns `{ action, fields }` for eSewa's form.
3. Storefront submits a hidden `<form method="POST">` to `action` with `fields`; browser lands on eSewa.
4. eSewa redirects to `{slug-store}/payment/success?data=<base64 JSON>` or `{slug-store}/payment/failed`.
5. Success page → `POST /api/esewa/verify { data }`. Backend decodes `data`, loads the pending row by `transaction_uuid`, calls eSewa's transaction status API, and if `COMPLETE` places the order through `placeAgencyOrder` with `paymentMethod: "esewa"`, then marks the row `complete` with `ref_id` and `order_id`. Repeat calls return the existing order.
6. Success page clears the cart and renders `OrderConfirmed`; failed page shows a message and a link back to the cart.

## eSewa details (ePay v2)
- Form URL: test `https://rc-epay.esewa.com.np/api/epay/main/v2/form`, live `https://epay.esewa.com.np/api/epay/main/v2/form`.
- Fields: `amount`, `tax_amount` (0), `total_amount`, `transaction_uuid`, `product_code`, `product_service_charge` (0), `product_delivery_charge` (0), `success_url`, `failure_url`, `signed_field_names` = `total_amount,transaction_uuid,product_code`, `signature`.
- Signature: base64(HMAC-SHA256(secret, `total_amount=<v>,transaction_uuid=<v>,product_code=<v>`)).
- Status API: GET `https://rc.esewa.com.np/api/epay/transaction/status/?product_code=&total_amount=&transaction_uuid=` (live host `epay.esewa.com.np`). Response `{ status: "COMPLETE" | "PENDING" | "CANCELED" | "NOT_FOUND" | "FULL_REFUND" | ..., ref_id }`.
- Amount string must be identical in the form and the status query. Use `formatEsewaAmount(cents)` → integer rupees when whole, otherwise two decimals.
- Test merchant: product code `EPAYTEST`, secret `8gBm/:&EnhH.1/q`.

## Backend changes (`neko-backend`)
- `src/config/env.ts`: `esewa: { productCode, secretKey, mode }` from `ESEWA_PRODUCT_CODE`, `ESEWA_SECRET_KEY`, `ESEWA_MODE` (`test` default). `.env.example` documents them.
- `migrations/013_esewa_payments.ts`: table `esewa_payments(id uuid pk, agency_id uuid, amount_cents int, status string default pending, ref_id string null, order_id uuid null, payload jsonb, timestamps)`.
- `src/services/esewa.ts`: `esewaEnabled()`, `formatEsewaAmount`, `signEsewa`, `esewaFormUrl`, `buildEsewaForm`, `decodeEsewaData`, `checkEsewaStatus`.
- `src/services/fulfillment.ts`: extract `buildOrderLines(agency, items)` from `createCodOrder`; widen `paymentMethod` to include `"esewa"`; pay note "Paid with eSewa"; add `createEsewaPayment` and `fulfillEsewaPayment`.
- `src/modules/esewa/esewa.routes.ts`: `GET /status`, `POST /initiate`, `POST /verify`; mounted at `/api/esewa` in `src/app.ts` after `express.json`.

## Storefront changes (`neko-storefront`)
- `src/components/shop/esewa-button.tsx`: `EsewaButton({ payload, disabled, label, onError })` posts to initiate and submits the hidden form.
- `src/app/cart/page.tsx`: third button "Pay with eSewa"; helper text updated.
- `src/app/payment/success/page.tsx` and `src/app/payment/failed/page.tsx`.
- Labels that special-case `cod` vs Stripe (`admin/orders/page.tsx`, `order-confirmed.tsx`, `receipt-pdf.ts`) show "eSewa" for `payment_method === "esewa"`.

## Error handling
- Missing/invalid `data`, unknown transaction, or non-COMPLETE status → 402 "Payment not completed" (success page shows error + link back to cart).
- eSewa unreachable → 502.
- Double verify → returns the already-placed order (no duplicate order, no double stock decrement).

## Testing
- Unit: `src/services/esewa.test.ts` (node:test via tsx) covers `formatEsewaAmount`, `signEsewa` against a known vector, `decodeEsewaData`.
- Manual: sandbox payment end-to-end on local + deployed.
