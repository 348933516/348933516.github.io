import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const auth = vi.hoisted(() => ({
  user: { email: "348933516@qq.com" },
  profile: null,
  profileError: "正式权限表尚未部署，或者这个账号还没有管理员权限。",
  loading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn()
}));

vi.mock("../auth", () => ({ useAuth: () => auth }));
vi.mock("../lib/supabase", () => ({ supabase: { auth: { resetPasswordForEmail: vi.fn(), signInWithOtp: vi.fn() } } }));

describe("administrator login", () => {
  it("explains a missing profile after password authentication", () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "账号已登录，暂时无法进入后台" })).toBeInTheDocument();
    expect(screen.getByText("当前账号：348933516@qq.com")).toBeInTheDocument();
    expect(screen.getByText(auth.profileError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /重新检查权限/ }));
    expect(auth.refreshProfile).toHaveBeenCalledOnce();
  });
});
