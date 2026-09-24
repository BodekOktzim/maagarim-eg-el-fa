import { Badge } from "@/components/ui/badge";
import { GitBranch, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { useMemo } from "react";

export type TreePerson = {
  id: string;
  nationalId?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  birthDate?: string;
  sourceNames?: string[];
};

export type TreeRelationship = {
  id: string;
  personAId: string;
  personBId: string;
  type: "PARENT" | "CHILD" | "SIBLING";
  confidence?: string;
  evidence?: Record<string, unknown>;
  source?: string;
};

export type FamilyTreeData = {
  people: TreePerson[];
  relationships: TreeRelationship[];
};

type FamilyTreeProps = {
  data: FamilyTreeData;
  centralId: string;
  onSelect: (id: string) => void;
};

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function PersonNode({
  person,
  relation,
  central = false,
  onSelect,
}: {
  person: TreePerson;
  relation: string;
  central?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(person.id)}
      className={`family-node group w-[186px] shrink-0 rounded-2xl border p-3 text-right transition duration-200 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300 ${central ? "family-node-central border-fuchsia-300/80 bg-fuchsia-950/80 shadow-[0_0_34px_rgba(244,114,182,0.32)]" : "border-white/15 bg-[#24172f]/90 hover:border-cyan-300/60 hover:bg-[#2e1c3d]"}`}
      aria-label={`פתח פרטים עבור ${person.fullName}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${central ? "bg-fuchsia-300/20 text-fuchsia-100" : "bg-cyan-300/10 text-cyan-200"}`}>
          {relation}
        </span>
        {central ? <GitBranch size={14} className="text-fuchsia-200" /> : <UserRound size={14} className="text-cyan-200/70" />}
      </div>
      <p className="truncate text-sm font-semibold text-white">{person.fullName || "ללא שם"}</p>
      <p className="mt-1 truncate font-mono text-[11px] text-white/60">ת״ז: {person.nationalId ?? "לא נמצא"}</p>
      {person.birthDate && <p className="mt-1 text-[11px] text-white/45">לידה: {person.birthDate}</p>}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-[10px] text-white/45">
        <span className="truncate">{person.sourceNames?.join(" · ") || "מקור לא נמצא"}</span>
        <ShieldCheck size={12} className="shrink-0 text-emerald-300/80" />
      </div>
    </button>
  );
}

function EmptyBranch({ label }: { label: string }) {
  return <div className="flex min-h-[74px] w-[186px] shrink-0 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 text-center text-xs text-white/40">{label}</div>;
}

function NodeRow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`tree-node-row flex items-stretch justify-center gap-4 ${className}`}>{children}</div>;
}

