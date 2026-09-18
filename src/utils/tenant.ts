const RESERVED = new Set(["www", "api", "admin", "app", "super-admin"]);

/**
 * Extract the tenant slug from a hostname.
 *
 * When `baseHost` is known (the storefront's public hostname, e.g. "yourdomain.com"),
 * only `{slug}.{baseHost}` matches, so unrelated hosts such as "app.vercel.app" never
 * resolve to a tenant. Without it, or for local `{slug}.localhost`, the heuristic below
 * takes the first label of any multi-part hostname.
 */
export function agencySlugFromHost(host: string, baseHost?: string): string {
  const hostname = host.replace(/^https?:\/\//, "").split(":")[0]?.toLowerCase().trim() || "";
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return "";

  const base = baseHost?.toLowerCase().trim();
  if (base && base !== "localhost" && base !== "127.0.0.1") {
    if (!hostname.endsWith(`.${base}`)) return "";
    const slug = hostname.slice(0, -(base.length + 1));
    if (!slug || slug.includes(".") || RESERVED.has(slug)) return "";
    return slug;
  }

  const parts = hostname.split(".");
  if (parts.length >= 2 && parts[parts.length - 1] === "localhost") {
    const slug = parts[0];
    return RESERVED.has(slug) ? "" : slug;
  }

  if (parts.length >= 3) {
    const slug = parts[0];
    return RESERVED.has(slug) ? "" : slug;
  }

  return "";
}

export function storeUrlForSlug(baseStoreUrl: string, slug: string, path = ""): string {
  const base = new URL(baseStoreUrl);
  const port = base.port ? `:${base.port}` : "";
  const normalized = path.startsWith("/") || path === "" ? path : `/${path}`;

  if (base.hostname === "localhost" || base.hostname === "127.0.0.1") {
    return `${base.protocol}//${slug}.localhost${port}${normalized}`;
  }

  return `${base.protocol}//${slug}.${base.hostname}${port}${normalized}`;
}
