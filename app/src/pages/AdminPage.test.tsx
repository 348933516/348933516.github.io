import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";

vi.mock("../auth", () => ({
  useAuth: () => ({
    user: { id: "viewer" },
    profile: { id: "viewer", email: "viewer@example.com", displayName: "只读账号", role: "viewer", status: "active" },
    loading: false,
    profileError: "",
    signOut: vi.fn()
  })
}));

describe("professional admin routing", () => {
  it("keeps system navigation while showing a clear permission state", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/admin/users"]}><Routes><Route path="/admin/*" element={<AdminPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText("内容管理中心")).toBeInTheDocument();
    expect(screen.getByText("内容管理")).toBeInTheDocument();
    expect(screen.queryByText("媒体与附件")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "权限受限" })).toBeInTheDocument();
    expect(screen.getByText("只有超级管理员可以邀请和修改后台账号。")).toBeInTheDocument();
  });
});
