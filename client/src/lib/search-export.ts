import type { SearchHit } from "@/lib/full-dataset-search";

export type SearchExportPerson = {
  id: string;
  fullName: string;
  nationalId?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  birthDate?: string | null;
  sourceNames?: string[];
};

export type SearchExportRelationship = {
  personAId: string;
  personBId: string;
  type: string;
  evidence?: unknown;
  source?: string;
};

export const SEARCH_EXPORT_FORMATS = [
  { id: "csv", label: "CSV — Excel / Google Sheets", extension: "csv", mime: "text/csv;charset=utf-8" },
  { id: "tsv", label: "TSV — טבלה מופרדת בטאבים", extension: "tsv", mime: "text/tab-separated-values;charset=utf-8" },
  { id: "json", label: "JSON — נתונים מובנים", extension: "json", mime: "application/json;charset=utf-8" },
  { id: "jsonl", label: "JSONL — רשומה בכל שורה", extension: "jsonl", mime: "application/x-ndjson;charset=utf-8" },
  { id: "txt", label: "TXT — טקסט קריא", extension: "txt", mime: "text/plain;charset=utf-8" },
  { id: "html", label: "HTML — טבלה לפתיחה בדפדפן", extension: "html", mime: "text/html;charset=utf-8" },
  { id: "xml", label: "XML — נתונים מובְנים", extension: "xml", mime: "application/xml;charset=utf-8" },
  { id: "xlsx", label: "XLSX — חוברת Excel", extension: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
] as const;

export type SearchExportFormat = typeof SEARCH_EXPORT_FORMATS[number]["id"];
export type SearchExportRow = Record<string, string>;

const SEARCH_RESULT_COLUMNS = [
  "שם מלא", "תעודת זהות", "מזהה Facebook", "טלפון", "שנת טלפון", "כתובת", "שנת כתובת",
  "כתובת קודמת", "שנת כתובת קודמת", "יישוב", "קוד יישוב", "תאריך לידה", "גיל",
  "מצב אישי", "אב", "אם", "בן/בת זוג", "מקורות", "סוג התאמה",
];

export function buildSearchResultRows(hits: SearchHit[]): SearchExportRow[] {
  const confidenceLabels: Record<SearchHit["confidence"], string> = {
    "exact-id": "תעודת זהות מדויקת",
    "candidate-id-field": "התאמה אפשרית",
    "phone-match": "טלפון מדויק",
    "facebook-id-match": "מזהה Facebook מדויק",
    "text-match": "התאמת טקסט",
    "approximate-text-match": "התאמה דומה",
  };
  return hits.map((hit) => ({
    "שם מלא": hit.fullName,
    "תעודת זהות": hit.nationalId ?? "",
    "מזהה Facebook": hit.facebookId ?? "",
    "טלפון": hit.phone ?? "",
    "שנת טלפון": hit.phoneYear ?? "",
    "כתובת": hit.address ?? "",
    "שנת כתובת": hit.addressYear ?? "",
    "כתובת קודמת": hit.previousAddress ?? "",
    "שנת כתובת קודמת": hit.previousAddressYear ?? "",
    "יישוב": hit.city ?? "",
    "קוד יישוב": hit.cityCode ?? "",
    "תאריך לידה": hit.birthDate ?? "",
    "גיל": hit.age ?? "",
    "מצב אישי": hit.maritalStatus ?? "",
    "אב": hit.fatherId ?? "",
    "אם": hit.motherId ?? "",
    "בן/בת זוג": hit.spouseId ?? "",
    "מקורות": hit.sourceNames?.join("; ") || hit.source,
    "סוג התאמה": confidenceLabels[hit.confidence],
  }));
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Prevent spreadsheet formula execution when cells begin with formula markers,
  // including when preceded by whitespace or control characters.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function xmlEscape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
  })[character] ?? character);
}

function rowsToDelimited(rows: SearchExportRow[], delimiter: string) {
  const data = rows.length ? rows : [Object.fromEntries(SEARCH_RESULT_COLUMNS.map((column) => [column, ""]))];
  const columns = Object.keys(data[0]);
  return `\uFEFF${[columns, ...data.map((row) => columns.map((column) => row[column] ?? ""))]
    .map((row) => row.map(csvCell).join(delimiter)).join("\r\n")}`;
}

