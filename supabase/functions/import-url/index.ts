import { convert } from "npm:html-to-text@9.0.5";
import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)) return true;
  if (/^(100\.(6[4-9]|[78]\d|9[0-9]|1[01]\d|12[0-7])\.|198\.(1[89])\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:")) return true;
  return false;
}

async function assertPublicDestination(url: URL) {
  if (url.username || url.password || isBlockedHost(url.hostname)) throw new Error("URL is not allowed");
  const literalIp = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(":");
  if (literalIp) return;
  const addresses = [
    ...await Deno.resolveDns(url.hostname, "A"),
    ...await Deno.resolveDns(url.hostname, "AAAA")
  ];
  if (!addresses.length || addresses.some(isBlockedHost)) throw new Error("URL resolves to a private or unavailable address");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character] ?? character);
}

async function fetchSafe(input: string) {
  let url = new URL(input);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("URL is not allowed");
    await assertPublicDestination(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "MapleStoryNK-Importer/2.0" }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Invalid redirect");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) throw new Error("Source is not an HTML page");
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 3_000_000) throw new Error("Page is too large");
    const html = (await response.text()).slice(0, 3_000_000);
    return { html, url };
  }
  throw new Error("Too many redirects");
}

Deno.serve((request) => edgeHandler(request, async () => {
  await requireRole(request, ["super_admin", "editor", "uploader"]);
  const body = await request.json();
  const input = String(body.url ?? "").trim();
  if (!input) return json({ error: "URL is required" }, 400);
  const { html, url } = await fetchSafe(input);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() || url.hostname;
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "nav", format: "skip" },
      { selector: "footer", format: "skip" }
    ]
  }).replace(/\n{3,}/g, "\n\n").trim().slice(0, 120_000);
  const bodyHtml = text.split(/\n{2,}/).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
    .map((match) => {
      try {
        const image = new URL(match[1], url);
        return image.protocol === "https:" ? image.href : "";
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .slice(0, 30);
  return json({ title, bodyHtml, text, images, source: url.href });
}));
