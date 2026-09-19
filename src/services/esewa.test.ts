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
  assert.equal(form.fields.success_url, "https://shop.example/payment/success");
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
