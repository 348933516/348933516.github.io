import { beforeEach, describe, expect, it, vi } from "vitest";
import { composeWorksheetImport, materializeWordDocument, prepareWordHtml, readDocument, type WorksheetPreview } from "./documents";
import { getDocumentImportStatus, registerDocumentImportAsset } from "./repository";
import { uploadSupabaseTus } from "./tusUpload";

vi.mock("./repository", () => ({
  getDocumentImportStatus: vi.fn(),
  registerDocumentImportAsset: vi.fn()
}));

vi.mock("./tusUpload", () => ({ uploadSupabaseTus: vi.fn() }));

vi.mock("mammoth", () => {
  const mammoth = {
    images: { imgElement: (handler: unknown) => handler },
    convertToHtml: vi.fn(async (_input: unknown, options: { convertImage(image: { contentType: string; readAsArrayBuffer(): Promise<Uint8Array> }): Promise<{ src: string; alt: string }> }) => {
      const converted = await options.convertImage({
        contentType: "image/png",
        readAsArrayBuffer: async () => new Uint8Array([10, 20, 30])
      });
      return { value: `<p><img src="${converted.src}" alt="${converted.alt}"></p>`, messages: [] };
    })
  };
  return { default: mammoth, ...mammoth };
});

const emptyStatus = {
  job: { id: "00000000-0000-4000-8000-000000000099", status: "uploading" as const, expectedImages: 1 },
  assets: [], events: []
};

