import CFB from "cfb";

// 트립닷컴 예약 내보내기는 옛 엑셀(xls, BIFF8) 형식으로 온다. 첫 시트의 값만 읽어 CSV 텍스트로 바꾼다.
// 서식·수식은 버리고, 날짜 서식이 걸린 숫자만 YYYY-MM-DD(시각이 있으면 HH:MM 까지)로 바꾼다.
export function isXls(buf: Buffer): boolean {
  return buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

export function xlsToCsv(data: Buffer): string {
  const cfb = CFB.read(data, { type: "buffer" });
  const entry = CFB.find(cfb, "Workbook") ?? CFB.find(cfb, "Book");
  if (!entry?.content) throw new Error("엑셀(xls) 파일에서 통합 문서를 찾지 못했습니다.");
  const stream = Buffer.from(entry.content as Uint8Array);
  const records = readRecords(stream);

  const sst: string[] = [];
  const formats = new Map<number, string>();
  const xfFormat: number[] = [];
  const sheetOffsets: number[] = [];
  for (const r of records) {
    if (r.offset > 0 && r.type === 0x0809) break; // 통합 문서 영역 끝 (첫 시트 BOF)
    if (r.type === 0x00fc) readSst(r, sst);
    else if (r.type === 0x041e) formats.set(r.data.readUInt16LE(0), readString(r.data, 2, 2).text);
    else if (r.type === 0x00e0) xfFormat.push(r.data.readUInt16LE(2));
    else if (r.type === 0x0085) sheetOffsets.push(r.data.readUInt32LE(0));
  }
  if (!sheetOffsets.length) return "";

  const isDate = (xf: number) => {
    const fmt = xfFormat[xf];
    if (fmt === undefined) return false;
    if ((fmt >= 14 && fmt <= 22) || (fmt >= 45 && fmt <= 47)) return true;
    const code = formats.get(fmt);
    return !!code && /[ymd]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ""));
  };
  const rows = new Map<number, Map<number, string>>();
  const set = (row: number, col: number, value: string) => {
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row)!.set(col, value);
  };
  const num = (row: number, col: number, xf: number, value: number) =>
    set(row, col, isDate(xf) ? excelDate(value) : String(value));

  let pendingFormula: { row: number; col: number } | null = null;
  for (const r of records) {
    if (r.offset < sheetOffsets[0]) continue;
    const d = r.data;
    if (r.type === 0x000a) break; // 첫 시트 EOF
    switch (r.type) {
      case 0x00fd: set(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? ""); break; // LABELSST
      case 0x0204: set(d.readUInt16LE(0), d.readUInt16LE(2), readString(d, 6, 2).text); break; // LABEL
      case 0x0203: num(d.readUInt16LE(0), d.readUInt16LE(2), d.readUInt16LE(4), d.readDoubleLE(6)); break; // NUMBER
      case 0x027e: num(d.readUInt16LE(0), d.readUInt16LE(2), d.readUInt16LE(4), rk(d.readInt32LE(6))); break; // RK
      case 0x00bd: { // MULRK
        const row = d.readUInt16LE(0);
        const first = d.readUInt16LE(2);
        const count = (d.length - 6) / 6;
        for (let i = 0; i < count; i++) num(row, first + i, d.readUInt16LE(4 + i * 6), rk(d.readInt32LE(6 + i * 6)));
        break;
      }
      case 0x0006: { // FORMULA: 계산된 값만 쓴다
        const row = d.readUInt16LE(0);
        const col = d.readUInt16LE(2);
        if (d.readUInt16LE(12) !== 0xffff) num(row, col, d.readUInt16LE(4), d.readDoubleLE(6));
        else if (d[6] === 0) pendingFormula = { row, col }; // 문자열 결과는 다음 STRING 레코드에
        else if (d[6] === 1) set(row, col, d[8] ? "TRUE" : "FALSE");
        break;
      }
      case 0x0207: // STRING
        if (pendingFormula) set(pendingFormula.row, pendingFormula.col, readString(d, 0, 2).text);
        pendingFormula = null;
        break;
    }
  }

  const lines: string[] = [];
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const cells = rows.get(row)!;
    const width = Math.max(...cells.keys()) + 1;
    const out: string[] = [];
    for (let c = 0; c < width; c++) out.push(quote(cells.get(c) ?? ""));
    lines.push(out.join(","));
  }
  return lines.join("\n");
}

