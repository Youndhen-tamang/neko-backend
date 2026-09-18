import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

type SendEmailOptions = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
};

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

let transporter: Transporter | null = null;

function isSmtpConfigured() {
  return Boolean(env.smtp.host && env.smtp.user);
}

function getTransporter(): Transporter | null {
  if (!isSmtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: {
        user: env.smtp.user,
        pass: env.smtp.pass,
      },
    });
  }
  return transporter;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const mailer = getTransporter();
  if (!mailer) {
    console.warn("SMTP is not configured; skipping email");
    return false;
  }

  await mailer.sendMail({
    from: options.from ?? env.smtp.user,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });
  return true;
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export async function sendInvoiceEmail(payload: InvoiceEmail): Promise<boolean> {
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

  return sendEmail({
    from: `"${payload.agencyName}" <${env.smtp.user}>`,
    to: payload.to,
    subject: `Invoice ${payload.invoiceNumber} from ${payload.agencyName}`,
    html,
  });
}
