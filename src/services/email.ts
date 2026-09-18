import nodemailer from "nodemailer";
import { env } from "../config/env";

type InvoiceEmail = {
  to: string;
  agencyName: string;
  logoUrl?: string | null;
  primaryColor: string;
  invoiceNumber: string;
  customerName: string;
  items: { name: string; quantity: number; unitPriceCents: number }[];
  totalCents: number;
  currency: string;
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export async function sendInvoiceEmail(payload: InvoiceEmail): Promise<boolean> {
  if (!env.smtp.host || !env.smtp.user) {
    console.warn("SMTP is not configured; skipping invoice email");
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
  });

  const rows = payload.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee">${item.name}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center">${item.quantity}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${money(item.unitPriceCents * item.quantity, payload.currency)}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#1a1a1a">
      ${payload.logoUrl ? `<img src="${payload.logoUrl}" alt="${payload.agencyName}" style="height:40px;margin-bottom:16px" />` : ""}
      <h1 style="font-size:22px;margin:0 0 8px">${payload.agencyName}</h1>
      <p style="margin:0 0 24px;color:#555">Invoice ${payload.invoiceNumber}</p>
      <p>Hi ${payload.customerName}, thank you for your order. Here is your invoice.</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0">
        <thead>
          <tr>
            <th style="text-align:left;border-bottom:2px solid ${payload.primaryColor};padding-bottom:8px">Item</th>
            <th style="text-align:center;border-bottom:2px solid ${payload.primaryColor};padding-bottom:8px">Qty</th>
            <th style="text-align:right;border-bottom:2px solid ${payload.primaryColor};padding-bottom:8px">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="text-align:right;font-size:18px"><strong>Total: ${money(payload.totalCents, payload.currency)}</strong></p>
    </div>
  `;

  await transporter.sendMail({
    from: `"${payload.agencyName}" <${env.smtp.user}>`,
    to: payload.to,
    subject: `Invoice ${payload.invoiceNumber} from ${payload.agencyName}`,
    html,
  });

  return true;
}
