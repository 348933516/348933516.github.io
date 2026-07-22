import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackToTop, DocumentOutline, type OutlineItem } from "./DocumentNavigation";

const items: OutlineItem[] = [
  { id: "heading-one", label: "第一章", level: 1, kind: "heading", targetId: "chapter-one" },
  { id: "media-one", label: "可爱风", level: 2, kind: "media", targetId: "media-one" }
];

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("long document navigation", () => {
  it("scrolls to an outline target without changing the HashRouter route", () => {
    const scrollIntoView = vi.fn();
    window.location.hash = "#/content/maps";
    render(<><div id="chapter-one" ref={(node) => { if (node) node.scrollIntoView = scrollIntoView; }} /><DocumentOutline items={items} /></>);

    fireEvent.click(screen.getByRole("button", { name: "第一章" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(window.location.hash).toBe("#/content/maps");
    expect(screen.getByText("正文")).toBeInTheDocument();
    expect(screen.getByText("图片目录")).toBeInTheDocument();
  });

  it("shows after the configured scroll distance and returns its own container to the top", () => {
    let observerCallback: IntersectionObserverCallback = () => undefined;
    class ObserverStub {
      constructor(callback: IntersectionObserverCallback) { observerCallback = callback; }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "0px";
      thresholds = [];
    }
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    const scrollTarget = document.createElement("div");
    scrollTarget.scrollTo = vi.fn();
    Object.defineProperty(scrollTarget, "scrollTop", { value: 321, writable: true });
    render(<BackToTop getScrollTarget={() => scrollTarget} />);

    act(() => observerCallback([], {} as IntersectionObserver));
    const button = screen.getByRole("button", { name: "回到顶部" });
    expect(button).toHaveClass("visible");
    fireEvent.click(button);
    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
