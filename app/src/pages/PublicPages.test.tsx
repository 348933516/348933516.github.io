import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { DataProvider } from "../data";
import { loadPublicContent } from "../lib/repository";
import type { PublicData } from "../types";
import { DetailPage, HomePage } from "./PublicPages";

vi.mock("../lib/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/repository")>();
  return { ...actual, loadPublicContent: vi.fn() };
});

const data: PublicData = {
  backendMode: "structured",
  settings: {
    brandTitle: "MapleStoryNK",
    brandSubtitle: "资料中心",
    heroTitle: "MapleStoryNK",
    heroSubtitle: "专业资料站",
    categoryTitle: "资料目录",
    categorySubtitle: "选择类目浏览",
    carouselEnabled: true,
    carouselAutoplay: false,
    carouselIntervalMs: 4500,
    carouselTransition: "slide"
  },
  carouselSlides: [
    {
      id: "s1",
      title: "首页轮播",
      subtitle: "轮播图内容",
      imageUrl: "https://example.com/hero.webp",
      linkUrl: "",
      linkLabel: "",
      sortOrder: 10,
      visible: true,
      createdAt: "2026-07-19",
      updatedAt: "2026-07-19"
    }
  ],
  categories: [
    { id: "c1", slug: "wz", name: "WZ业务目录", description: "WZ 资料", sortOrder: 10, visible: true },
    { id: "c2", slug: "boss", name: "BOSS配套地图", description: "BOSS 资料", sortOrder: 20, visible: true }
  ],
  contents: [
    {
      id: "p1",
      slug: "first",
      categoryId: "c1",
      categorySlug: "wz",
      categoryName: "WZ业务目录",
      title: "第一篇资料",
      summary: "摘要",
      bodyHtml: "<p>正文</p>",
      bodyJson: {},
      bodyText: "正文",
      sourceRecord: "",
      status: "published",
      featured: false,
      sortOrder: 10,
      version: 1,
      tags: [],
      media: [],
      attachments: [],
      createdAt: "2026-07-19",
      updatedAt: "2026-07-19"
    }
  ]
};

