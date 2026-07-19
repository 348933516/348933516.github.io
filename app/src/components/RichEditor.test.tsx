import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RichEditor } from "./RichEditor";

describe("professional rich editor", () => {
  it("exposes typography, alignment and table controls", () => {
    render(<RichEditor value="<p>正文</p>" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "段落格式" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "字体" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "字号" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "文字颜色" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "两端对齐" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插入表格" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除格式" })).toBeInTheDocument();
  });
});