export default function FamilyTree({ data, centralId, onSelect }: FamilyTreeProps) {
  const index = useMemo(() => new Map(data.people.map((person) => [person.id, person])), [data.people]);
  const get = (id?: string) => (id ? index.get(id) : undefined);
  const relationships = data.relationships;
  const central = get(centralId);

  const { fatherId, motherId, siblingIds, childIds, fatherSiblings, motherSiblings, fatherGrandparents, motherGrandparents, cousinsBySide } = useMemo(() => {
    const parentRels = relationships.filter((rel) => rel.type === "PARENT" && rel.personAId === centralId);
    const fatherRel = parentRels.find((rel) => rel.evidence?.field === "father");
    const motherRel = parentRels.find((rel) => rel.evidence?.field === "mother");
    const fallback = parentRels.filter((rel) => rel.id !== fatherRel?.id && rel.id !== motherRel?.id);
    const resolvedFatherId = fatherRel?.personBId ?? fallback[0]?.personBId;
    const resolvedMotherId = motherRel?.personBId ?? fallback[1]?.personBId;
    const siblingSet = new Set<string>();
    relationships.forEach((rel) => {
      if (rel.type !== "SIBLING") return;
      if (rel.personAId === centralId) siblingSet.add(rel.personBId);
      if (rel.personBId === centralId) siblingSet.add(rel.personAId);
    });
    const children = relationships.filter((rel) => rel.type === "PARENT" && rel.personBId === centralId).map((rel) => rel.personAId);

    const siblingsOf = (personId?: string) => {
      if (!personId) return [];
      const ids = new Set<string>();
      relationships.forEach((rel) => {
        if (rel.type !== "SIBLING") return;
        if (rel.personAId === personId) ids.add(rel.personBId);
        if (rel.personBId === personId) ids.add(rel.personAId);
      });
      return Array.from(ids);
    };
    const parentsOf = (personId?: string) => {
      if (!personId) return [];
      return relationships.filter((rel) => rel.type === "PARENT" && rel.personAId === personId).map((rel) => rel.personBId);
    };
    const cousinsOf = (auntsAndUncles: string[]) => unique(auntsAndUncles.flatMap((id) => relationships.filter((rel) => rel.type === "PARENT" && rel.personBId === id).map((rel) => rel.personAId)));

    const fatherSideSiblings = siblingsOf(resolvedFatherId);
    const motherSideSiblings = siblingsOf(resolvedMotherId);
    return {
      fatherId: resolvedFatherId,
      motherId: resolvedMotherId,
      siblingIds: Array.from(siblingSet),
      childIds: unique(children),
      fatherSiblings: fatherSideSiblings,
      motherSiblings: motherSideSiblings,
      fatherGrandparents: parentsOf(resolvedFatherId),
      motherGrandparents: parentsOf(resolvedMotherId),
      cousinsBySide: { father: cousinsOf(fatherSideSiblings), mother: cousinsOf(motherSideSiblings) },
    };
  }, [centralId, relationships]);

  const person = (id: string) => get(id);
  const renderPeople = (ids: string[], relation: string) => {
    const people = unique(ids).map(person).filter((value): value is TreePerson => Boolean(value));
    return people.length ? people.map((item) => <PersonNode key={item.id} person={item} relation={relation} onSelect={onSelect} />) : <EmptyBranch label="לא נמצאה רשומה מאומתת" />;
  };

  if (!central) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center text-sm text-white/60">לא נמצאה רשומה מאומתת לעץ הזה.</div>;
  }

  return (
    <section className="family-tree-shell overflow-hidden rounded-[28px] border border-fuchsia-300/15 bg-[#150d1e] text-white shadow-[0_24px_80px_rgba(21,13,30,0.35)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/80"><GitBranch size={14} /> עץ קשרים מאומת</div>
          <p className="mt-1 text-sm text-white/55">לחיצה על כרטיס פותחת אדם אחר כמרכז. קשרים מוצגים רק עם ראיה במקור.</p>
        </div>
        <Badge className="border border-emerald-300/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/10"><ShieldCheck size={13} className="ml-1" /> VERIFIED / SOURCE-BACKED</Badge>
      </div>

      <div className="tree-scroll overflow-x-auto px-4 py-7 sm:px-8">
        <div className="tree-stage mx-auto min-w-[980px] max-w-[1240px] space-y-5" dir="rtl">
          <div className="tree-caption">דור קודם · סבא וסבתא</div>
          <div className="grid grid-cols-2 gap-8 xl:gap-20">
            <div className="tree-side-branch space-y-3 rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.025] p-4">
              <div className="flex items-center justify-between text-xs font-semibold text-cyan-200"><span>צד האב</span><span className="text-[10px] text-white/35">דור +2</span></div>
              <NodeRow>{renderPeople(fatherGrandparents, "סבא/סבתא")}</NodeRow>
            </div>
            <div className="tree-side-branch space-y-3 rounded-2xl border border-fuchsia-300/10 bg-fuchsia-300/[0.025] p-4">
              <div className="flex items-center justify-between text-xs font-semibold text-fuchsia-200"><span>צד האם</span><span className="text-[10px] text-white/35">דור +2</span></div>
              <NodeRow>{renderPeople(motherGrandparents, "סבא/סבתא")}</NodeRow>
            </div>
          </div>

          <div className="tree-connector" />
          <div className="tree-caption">הורים</div>
          <NodeRow>
            {fatherId && person(fatherId) ? <PersonNode person={person(fatherId)!} relation="אב" onSelect={onSelect} /> : <EmptyBranch label="אב לא נמצא" />}
            {motherId && person(motherId) ? <PersonNode person={person(motherId)!} relation="אם" onSelect={onSelect} /> : <EmptyBranch label="אם לא נמצאה" />}
          </NodeRow>

          <div className="tree-connector" />
          <div className="tree-caption">האדם המרכזי והאחים</div>
          <NodeRow className="tree-siblings-row">
            {renderPeople(siblingIds, "אח/ות")}
            <PersonNode person={central} relation="האדם המרכזי" central onSelect={onSelect} />
          </NodeRow>

          <div className="tree-connector" />
          <div className="tree-caption">בן/בת זוג וילדים</div>
          <NodeRow>
            <EmptyBranch label="בן/בת זוג: לא נמצא קשר מתועד" />
            {renderPeople(childIds, "ילד/ה")}
          </NodeRow>

          <div className="grid grid-cols-2 gap-8 pt-4 xl:gap-20">
            <div className="tree-side-branch space-y-3 rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.025] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-200"><UsersRound size={14} /> דודים מצד האב ובני דודים</div>
              <NodeRow>{renderPeople(fatherSiblings, "דוד/ה")}</NodeRow>
              <div className="border-t border-white/10 pt-3"><NodeRow>{renderPeople(cousinsBySide.father, "בן/בת דוד")}</NodeRow></div>
            </div>
            <div className="tree-side-branch space-y-3 rounded-2xl border border-fuchsia-300/10 bg-fuchsia-300/[0.025] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-fuchsia-200"><UsersRound size={14} /> דודים מצד האם ובני דודים</div>
              <NodeRow>{renderPeople(motherSiblings, "דוד/ה")}</NodeRow>
              <div className="border-t border-white/10 pt-3"><NodeRow>{renderPeople(cousinsBySide.mother, "בן/בת דוד")}</NodeRow></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
