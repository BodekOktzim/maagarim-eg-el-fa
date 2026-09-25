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

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Prevent spreadsheet formula execution when cells begin with formula markers,
  // including when preceded by whitespace or control characters.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
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
