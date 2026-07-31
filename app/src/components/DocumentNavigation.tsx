import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowUp, ListTree, Pencil, RotateCcw, X } from "lucide-react";
import { defaultOutlineSettings, normalizeOutlineSettings, outlineLabel } from "../lib/outline";
import type { OutlineSettings } from "../types";

export type OutlineItemKind = "heading" | "media";

export interface OutlineItem {
  id: string;
  label: string;
  level: number;
  kind: OutlineItemKind;
  targetId: string;
}

interface DocumentOutlineProps {
  items: OutlineItem[];
  activeId?: string;
  observe?: boolean;
  className?: string;
  onNavigate?: (item: OutlineItem) => void;
  settings?: OutlineSettings;
  editable?: boolean;
  onSettingsChange?: (settings: OutlineSettings) => void;
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollToOutlineTarget(targetId: string) {
  const target = document.getElementById(targetId);
  if (!target) return false;
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  return true;
}

function useObservedOutline(items: OutlineItem[], enabled: boolean) {
  const [activeId, setActiveId] = useState(items[0]?.id || "");
  const itemKey = items.map((item) => `${item.id}:${item.targetId}`).join("|");

  useEffect(() => {
    if (!enabled || !items.length) return;
    const targets = items
      .map((item) => ({ item, element: document.getElementById(item.targetId) }))
      .filter((entry): entry is { item: OutlineItem; element: HTMLElement } => Boolean(entry.element));
    if (!targets.length) return;
    setActiveId((current) => current || targets[0].item.id);

    if (typeof IntersectionObserver === "undefined") return;
    const selectCurrent = () => {
      const offset = 112;
      const passed = targets.filter(({ element }) => element.getBoundingClientRect().top <= offset);
      const current = passed.at(-1) || targets.find(({ element }) => element.getBoundingClientRect().top > offset) || targets[0];
      setActiveId(current.item.id);
    };
    const observer = new IntersectionObserver((entries) => {
      const entering = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      const matched = entering && targets.find(({ element }) => element === entering.target);
      if (matched) setActiveId(matched.item.id);
      else selectCurrent();
    }, {
      root: null,
      rootMargin: "-96px 0px -72% 0px",
      threshold: [0, 1]
    });
    targets.forEach(({ element }) => observer.observe(element));
    selectCurrent();
    return () => observer.disconnect();
  // itemKey is the stable primitive representation needed by the observer lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, itemKey]);

  return activeId;
}

export function DocumentOutline({ items, activeId, observe = false, className = "", onNavigate, settings, editable = false, onSettingsChange }: DocumentOutlineProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const observedId = useObservedOutline(items, observe && !activeId);
  const currentId = activeId || observedId;
  const normalizedSettings = normalizeOutlineSettings(settings || defaultOutlineSettings);
  const grouped = useMemo(() => items.map((item, index) => ({
    item: { ...item, label: outlineLabel(normalizedSettings, item.id, item.label) },
    originalLabel: item.label,
    startsGroup: index === 0 || items[index - 1].kind !== item.kind
  })), [items, normalizedSettings]);

  useEffect(() => {
    const button = activeButtonRef.current;
    const panel = panelRef.current;
    if (!button || !panel || typeof panel.scrollTo !== "function") return;
    const top = Math.max(0, button.offsetTop - panel.clientHeight / 2 + button.offsetHeight / 2);
    panel.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [currentId]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  if (!items.length) return null;
  const navigate = (item: OutlineItem) => {
    if (onNavigate) onNavigate(item);
    else scrollToOutlineTarget(item.targetId);
    setOpen(false);
  };
  const changeSettings = (patch: Partial<OutlineSettings>) => onSettingsChange?.(normalizeOutlineSettings({ ...normalizedSettings, ...patch }));
  const changeItemLabel = (item: OutlineItem, value: string) => changeSettings({ labels: { ...normalizedSettings.labels, [item.id]: value } });
  const resetItemLabel = (item: OutlineItem) => {
    const labels = { ...normalizedSettings.labels };
    delete labels[item.id];
    changeSettings({ labels });
  };

  return (
    <aside className={`document-outline ${open ? "open" : ""} ${className}`.trim()}>
      <button className="outline-mobile-trigger" type="button" aria-expanded={open} onClick={() => setOpen(true)}>
        <ListTree />大纲<span>{items.length}</span>
      </button>
      {open && <button className="outline-backdrop" type="button" aria-label="关闭大纲" onClick={() => setOpen(false)} />}
      <nav ref={panelRef} className={`document-outline-panel${editing ? " editing" : ""}`} aria-label={normalizedSettings.title}>
        <header>{editing ? <input aria-label="大纲面板标题" value={normalizedSettings.title} onChange={(event) => changeSettings({ title: event.target.value })} /> : <strong><ListTree />{normalizedSettings.title}</strong>}<div>{editable && <button type="button" aria-label={editing ? "完成大纲改名" : "编辑大纲名称"} title={editing ? "完成" : "编辑名称"} onClick={() => setEditing((value) => !value)}><Pencil /></button>}<button className="outline-close" type="button" aria-label="关闭大纲" onClick={() => setOpen(false)}><X /></button></div></header>
        <div className="document-outline-list">
          {grouped.map(({ item, originalLabel, startsGroup }) => (
            <div className="document-outline-entry" key={item.id}>
              {startsGroup && (editing ? <input className="outline-section-input" aria-label={`${item.kind === "heading" ? "正文" : "图片"}分组名称`} value={item.kind === "heading" ? normalizedSettings.headingGroupLabel : normalizedSettings.mediaGroupLabel} onChange={(event) => changeSettings(item.kind === "heading" ? { headingGroupLabel: event.target.value } : { mediaGroupLabel: event.target.value })} /> : <span className="outline-section-label">{item.kind === "heading" ? normalizedSettings.headingGroupLabel : normalizedSettings.mediaGroupLabel}</span>)}
              <button
                type="button"
                className={currentId === item.id ? "active" : ""}
                ref={currentId === item.id ? activeButtonRef : undefined}
                aria-current={currentId === item.id ? "location" : undefined}
                style={{ "--outline-level": Math.max(0, Math.min(3, item.level - 1)) } as CSSProperties}
                onClick={() => navigate(item)}
              >
                <span />{item.label}
              </button>
              {editing && <div className="outline-label-editor"><input aria-label={`修改目录名称：${originalLabel}`} value={normalizedSettings.labels[item.id] || ""} placeholder={originalLabel} onChange={(event) => changeItemLabel(item, event.target.value)} /><button type="button" title="恢复正文名称" aria-label={`恢复“${originalLabel}”`} onClick={() => resetItemLabel(item)}><RotateCcw /></button></div>}
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
}

type ScrollTarget = HTMLElement | Window | null;

interface BackToTopProps {
  getScrollTarget?: () => ScrollTarget;
  threshold?: number;
  blocked?: boolean;
  className?: string;
}

function isWindowTarget(target: ScrollTarget): target is Window | null {
  return !target || target === window;
}

function targetScrollTop(target: ScrollTarget) {
  if (isWindowTarget(target)) return window.scrollY || document.documentElement.scrollTop;
  return target.scrollTop;
}

export function BackToTop({ getScrollTarget, threshold = 320, blocked = false, className = "" }: BackToTopProps) {
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = getScrollTarget?.() || window;
    const update = () => setVisible(targetScrollTop(target) > threshold);
    if (typeof IntersectionObserver !== "undefined" && sentinelRef.current) {
      const observer = new IntersectionObserver((entries) => {
        const sentinel = entries[0];
        if (!sentinel) update();
        else setVisible(!sentinel.isIntersecting && targetScrollTop(target) > threshold);
      }, { root: isWindowTarget(target) ? null : target });
      observer.observe(sentinelRef.current);
      update();
      return () => observer.disconnect();
    }
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; update(); });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [getScrollTarget, threshold]);

  const goToTop = () => {
    const target = getScrollTarget?.() || window;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (isWindowTarget(target)) window.scrollTo({ top: 0, behavior });
    else target.scrollTo({ top: 0, behavior });
  };

  return (
    <>
      <span ref={sentinelRef} className="back-to-top-sentinel" style={{ top: threshold }} aria-hidden="true" />
      <button
        type="button"
        className={`back-to-top ${visible && !blocked ? "visible" : ""} ${className}`.trim()}
        aria-label="回到顶部"
        title="回到顶部"
        tabIndex={visible && !blocked ? 0 : -1}
        onClick={goToTop}
      ><ArrowUp /></button>
    </>
  );
}
