const allowedCarouselPaths = [/^\/content\/[^/?#]+(?:[/?#].*)?$/, /^\/category\/[^/?#]+(?:[/?#].*)?$/];
const blockedCarouselPaths = [/^\/admin(?:\/|$)/, /^\/login(?:\/|$)/, /^\/preview(?:\/|$)/];

export function normalizeCarouselTarget(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (blockedCarouselPaths.some((pattern) => pattern.test(path))) return "";
    if (!allowedCarouselPaths.some((pattern) => pattern.test(`${path}${url.search}${url.hash}`))) return "";
    return `${path}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

