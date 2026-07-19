import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CarouselSettings } from "./CarouselSettings";
import type { Profile } from "../../types";

const slideQuery = vi.hoisted(() => ({
  error: new Error("permission denied")
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        order: vi.fn(async () => table === "carousel_slides" ? { data: null, error: slideQuery.error } : { data: [], error: null })
      })),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null }))
      }))
    })),
    storage: {
      from: vi.fn(() => ({
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://cdn.test/image.webp" } }))
      }))
    }
  }
}));

const profile: Profile = {
  id: "admin-1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "super_admin",
  status: "active"
};

const settings = {
  carousel_enabled: true,
  carousel_autoplay: true,
  carousel_interval_ms: 4500,
  carousel_transition: "slide"
};

function renderCarouselSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CarouselSettings profile={profile} settings={settings} onMessage={vi.fn()} onSaved={vi.fn()} />
    </QueryClientProvider>
  );
}

describe("carousel settings", () => {
  it("keeps the settings form available when slide loading fails", async () => {
    renderCarouselSettings();
    expect(screen.getByRole("button", { name: /保存轮播设置/ })).toBeInTheDocument();
    expect(await screen.findByText("轮播图读取失败")).toBeInTheDocument();
    expect(screen.getByText("permission denied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新读取" })).toBeInTheDocument();
  });
});
