const allowedCarouselPaths = [/^\/content\/[^/?#]+(?:[/?#].*)?$/, /^\/category\/[^/?#]+(?:[/?#].*)?$/];
const blockedCarouselPaths = [/^\/admin(?:\/|$)/, /^\/login(?:\/|$)/, /^\/preview(?:\/|$)/];
const knownSiteHosts = new Set(["maplestorynk.online", "www.maplestorynk.online", "348933516.github.io"]);

function normalizePath(value: string) {
  const route = value.startsWith("#") ? value.slice(1) : value;
  const url = new URL(route, window.location.origin);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const target = `${path}${url.search}${url.hash}`;
  if (blockedCarouselPaths.some((pattern) => pattern.test(path))) return "";
  return allowedCarouselPaths.some((pattern) => pattern.test(target)) ? target : "";
}

export function normalizeCarouselTarget(value?: string | null) {
  const input = value?.trim();
  if (!input) return "";
  if (input.startsWith("/") || input.startsWith("#/")) return normalizePath(input);
  try {
    const url = new URL(input, window.location.origin);
    if (url.hostname !== window.location.hostname && !knownSiteHosts.has(url.hostname)) return "";
    const hashRoute = url.hash.startsWith("#/") ? url.hash.slice(1) : "";
    return normalizePath(hashRoute || `${url.pathname}${url.search}${url.hash}`);
  } catch {
    return "";
  }
}
