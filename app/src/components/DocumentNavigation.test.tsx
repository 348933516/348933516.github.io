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

  it("edits display labels without changing the source outline item", () => {
    const outlineId = "123e4567-e89b-42d3-a456-426614174020";
    const sourceItems: OutlineItem[] = [{ id: outlineId, label: "正文标题", level: 2, kind: "heading", targetId: "chapter-two" }];
    const onSettingsChange = vi.fn();
    render(<DocumentOutline items={sourceItems} editable settings={{ title: "文章大纲", headingGroupLabel: "正文", mediaGroupLabel: "图片目录", labels: {} }} onSettingsChange={onSettingsChange} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑大纲名称" }));
    fireEvent.change(screen.getByLabelText("修改目录名称：正文标题"), { target: { value: "公开名称" } });

    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ labels: { [outlineId]: "公开名称" } }));
    expect(sourceItems[0].label).toBe("正文标题");
  });
});
