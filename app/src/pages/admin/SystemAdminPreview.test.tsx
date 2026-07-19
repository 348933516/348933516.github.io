import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteMiniPreview } from "./SystemAdmin";

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(async () => ({
          data: [{ id: "slide-1", title: "轮播标题", subtitle: "轮播说明", image_path: "carousel/hero.webp", link_label: "查看详情", sort_order: 10, is_visible: true }],
          error: null
        }))
      }))
    })),
    storage: {
      from: vi.fn(() => ({
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }))
      }))
    }
  }
}));

const settings = {
  brand_title: "MapleStoryNK",
  brand_subtitle: "资料中心",
  hero_title: "MapleStory",
  hero_subtitle: "资料展示",
  category_title: "类目展示",
  category_subtitle: "选择类目",
  page_background_path: "settings/bg.webp",
  top_logo_path: ""
};

function renderPreview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SiteMiniPreview settings={settings} /></QueryClientProvider>);
}

describe("site mini preview", () => {
  it("renders real carousel slide content instead of placeholder blocks", async () => {
    const { container } = renderPreview();
    expect(await screen.findByText("轮播标题")).toBeInTheDocument();
    expect(screen.getByText("轮播说明")).toBeInTheDocument();
    expect(screen.getByText("查看详情")).toBeInTheDocument();
    expect(container.querySelector(".mini-carousel-frame img")).toHaveAttribute("src", "https://cdn.test/carousel/hero.webp");
  });
});

