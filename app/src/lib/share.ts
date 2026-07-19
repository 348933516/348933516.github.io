export function buildShareUrl(route: string, currentUrl = window.location.href) {
  const url = new URL(currentUrl);
  url.searchParams.delete("v");
  url.hash = route.startsWith("/") ? route : `/${route}`;
  return url.href;
}

export async function copyShareUrl(value: string) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Some browsers expose the API but still reject it by policy.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.dataset.shareCopy = "true";
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "-9999px auto auto -9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
