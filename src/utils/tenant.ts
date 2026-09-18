const RESERVED = new Set(["www", "api", "admin", "app", "super-admin"]);

export function agencySlugFromHost(host: string): string {
  const hostname = host.replace(/^https?:\/\//, "").split(":")[0]?.toLowerCase().trim() || "";
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return "";

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