describe("public home", () => {
  it("renders the carousel and category catalog without search", () => {
    const { container } = render(<MemoryRouter><DataProvider data={data}><HomePage /></DataProvider></MemoryRouter>);
    expect(screen.getByRole("region", { name: "首页轮播" })).toBeInTheDocument();
    expect(container.querySelector(".hero-carousel-slide-static .hero-carousel-overlay")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "首页轮播" })).toBeInTheDocument();
    expect(screen.getByText("轮播图内容")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "资料目录" })).toBeInTheDocument();
    expect(screen.getAllByText("WZ业务目录").length).toBeGreaterThan(0);
    expect(container.querySelector(".hero-carousel-overlay > div > span")).toBeNull();
    expect(container.querySelector(".section-heading > div > span")).toBeNull();
    expect(container.querySelector(".category-entry div > span")).toBeNull();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText("最近更新")).not.toBeInTheDocument();
  });

  it("loads only the active carousel image until another slide is selected", () => {
    const withSlides: PublicData = {
      ...data,
      carouselSlides: [
        data.carouselSlides[0],
        { ...data.carouselSlides[0], id: "s2", title: "第二张", imageUrl: "https://example.com/second.webp", sortOrder: 20 },
        { ...data.carouselSlides[0], id: "s3", title: "第三张", imageUrl: "https://example.com/third.webp", sortOrder: 30 }
      ]
    };
    const { container } = render(<MemoryRouter><DataProvider data={withSlides}><HomePage /></DataProvider></MemoryRouter>);
    expect(container.querySelectorAll(".hero-carousel-image")).toHaveLength(1);
    expect(container.querySelector('.hero-carousel-image[src="https://example.com/hero.webp"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换到第 2 张" }));
    expect(container.querySelectorAll(".hero-carousel-image")).toHaveLength(2);
    expect(container.querySelector('.hero-carousel-image[src="https://example.com/second.webp"]')).toBeInTheDocument();
  });

  it("uses a full-width reader layout when there is no media outline", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/content/first"]}>
        <DataProvider data={data}><Routes><Route path="/content/:slug" element={<DetailPage />} /></Routes></DataProvider>
      </MemoryRouter></QueryClientProvider>
    );
    expect(container.querySelector(".reader-layout")).toHaveClass("without-outline");
    expect(container.querySelector(".reader-main")).toBeInTheDocument();
  });

  it("merges document headings and nested media paths into one button-based outline", () => {
    const withOutline: PublicData = {
      ...data,
      contents: [{
        ...data.contents[0],
        bodyHtml: "<h2>正文章节</h2><p>内容</p>",
        media: [{
          id: "gallery-1",
          kind: "image",
          src: "https://example.com/gallery.png",
          title: "可爱风地图",
          note: "",
          path: ["主题地图", "可爱风"],
          altText: "可爱风地图",
          sortOrder: 10
        }]
      }]
    };
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/content/first"]}>
        <DataProvider data={withOutline}><Routes><Route path="/content/:slug" element={<DetailPage />} /></Routes></DataProvider>
      </MemoryRouter></QueryClientProvider>
    );

    expect(container.querySelector(".reader-layout")).toHaveClass("with-outline");
    expect(screen.getByRole("button", { name: "正文章节" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主题地图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "可爱风" })).toBeInTheDocument();
    expect(container.querySelector('.document-outline-panel a[href^="#"]')).toBeNull();
    expect(container.querySelector("#media-gallery-1")).toBeInTheDocument();
  });

  it("keeps a stable hook order while remote content changes from loading to loaded", async () => {
    vi.mocked(loadPublicContent).mockResolvedValueOnce({ item: data.contents[0], siblings: [] });
    const remoteData: PublicData = { ...data, contents: [] };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={["/content/first"]}>
            <DataProvider data={remoteData}><Routes><Route path="/content/:slug" element={<DetailPage />} /></Routes></DataProvider>
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(screen.getByText("正在读取资料正文")).toBeInTheDocument();
      await waitFor(() => expect(document.querySelector(".reader-main")).toBeInTheDocument());
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain("change in the order of Hooks");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not render Word images again in the standalone media gallery", () => {
    const inlineId = "123e4567-e89b-42d3-a456-426614174000";
    const galleryId = "223e4567-e89b-42d3-a456-426614174000";
    const withInlineMedia: PublicData = {
      ...data,
      contents: [{
        ...data.contents[0],
        bodyHtml: `<p>正文图片</p><figure data-editor-image="true" data-media-id="${inlineId}"><img src="https://example.com/inline.png" alt="正文图片"></figure>`,
        media: [
          { id: inlineId, kind: "image", src: "https://example.com/inline.png", title: "正文图片", note: "", path: [], altText: "正文图片", sortOrder: 10 },
          { id: galleryId, kind: "image", src: "https://example.com/gallery.png", title: "独立图片", note: "", path: [], altText: "独立图片", sortOrder: 20 }
        ]
      }]
    };
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/content/first"]}>
        <DataProvider data={withInlineMedia}><Routes><Route path="/content/:slug" element={<DetailPage />} /></Routes></DataProvider>
      </MemoryRouter></QueryClientProvider>
    );

    expect(container.querySelectorAll('img[src="https://example.com/inline.png"]')).toHaveLength(1);
    expect(container.querySelectorAll('img[src="https://example.com/gallery.png"]')).toHaveLength(1);
    expect(container.querySelectorAll(".media-row")).toHaveLength(1);
  });

  it("only makes the carousel clickable for public internal targets", () => {
    const linked: PublicData = {
      ...data,
      carouselSlides: [{ ...data.carouselSlides[0], linkUrl: "/content/first" }]
    };
    const { container } = render(<MemoryRouter><DataProvider data={linked}><HomePage /></DataProvider></MemoryRouter>);
    expect(container.querySelector(".hero-carousel-slide a")).toHaveAttribute("href", "/content/first");
  });

  it("does not navigate carousel clicks to admin routes", () => {
    const unsafe: PublicData = {
      ...data,
      carouselSlides: [{ ...data.carouselSlides[0], linkUrl: "/admin/settings" }]
    };
    const { container } = render(<MemoryRouter><DataProvider data={unsafe}><HomePage /></DataProvider></MemoryRouter>);
    expect(container.querySelector(".hero-carousel-slide a")).toBeNull();
  });

  it("uses the first content image when a category has no cover", () => {
    const withMedia: PublicData = {
      ...data,
      carouselSlides: [],
      contents: [
        {
          ...data.contents[0],
          media: [
            {
              id: "m1",
              kind: "image",
              src: "https://example.com/cover.webp",
              title: "封面",
              note: "",
              path: [],
              altText: "封面",
              sortOrder: 10
            }
          ]
        }
      ]
    };
    const { container } = render(<MemoryRouter><DataProvider data={withMedia}><HomePage /></DataProvider></MemoryRouter>);
    expect(container.querySelector('.category-entry[href="/category/wz"] .category-visual img')).toHaveAttribute("src", "https://example.com/cover.webp");
  });
});
