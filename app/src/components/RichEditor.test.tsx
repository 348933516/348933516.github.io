import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RichEditor } from "./RichEditor";

describe("professional rich editor", () => {
  it("exposes typography, alignment and table controls", () => {
    render(<RichEditor value="<p>正文</p>" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "段落格式" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "字体" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "字号" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文字颜色" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "背景高亮" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "两端对齐" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传本地图片" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插入表格" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除选区格式" })).toBeInTheDocument();
  });

  it("lets administrators choose table borders before inserting a table", () => {
    render(<RichEditor value="<p>正文</p>" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "插入表格" }));
    expect(screen.getByRole("dialog", { name: "创建表格" })).toBeInTheDocument();
    expect(screen.getByText("线宽")).toBeInTheDocument();
    expect(screen.getByText("线型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "线色" })).toBeInTheDocument();
    expect(screen.getByText("创建表头")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 行 4 列" })).toBeInTheDocument();
  });

  it("writes the selected border preset into the newly inserted table", async () => {
    const onChange = vi.fn();
    render(<RichEditor value="<p>正文</p>" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "插入表格" }));
    fireEvent.change(screen.getByLabelText("线宽"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("线型"), { target: { value: "double" } });
    fireEvent.click(screen.getByRole("button", { name: "2 行 4 列" }));
    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] || "";
      expect(html).toContain('data-table-border="8"');
      expect(html).toContain('data-table-style="double"');
    });
  });
});
