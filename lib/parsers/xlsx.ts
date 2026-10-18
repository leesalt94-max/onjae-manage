import ExcelJS from "exceljs";

// 일부 플랫폼(트립닷컴 등)은 내보내기를 엑셀(xlsx)로만 준다. 첫 시트를 CSV 텍스트로 바꿔 기존 파서에 넘긴다.
export async function xlsxToCsv(data: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return "";
  const lines: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= sheet.columnCount; i++) cells.push(quote(cellText(row.getCell(i).value)));
    lines.push(cells.join(","));
  });
  return lines.join("\n");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    return "";
  }
  return String(value);
}

function quote(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