type Rec = { type: number; offset: number; data: Buffer; continues: Buffer[] };

function readRecords(stream: Buffer): Rec[] {
  const out: Rec[] = [];
  let pos = 0;
  while (pos + 4 <= stream.length) {
    const type = stream.readUInt16LE(pos);
    const len = stream.readUInt16LE(pos + 2);
    const data = stream.subarray(pos + 4, pos + 4 + len);
    if (type === 0x003c && out.length) out[out.length - 1].continues.push(data); // CONTINUE
    else out.push({ type, offset: pos, data, continues: [] });
    pos += 4 + len;
  }
  return out;
}

// SST(공유 문자열 표)는 CONTINUE 레코드로 나뉘어 이어질 수 있고, 문자열 중간에서 끊기면 새 조각 첫 바이트가 글자 폭 표시다.
function readSst(rec: Rec, sst: string[]): void {
  const parts = [rec.data, ...rec.continues];
  let part = 0;
  let pos = 8;
  const unique = rec.data.readUInt32LE(4);
  const ensure = () => {
    while (part < parts.length && pos >= parts[part].length) { part++; pos = 0; }
    if (part >= parts.length) throw new Error("엑셀(xls) 문자열 표가 중간에 끊겼습니다.");
  };
  const byte = () => { ensure(); return parts[part][pos++]; };
  const u16 = () => byte() | (byte() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const skip = (n: number) => { while (n > 0) { ensure(); const k = Math.min(n, parts[part].length - pos); pos += k; n -= k; } };

  for (let i = 0; i < unique; i++) {
    const cch = u16();
    const flags = byte();
    let wide = (flags & 0x01) !== 0;
    const runs = flags & 0x08 ? u16() : 0;
    const ext = flags & 0x04 ? u32() : 0;
    let text = "";
    let left = cch;
    while (left > 0) {
      if (pos >= parts[part].length) { // 글자 도중 조각이 바뀌면 폭 표시 바이트가 다시 온다
        part++; pos = 0;
        if (part >= parts.length) throw new Error("엑셀(xls) 문자열 표가 중간에 끊겼습니다.");
        wide = (parts[part][pos++] & 0x01) !== 0;
      }
      const buf = parts[part];
      const avail = Math.floor((buf.length - pos) / (wide ? 2 : 1));
      const n = Math.min(left, avail);
      text += wide ? buf.toString("utf16le", pos, pos + n * 2) : buf.toString("latin1", pos, pos + n);
      pos += n * (wide ? 2 : 1);
      left -= n;
      if (n === 0) pos = buf.length;
    }
    skip(runs * 4 + ext);
    sst.push(text);
  }
}

function readString(d: Buffer, at: number, lenBytes: 1 | 2): { text: string; end: number } {
  const cch = lenBytes === 2 ? d.readUInt16LE(at) : d[at];
  let pos = at + lenBytes;
  const flags = d[pos++];
  const wide = (flags & 0x01) !== 0;
  if (flags & 0x08) pos += 2;
  if (flags & 0x04) pos += 4;
  const end = pos + cch * (wide ? 2 : 1);
  return { text: wide ? d.toString("utf16le", pos, end) : d.toString("latin1", pos, end), end };
}

function rk(v: number): number {
  const n = v & 0x02 ? v >> 2 : Buffer.from([0, 0, 0, 0, v & 0xfc, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]).readDoubleLE(0);
  return v & 0x01 ? n / 100 : n;
}

function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000); // 1970-01-01 기준
  const iso = new Date(ms).toISOString();
  return iso.slice(11, 16) === "00:00" ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function quote(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
