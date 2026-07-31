import type { OutlineSettings } from "../types";

export const defaultOutlineSettings: OutlineSettings = {
  title: "文章大纲",
  headingGroupLabel: "正文",
  mediaGroupLabel: "图片目录",
  labels: {}
};

export const outlineUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanLabel(value: unknown, fallback: string, maxLength = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text || fallback;
}

export function normalizeOutlineSettings(value: unknown): OutlineSettings {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawLabels = input.labels && typeof input.labels === "object" ? input.labels as Record<string, unknown> : {};
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(rawLabels).slice(0, 500)) {
    const [id, marker, pathIndex] = key.toLowerCase().split(":");
    if (!outlineUuidPattern.test(id)) continue;
    if (marker && (marker !== "path" || !/^[0-3]$/.test(pathIndex || ""))) continue;
    const normalized = cleanLabel(label, "", 120);
    if (normalized) labels[key] = normalized;
  }
  return {
    title: cleanLabel(input.title, defaultOutlineSettings.title),
    headingGroupLabel: cleanLabel(input.headingGroupLabel ?? input.heading_group_label, defaultOutlineSettings.headingGroupLabel),
    mediaGroupLabel: cleanLabel(input.mediaGroupLabel ?? input.media_group_label, defaultOutlineSettings.mediaGroupLabel),
    labels
  };
}

export function outlineLabel(settings: OutlineSettings | undefined, key: string, fallback: string) {
  return settings?.labels[key]?.trim() || fallback;
}
