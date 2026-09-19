export const STORE_CURRENCY = "npr";

export function resolveCurrency(currency?: string | null) {
  const code = (currency || STORE_CURRENCY).toUpperCase();
  return code === "USD" ? "NPR" : code;
}

export function money(cents: number, currency = STORE_CURRENCY) {
  return new Intl.NumberFormat("en-NP", {
    style: "currency",
    currency: resolveCurrency(currency),
  }).format((cents || 0) / 100);
}
