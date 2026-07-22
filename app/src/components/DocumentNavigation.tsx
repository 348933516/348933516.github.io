import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowUp, ListTree, X } from "lucide-react";

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

export function DocumentOutline({ items, activeId, observe = false, className = "", onNavigate }: DocumentOutlineProps) {
  const [open, setOpen] = useState(false);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const observedId = useObservedOutline(items, observe && !activeId);
  const currentId = activeId || observedId;
  const grouped = useMemo(() => items.map((item, index) => ({
    item,
    startsGroup: index === 0 || items[index - 1].kind !== item.kind
  })), [items]);

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

  return (
    <aside className={`document-outline ${open ? "open" : ""} ${className}`.trim()}>
      <button className="outline-mobile-trigger" type="button" aria-expanded={open} onClick={() => setOpen(true)}>
        <ListTree />大纲<span>{items.length}</span>
      </button>
      {open && <button className="outline-backdrop" type="button" aria-label="关闭大纲" onClick={() => setOpen(false)} />}
      <nav ref={panelRef} className="document-outline-panel" aria-label="文章大纲">
        <header><strong><ListTree />文章大纲</strong><button type="button" aria-label="关闭大纲" onClick={() => setOpen(false)}><X /></button></header>
        <div className="document-outline-list">
          {grouped.map(({ item, startsGroup }) => (
            <div className="document-outline-entry" key={item.id}>
              {startsGroup && <span className="outline-section-label">{item.kind === "heading" ? "正文" : "图片目录"}</span>}
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