describe("document imports", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("uses compatibility parsing when the Worker completes without delivering image messages", async () => {
    const previousWorker = globalThis.Worker;
    class DirectUploadWorker {
      onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(message: Record<string, unknown>) {
        if (message.type !== "start") return;
        queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: { type: "complete", html: '<p><img src="https://word-import.invalid/word-image-1" alt="descript"></p>', imageCount: 1, uploadAttempted: true, uploadedImageCount: 1, totalOriginalBytes: 1024, warnings: [] } })));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", DirectUploadWorker);
    vi.mocked(uploadSupabaseTus).mockResolvedValue({ uploadUrl: "https://uploads.example.test/fallback", retries: 0, resumed: false });
    vi.mocked(registerDocumentImportAsset).mockResolvedValue({ registered_assets: 1 });
    vi.mocked(getDocumentImportStatus).mockResolvedValueOnce(emptyStatus).mockResolvedValueOnce({
      ...emptyStatus,
      assets: [{ image_index: 1, media_id: "00000000-0000-4000-8000-000000000001", original_path: "imports/job/1.png", display_path: "imports/job/1.png", sort_order: 10 }]
    });
    try {
      const phases: string[] = [];
      const file = { name: "maps.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 8, arrayBuffer: async () => new ArrayBuffer(8) } as File;
      const result = await materializeWordDocument(file, {
        supabaseUrl: "https://project.example.test",
        publishableKey: "public-key",
        accessToken: "access-token",
        bucket: "public",
        importId: "00000000-0000-4000-8000-000000000099",
        uploadPrefix: "imports/00000000-0000-4000-8000-000000000099",
        existingMediaCount: 0,
        expectedImages: 1
      }, (progress) => phases.push(progress.phase));
      expect(phases).toContain("fallback");
      expect(vi.mocked(uploadSupabaseTus)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(registerDocumentImportAsset)).toHaveBeenCalledTimes(1);
      expect(result.uploadedImageCount).toBe(1);
      expect(result.bodyHtml).toContain('data-media-id="00000000-0000-4000-8000-000000000001"');
      expect(result.bodyHtml).toContain("https://project.example.test/storage/v1/object/public/public/imports/job/1.png");
      expect(result.bodyHtml).not.toContain("descript");
    } finally {
      vi.unstubAllGlobals();
      if (previousWorker) vi.stubGlobal("Worker", previousWorker);
    }
  });

  it("waits for the main-thread upload and server registration before acknowledging the next Word image", async () => {
    const previousWorker = globalThis.Worker;
    const events: string[] = [];
    const first = { id: "word-image-1", index: 1, hash: "a".repeat(64), mimeType: "image/png", extension: "png", original: new ArrayBuffer(4) };
    const second = { id: "word-image-2", index: 2, hash: "b".repeat(64), mimeType: "image/png", extension: "png", original: new ArrayBuffer(6) };
    class AckWorker {
      onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(message: Record<string, unknown>) {
        if (message.type === "start") queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: { type: "image", image: first } })));
        if (message.type === "ack" && message.id === first.id) {
          events.push("ack-1");
          expect(vi.mocked(uploadSupabaseTus)).toHaveBeenCalledTimes(1);
          expect(vi.mocked(registerDocumentImportAsset)).toHaveBeenCalledTimes(1);
          queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: { type: "image", image: second } })));
        }
        if (message.type === "ack" && message.id === second.id) {
          events.push("ack-2");
          queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: { type: "complete", html: '<p><img src="https://word-import.invalid/word-image-1"></p><p><img src="https://word-import.invalid/word-image-2"></p>', imageCount: 2, totalOriginalBytes: 10, warnings: [] } })));
        }
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", AckWorker);
    vi.mocked(uploadSupabaseTus).mockImplementation(async (input) => {
      input.onProgress?.({ loaded: input.file.size, total: input.file.size, retries: 0, resumed: false });
      return { uploadUrl: "https://uploads.example.test/1", retries: 0, resumed: false };
    });
    vi.mocked(registerDocumentImportAsset).mockResolvedValue({ registered_assets: 1 });
    vi.mocked(getDocumentImportStatus).mockResolvedValueOnce({ ...emptyStatus, job: { ...emptyStatus.job, expectedImages: 2 } }).mockResolvedValueOnce({
      ...emptyStatus,
      job: { ...emptyStatus.job, expectedImages: 2 },
      assets: [
        { image_index: 1, media_id: "00000000-0000-4000-8000-000000000001", original_path: "imports/job/1.png", display_path: "imports/job/1.png", sort_order: 10 },
        { image_index: 2, media_id: "00000000-0000-4000-8000-000000000002", original_path: "imports/job/2.png", display_path: "imports/job/2.png", sort_order: 20 }
      ]
    });
    try {
      const file = { name: "maps.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 8, arrayBuffer: async () => new ArrayBuffer(8) } as File;
      const result = await materializeWordDocument(file, {
        supabaseUrl: "https://project.example.test", publishableKey: "public-key", accessToken: "access-token", bucket: "public",
        importId: "00000000-0000-4000-8000-000000000099", uploadPrefix: "imports/00000000-0000-4000-8000-000000000099", existingMediaCount: 0, expectedImages: 2
      });
      expect(events).toEqual(["ack-1", "ack-2"]);
      expect(vi.mocked(uploadSupabaseTus)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(registerDocumentImportAsset).mock.calls.map((call) => call[1].imageIndex)).toEqual([1, 2]);
      expect(result.uploadedImageCount).toBe(2);
      expect((result.bodyHtml.match(/data-media-id/g) || [])).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
      if (previousWorker) vi.stubGlobal("Worker", previousWorker);
    }
  });

  it("resumes a complete 98-image server manifest without uploading any image again", async () => {
    const previousWorker = globalThis.Worker;
    const images = Array.from({ length: 98 }, (_, index) => ({
      id: `word-image-${index + 1}`,
      index: index + 1,
      hash: String(index + 1).padStart(64, "0"),
      mimeType: "image/png",
      extension: "png",
      original: new ArrayBuffer(1)
    }));
    const assets = images.map((image) => ({
      image_index: image.index,
      media_id: `00000000-0000-4000-8000-${String(image.index).padStart(12, "0")}`,
      original_path: `imports/job/${image.index}.png`,
      display_path: `imports/job/${image.index}.png`,
      sort_order: image.index * 10
    }));
    class ResumeWorker {
      onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(message: Record<string, unknown>) {
        if (message.type === "start") queueMicrotask(() => this.sendImage(0));
        if (message.type === "ack") queueMicrotask(() => this.sendImage(Number(message.id?.toString().replace("word-image-", ""))));
      }
      private sendImage(index: number) {
        if (index < images.length) {
          this.onmessage?.(new MessageEvent("message", { data: { type: "image", image: images[index] } }));
          return;
        }
        const html = images.map((image) => `<p><img src="https://word-import.invalid/${image.id}"></p>`).join("");
        this.onmessage?.(new MessageEvent("message", { data: { type: "complete", html, imageCount: 98, totalOriginalBytes: 98, warnings: [] } }));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", ResumeWorker);
    vi.mocked(getDocumentImportStatus)
      .mockResolvedValueOnce({ ...emptyStatus, job: { ...emptyStatus.job, expectedImages: 98 }, assets })
      .mockResolvedValueOnce({ ...emptyStatus, job: { ...emptyStatus.job, expectedImages: 98 }, assets });
    try {
      const file = { name: "maps.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 98, arrayBuffer: async () => new ArrayBuffer(98) } as File;
      const result = await materializeWordDocument(file, {
        supabaseUrl: "https://project.example.test", publishableKey: "public-key", accessToken: "access-token", bucket: "public",
        importId: "00000000-0000-4000-8000-000000000099", uploadPrefix: "imports/job", existingMediaCount: 0, expectedImages: 98
      });
      expect(vi.mocked(uploadSupabaseTus)).not.toHaveBeenCalled();
      expect(vi.mocked(registerDocumentImportAsset)).not.toHaveBeenCalled();
      expect(result.uploadedImageCount).toBe(98);
      expect((result.bodyHtml.match(/data-media-id=/g) || [])).toHaveLength(98);
      expect((result.bodyHtml.match(/<img\b/g) || [])).toHaveLength(98);
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