function rowsToHtml(rows: SearchExportRow[]) {
  const columns = SEARCH_RESULT_COLUMNS;
  const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${xmlEscape(row[column])}</td>`).join("")}</tr>`).join("\n");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>תוצאות חיפוש</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#24172d}h1{font-size:1.4rem}p{color:#62596a}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ddd;padding:8px;text-align:right;vertical-align:top}th{background:#f5eaf3;position:sticky;top:0}tr:nth-child(even){background:#faf8fb}@media print{body{margin:0}th{position:static}}</style></head><body><h1>תוצאות חיפוש</h1><p>נוצרו ${rows.length} תוצאות. שמרו על הקובץ — הוא עשוי להכיל מידע אישי.</p><table><thead><tr>${columns.map((column) => `<th>${xmlEscape(column)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function rowsToXml(rows: SearchExportRow[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<searchResults count="${rows.length}">\n${rows.map((row) => `<result>\n${Object.entries(row).map(([key, value]) => `<field name="${xmlEscape(key)}">${xmlEscape(value)}</field>`).join("\n")}\n</result>`).join("\n")}\n</searchResults>`;
}

export async function createSearchExportBlob(rows: SearchExportRow[], format: SearchExportFormat): Promise<Blob> {
  const metadata = SEARCH_EXPORT_FORMATS.find((item) => item.id === format)!;
  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [Object.fromEntries(SEARCH_RESULT_COLUMNS.map((column) => [column, ""]))]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "תוצאות חיפוש");
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    return new Blob([buffer], { type: metadata.mime });
  }

  let content: string;
  switch (format) {
    case "csv": content = rowsToDelimited(rows, ","); break;
    case "tsv": content = rowsToDelimited(rows, "\t"); break;
    case "json": content = JSON.stringify(rows, null, 2); break;
    case "jsonl": content = rows.map((row) => JSON.stringify(row)).join("\n"); break;
    case "txt": content = rows.map((row, index) => `תוצאה ${index + 1}\n${Object.entries(row).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join("\n")}`).join("\n\n────────────────────────\n\n"); break;
    case "html": content = rowsToHtml(rows); break;
    case "xml": content = rowsToXml(rows); break;
  }
  return new Blob([content], { type: metadata.mime });
}

export function buildSearchResultsCsv(
  searchResults: SearchExportPerson[],
  familyPeople: SearchExportPerson[] = [],
  relationships: SearchExportRelationship[] = [],
  centralPersonId?: string,
): string {
  const rows: unknown[][] = [[
    "סוג שורה",
    "שם",
    "תעודת זהות",
    "טלפון",
    "כתובת",
    "עיר",
    "תאריך לידה",
    "מקורות",
    "קשר",
    "אדם קשור",
    "ראיה / מקור",
  ]];

  for (const person of searchResults) {
    rows.push([
      "תוצאת חיפוש",
      person.fullName,
      person.nationalId,
      person.phone,
      person.address,
      person.city,
      person.birthDate,
      person.sourceNames?.join("; "),
      "",
      "",
      "",
    ]);
  }

  const peopleById = new Map(familyPeople.map((person) => [person.id, person]));
  for (const relationship of relationships) {
    const personA = peopleById.get(relationship.personAId);
    const personB = peopleById.get(relationship.personBId);
    if (!personA || !personB) continue;

    let label = relationship.type;
    if (relationship.type === "SIBLING") label = "אח/ות";
    if (relationship.type === "PARENT") {
      label = relationship.personAId === centralPersonId
        ? "הורה של האדם המרכזי"
        : relationship.personBId === centralPersonId
          ? "ילד/ה של האדם המרכזי"
          : "קשר הורה–ילד מתועד";
    }

    rows.push([
      "קשר משפחתי",
      personA.fullName,
      personA.nationalId,
      personA.phone,
      personA.address,
      personA.city,
      personA.birthDate,
      personA.sourceNames?.join("; "),
      label,
      personB.fullName,
      [relationship.source, relationship.evidence ? JSON.stringify(relationship.evidence) : ""]
        .filter(Boolean)
        .join(" · "),
    ]);
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
