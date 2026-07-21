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

  it("writes the selected border preset into the newly inserted table and every cell", async () => {
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
      expect(html).toContain('data-cell-border-width="8"');
      expect(html).toContain('data-cell-border-style="double"');
      expect(html).toContain('--rich-table-border: 8px');
      expect(html).toContain('--rich-table-style: double');
      expect(html).toContain('--rich-cell-border-width: 8px');
      expect(html).toContain('--rich-cell-border-style: double');
      expect(html).toContain('border-width: 8px');
      expect(html).toContain('border-style: double');
    });
  });

  it("persists a selected custom table color in the table and its cells", async () => {
    const onChange = vi.fn();
    render(<RichEditor value="<p>正文</p>" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "插入表格" }));
    fireEvent.click(screen.getByRole("button", { name: "线色" }));
    fireEvent.click(screen.getByTitle("#ff938d"));
    fireEvent.click(screen.getByRole("button", { name: "2 行 4 列" }));
    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] || "";
      expect(html).toContain('data-table-color="#ff938d"');
      expect(html).toContain('data-cell-border-color="#ff938d"');
      expect(html).toContain('--rich-cell-border-color: #ff938d');
      expect(html).toContain('border-color: #ff938d');
    });
  });

  it("uses a white paper canvas for the document surface", () => {
    const { container } = render(<RichEditor value="<p>正文</p>" onChange={vi.fn()} />);
    expect(container.querySelector(".editor-surface")).toBeInTheDocument();
  });

  it("parses an imported figure without creating a second image node", () => {
    const mediaId = "123e4567-e89b-42d3-a456-426614174000";
    const value = `<figure data-editor-image="true" data-media-id="${mediaId}"><img src="https://example.com/imported.png" alt="图片 1"><figcaption></figcaption></figure>`;
    const { container } = render(<RichEditor value={value} onChange={vi.fn()} />);

    expect(container.querySelectorAll('.editor-surface img[src="https://example.com/imported.png"]')).toHaveLength(1);
  });

  it("pastes tab-separated spreadsheet data as an editable table", async () => {
    const onChange = vi.fn();
    const { container } = render(<RichEditor value="<p>正文</p>" onChange={onChange} />);
    const surface = container.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(surface).toBeTruthy();
    fireEvent.paste(surface!, {
      clipboardData: {
        items: [],
        getData: (type: string) => type === "text/plain" ? "名称\t等级\n测试地图\t200" : ""
      }
    });
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0] || "").toContain("<table"));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("测试地图");
  });

  it("uploads and inserts an image pasted from the clipboard", async () => {
    const onChange = vi.fn();
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const onUploadImages = vi.fn(async () => [{ src: "https://cdn.example.test/clipboard.png", alt: "clipboard" }]);
    const { container } = render(<RichEditor value="<p>正文</p>" onChange={onChange} onUploadImages={onUploadImages} />);
    const surface = container.querySelector<HTMLElement>('[contenteditable="true"]');
    fireEvent.paste(surface!, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => image }],
        getData: () => ""
      }
    });
    await waitFor(() => expect(onUploadImages).toHaveBeenCalledWith([image]));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0] || "").toContain("https://cdn.example.test/clipboard.png"));
  });
});
