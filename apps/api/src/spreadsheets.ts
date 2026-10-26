import ExcelJS from 'exceljs';
import { AppError, serverT, type imports } from '@openrent/core';

type Sheet = imports.Sheet;

/** RFC 4180 CSV with the delimiter detected from the header line (Excel in Europe writes ";"). */
export function parseCsv(text: string): Sheet {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? undefined : src.search(/\r?\n/));
  const delim = [';', '\t', ','].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers = [], ...data] = rows;
  return { headers, rows: data };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('error' in v) return '';
  }
  return String(v);
}

/** First worksheet of an XLSX file, or a CSV file, as text cells. */
export async function readSheet(body: Buffer, filename: string): Promise<Sheet> {
  const isXlsx = /\.xlsx$/i.test(filename) || (body[0] === 0x50 && body[1] === 0x4b);
  try {
    if (!isXlsx) return parseCsv(body.toString('utf8'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return { headers: [], rows: [] };
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (r) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(r.getCell(c).value).trim());
      rows.push(cells);
    });
    const [headers = [], ...data] = rows;
    return { headers, rows: data };
  } catch {
    throw new AppError('unreadable_file', 422, serverT('imports.unreadable'), { errors: [{ field: 'file', code: 'unreadable', message: serverT('imports.unreadable') }] });
  }
}

/** Cells starting with = + - @ would run as formulas in a spreadsheet: neutralise them. */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s);

export function writeCsv(sheet: Sheet): string {
  const cell = (v: string) => {
    const s = safe(v ?? '');
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [sheet.headers, ...sheet.rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export async function writeXlsx(sheet: Sheet, name: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OpenRent';
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.addRow(sheet.headers).font = { bold: true };
  for (const r of sheet.rows) ws.addRow(r.map(safe));
  (ws.columns ?? []).forEach((c, i) => (c.width = Math.min(48, Math.max(10, ...[sheet.headers[i] ?? '', ...sheet.rows.slice(0, 200).map((r) => r[i] ?? '')].map((s) => String(s).length + 2)))));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Report rows → a sheet: one column per key, dates as ISO, objects as JSON. */
export function rowsSheet(rows: Record<string, unknown>[]): Sheet {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const text = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return { headers, rows: rows.map((r) => headers.map((h) => text(r[h]))) };
}

export async function sendSheet(reply: any, sheet: Sheet, base: string, format: 'csv' | 'xlsx') {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'xlsx') {
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${base}-${stamp}.xlsx"`)
      .send(await writeXlsx(sheet, base));
  }
  return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${base}-${stamp}.csv"`).send(writeCsv(sheet));
}
