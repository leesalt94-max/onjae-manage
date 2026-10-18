import Papa from "papaparse";

export type Row = Record<string, string>;

// 헤더 비교용: 소문자, 공백·기호 정리. "# of adults" / "Number of Adults" 같은 변형을 흡수한다.
export function normKey(key: string): string {
  return key
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/[#()%'’:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCsv(text: string): Row[] {
  const result = Papa.parse<Row>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normKey,
    transform: (v) => v.trim(),
  });
  return result.data;
}

export function pick(row: Row, aliases: string[]): string | null {
  for (const alias of aliases) {
    const v = row[normKey(alias)];
    if (v !== undefined && v !== "") return v;
  }
  return null;
}

export function headerMatches(rows: Row[], aliases: string[]): boolean {
  const first = rows[0];
  if (!first) return false;
  return aliases.some((a) => normKey(a) in first);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (!(y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

// 플랫폼마다 날짜 표기가 달라 흔한 형식을 모두 받는다. 슬래시 형식은 미국식(월/일/연)으로 본다.
export function parseDate(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  let m = v.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return iso(+m[3], +m[1], +m[2]);
  m = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? iso(+m[3], month, +m[1]) : null;
  }
  m = v.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? iso(+m[3], month, +m[2]) : null;
  }
  return null;
}

const SYMBOLS: [RegExp, string][] = [
  [/₩|krw|원/i, "KRW"],
  [/us\$|usd|\$/i, "USD"],
  [/€|eur/i, "EUR"],
  [/¥|cny|rmb|元/i, "CNY"],
  [/jpy|円/i, "JPY"],
];

export function detectCurrency(value: string | null): string | null {
  if (!value) return null;
  for (const [re, code] of SYMBOLS) if (re.test(value)) return code;
  return null;
}

// "₩123,456", "1,234.56 USD", "1.234,56" 등을 숫자로. 빈 값은 null.
export function parseAmount(value: string | null): number | null {
  if (!value) return null;
  let v = value.replace(/[^\d.,\-]/g, "");
  if (!/\d/.test(v)) return null;
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // 둘 다 있으면 뒤에 오는 것이 소수점
    v = lastComma > lastDot ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (lastComma > -1) {
    // 쉼표만 있으면: 뒤가 정확히 3자리면 천 단위 구분, 아니면 소수점
    v = /,\d{3}$/.test(v) ? v.replace(/,/g, "") : v.replace(",", ".");
  }
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// 사장님 결정(2026-10-18): 게스트 정보는 성별·인원수·나이만 모은다.
// 그래서 원본 행을 보관할 때 이름·연락처·주소·국적 같은 칸은 지운다.
const PERSONAL = /name|guest$|guest\W+s\b|booked by|remarks|request|details|비고|요청|phone|contact|e-?mail|address|country|national|이름|게스트|투숙객|전화|연락처|이메일|주소|국가|국적|入住人|国籍|电话|联系人/i;

export function stripPersonal(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !PERSONAL.test(k)));
}

export function parseIntOrNull(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
}
