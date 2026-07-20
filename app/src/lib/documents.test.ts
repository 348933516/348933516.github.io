import { describe, expect, it, vi } from "vitest";
import { composeWorksheetImport, materializeWordDocument, prepareWordHtml, readDocument, type WorksheetPreview } from "./documents";

describe("document imports", () => {
  it("composes only the selected worksheets", () => {
    const sheets: WorksheetPreview[] = [
      { name: "地图", rowCount: 2, columnCount: 2, bodyHtml: "<table><tr><td>地图内容</td></tr></table>", bodyText: "地图内容" },
      { name: "掉落", rowCount: 3, columnCount: 1, bodyHtml: "<table><tr><td>掉落内容</td></tr></table>", bodyText: "掉落内容" }
    ];
    const result = composeWorksheetImport(sheets, ["掉落"]);
    expect(result.bodyHtml).toContain("掉落内容");
    expect(result.bodyHtml).not.toContain("地图内容");
    expect(result.bodyText).toContain("掉落");
  });

  it("explains how to handle legacy xls files", async () => {
    const file = new File(["legacy"], "地图.xls", { type: "application/vnd.ms-excel" });
    await expect(readDocument(file)).rejects.toThrow("另存为 .xlsx");
  });

  it("replaces Word image descriptions with stable image labels", () => {
    const result = prepareWordHtml('<p><img src="https://word-import.invalid/word-image-7" alt="descript"></p>', new Map());
    expect(result).toContain("图片 7，确认导入后上传原图");
    expect(result).not.toContain("descript");
  });

  it("keeps every uploaded Word image mapped to a figure without captions", () => {
    const uploaded = new Map(Array.from({ length: 98 }, (_, index) => {
      const imageNumber = index + 1;
      return [`word-image-${imageNumber}`, { id: `word-image-${imageNumber}`, mediaId: `00000000-0000-4000-8000-${String(imageNumber).padStart(12, "0")}`, displayUrl: `https://cdn.example.test/imports/${imageNumber}.png` }];
    }));
    const source = Array.from({ length: 98 }, (_, index) => `<p><img src="https://word-import.invalid/word-image-${index + 1}" alt="descript"></p>`).join("");
    const result = prepareWordHtml(source, uploaded);
    expect((result.match(/<figure\b/g) || [])).toHaveLength(98);
    expect((result.match(/data-media-id=/g) || [])).toHaveLength(98);
    expect((result.match(/<img\b/g) || [])).toHaveLength(98);
    expect(result).not.toContain("descript");
    expect(result).not.toContain("word-image-placeholder");
  });

  it("maps Worker-direct uploads into the final Word body without transferring image bytes to the page", async () => {
    const previousWorker = globalThis.Worker;
    class DirectUploadWorker {
      onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(message: Record<string, unknown>) {
        if (message.type !== "start") return;
        queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: { type: "asset", asset: { id: "word-image-1", mediaId: "00000000-0000-4000-8000-000000000001", displayUrl: "https://cdn.example.test/imports/1.png" } } })));
        queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: { type: "complete", html: '<p><img src="https://word-import.invalid/word-image-1" alt="descript"></p>', imageCount: 1, totalOriginalBytes: 1024, warnings: [] } })));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", DirectUploadWorker);
    try {
      const file = { arrayBuffer: async () => new ArrayBuffer(8) } as File;
      const result = await materializeWordDocument(file, {
        supabaseUrl: "https://project.example.test",
        publishableKey: "public-key",
        accessToken: "access-token",
        bucket: "public",
        importId: "00000000-0000-4000-8000-000000000099",
        uploadPrefix: "imports/00000000-0000-4000-8000-000000000099",
        existingMediaCount: 0
      });
      expect(result.uploadedImageCount).toBe(1);
      expect(result.bodyHtml).toContain('data-media-id="00000000-0000-4000-8000-000000000001"');
      expect(result.bodyHtml).toContain("https://cdn.example.test/imports/1.png");
      expect(result.bodyHtml).not.toContain("descript");
    } finally {
      vi.unstubAllGlobals();
      if (previousWorker) vi.stubGlobal("Worker", previousWorker);
    }
  });

  it("reads xlsx sheets, merged cells and controlled formatting", async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("地图数据");
    sheet.addRow(["名称", "等级"]);
    sheet.addRow(["测试地图", 200]);
    sheet.mergeCells("A3:B3");
    sheet.getCell("A3").value = "合并说明";
    sheet.getCell("A1").font = { bold: true, name: "Microsoft YaHei", size: 18 };
    sheet.getCell("A1").alignment = { horizontal: "center" };
    const buffer = await workbook.xlsx.writeBuffer();
    const file = { name: "地图.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", arrayBuffer: async () => buffer } as File;
    const preview = await readDocument(file);
    expect(preview.kind).toBe("workbook");
    expect(preview.worksheets?.[0]).toMatchObject({ name: "地图数据", rowCount: 3, columnCount: 2 });
    expect(preview.worksheets?.[0].bodyHtml).toContain('colspan="2"');
    expect(preview.worksheets?.[0].bodyHtml).toContain('data-font-family="yahei"');
    expect(preview.worksheets?.[0].bodyHtml).toContain('data-cell-align="center"');
  });
});
