import { describe, expect, it } from "vitest";
import { composeWorksheetImport, readDocument, type WorksheetPreview } from "./documents";

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
