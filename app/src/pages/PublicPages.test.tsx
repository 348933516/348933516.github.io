import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DataProvider } from "../data";
import type { PublicData } from "../types";
import { HomePage } from "./PublicPages";

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
    render(<MemoryRouter><DataProvider data={data}><HomePage /></DataProvider></MemoryRouter>);
    expect(screen.getByRole("region", { name: "首页轮播" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "资料目录" })).toBeInTheDocument();
    expect(screen.getAllByText("WZ业务目录").length).toBeGreaterThan(0);
    expect(screen.getByText("01 篇资料")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText("最近更新")).not.toBeInTheDocument();
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
