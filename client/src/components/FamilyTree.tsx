import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { GitBranch, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";

export type TreePerson = {
  id: string;
  nationalId?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  city?: string;
  age?: string;
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

type DetailPlacement = "below" | "left" | "right";

const unique = (values: string[]) => Array.from(new Set(values));

function PersonCard({
  person,
  relation,
  central = false,
  selected = false,
  onClick,
}: {
  person: TreePerson;
  relation: string;
  central?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  const initials = person.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`פתח פרטים עבור ${person.fullName}`}
      className={`family-node group w-[178px] shrink-0 rounded-[19px] border p-3 text-right transition duration-200 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4b91] sm:w-[194px] ${central ? "family-node-central border-[#ff478c]/90 bg-[#371427] shadow-[0_0_35px_rgba(255,53,130,0.3)]" : selected ? "border-[#ff6ba3] bg-[#3b172d]" : "border-[#e7679a]/30 bg-[#23121e]/95 hover:border-[#ff6ba3]/80 hover:bg-[#301526]"}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${central ? "bg-[#ff4b91]/20 text-[#ffb6d3]" : "bg-[#ff4b91]/10 text-[#ffa5c8]"}`}>{relation}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${central ? "bg-[#ff4189] text-white" : "bg-[#ff4b91]/15 text-[#ffc3da]"}`}>{initials || <UserRound size={13}/>}</span>
      </div>
      <p className="truncate text-sm font-semibold text-white">{person.fullName || "ללא שם"}</p>
      <p className="mt-1 truncate font-mono text-[11px] text-white/60">ת״ז: {person.nationalId ?? "לא נמצא"}</p>
      {person.age && <p className="mt-1 text-[11px] text-white/45">גיל במקור: {person.age}</p>}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-[10px] text-white/45">
        <span className="truncate">{person.sourceNames?.join(" · ") || "מקור לא נמצא"}</span>
        <ShieldCheck size={12} className="shrink-0 text-[#7ee3ba]" />
      </div>
    </button>
  );
}

function EmptyNode({ label }: { label: string }) {
  return <div className="flex min-h-[104px] w-[178px] shrink-0 items-center justify-center rounded-[19px] border border-dashed border-white/15 bg-white/[0.025] px-4 text-center text-xs text-white/40 sm:w-[194px]">{label}</div>;
}

function DetailPanel({ person, onClose, onCenter }: { person: TreePerson; onClose: () => void; onCenter: () => void }) {
  const rows = [
    ["תעודת זהות", person.nationalId],
    ["טלפון", person.phone],
    ["יישוב", person.city],
    ["כתובת", person.address],
    ["גיל במקור", person.age],
    ["תאריך לידה", person.birthDate],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <aside className="family-detail-panel min-w-[214px] max-w-[300px] rounded-[18px] border border-[#fa649c]/30 bg-[#281420] p-4 text-right shadow-[0_16px_40px_rgba(0,0,0,0.28)]" aria-label={`פרטים מלאים: ${person.fullName}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#ff8db7]">פרטים מלאים</p><h4 className="mt-1 break-words text-sm font-bold text-white">{person.fullName}</h4></div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white" aria-label="סגור פרטים"><X size={15}/></button>
      </div>
      <dl className="mt-3 space-y-2 border-t border-white/10 pt-3">
        {rows.length ? rows.map(([label, value]) => <div key={label} className="grid grid-cols-[78px_1fr] gap-2 text-xs"><dt className="text-white/45">{label}</dt><dd dir="auto" className="break-words text-white/85">{value}</dd></div>) : <p className="text-xs text-white/45">לא נמצאו פרטים נוספים ברשומות הזמינות.</p>}
      </dl>
      {person.sourceNames?.length ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/10 pt-3">{person.sourceNames.map((source) => <Badge key={source} className="border border-[#f575a2]/20 bg-[#f575a2]/10 text-[10px] text-[#ffc0d8] hover:bg-[#f575a2]/10">{source}</Badge>)}</div> : null}
      <button type="button" onClick={onCenter} className="mt-3 min-h-9 w-full rounded-xl border border-[#ff6ba3]/25 bg-[#ff4b91]/10 px-3 text-xs font-semibold text-[#ffc0d8] transition hover:bg-[#ff4b91]/20">מרכז את העץ באדם זה</button>
    </aside>
  );
}

function PeopleGroup({
  ids,
  relation,
  personById,
  centralId,
  selectedId,
  onSelect,
  onCenter,
  onClose,
  emptyLabel,
  central = false,
}: {
  ids: string[];
  relation: string;
  personById: Map<string, TreePerson>;
  centralId?: string;
  selectedId: string | null;
  onSelect: (id: string, placement: DetailPlacement) => void;
  onCenter: (id: string) => void;
  onClose: () => void;
  emptyLabel: string;
  central?: boolean;
}) {
  const people = unique(ids).map((id) => personById.get(id)).filter((person): person is TreePerson => Boolean(person));
  const selectedIndex = people.findIndex((person) => person.id === selectedId);
  const selectedPerson = selectedIndex >= 0 ? people[selectedIndex] : null;
  const sideLayout = people.length === 2 && Boolean(selectedPerson);

  if (!people.length) return <EmptyNode label={emptyLabel} />;

  if (sideLayout && selectedPerson) {
    // In this RTL layout the first card is physically on the right; its detail panel opens to its right.
    const rightPerson = people[0];
    const leftPerson = people[1];
    const detailOnRight = selectedPerson.id === rightPerson.id;
    return (
      <div className="family-pair-detail-grid" dir="ltr">
        {detailOnRight ? <PersonCard person={leftPerson} relation={relation} selected={false} onClick={() => onSelect(leftPerson.id, "left")}/> : null}
        {detailOnRight ? <PersonCard person={rightPerson} relation={relation} selected onClick={() => onSelect(rightPerson.id, "right")}/> : null}
        {detailOnRight ? <DetailPanel person={selectedPerson} onClose={onClose} onCenter={() => onCenter(selectedPerson.id)}/> : null}
        {!detailOnRight ? <DetailPanel person={selectedPerson} onClose={onClose} onCenter={() => onCenter(selectedPerson.id)}/> : null}
        {!detailOnRight ? <PersonCard person={leftPerson} relation={relation} selected onClick={() => onSelect(leftPerson.id, "left")}/> : null}
        {!detailOnRight ? <PersonCard person={rightPerson} relation={relation} selected={false} onClick={() => onSelect(rightPerson.id, "right")}/> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-center gap-3">
      {people.map((person, index) => <PersonCard
        key={person.id}
        person={person}
        relation={person.id === centralId ? "האדם המרכזי" : relation}
        central={central && person.id === centralId}
        selected={selectedId === person.id}
        onClick={() => onSelect(person.id, people.length <= 2 ? (index === 0 ? "right" : "left") : "below")}
      />)}
      {selectedPerson && <div className="basis-full"><div className="mx-auto mt-1 max-w-[440px]"><DetailPanel person={selectedPerson} onClose={onClose} onCenter={() => onCenter(selectedPerson.id)}/></div></div>}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="tree-caption">{children}</div>;
}

export default function FamilyTree({ data, centralId, onSelect }: FamilyTreeProps) {
  const [detail, setDetail] = useState<{ id: string; placement: DetailPlacement } | null>(null);
  useEffect(() => setDetail(null), [centralId]);
  const personById = useMemo(() => new Map(data.people.map((person) => [person.id, person])), [data.people]);
  const central = personById.get(centralId);
  const relationships = data.relationships;
  const adjacency = useMemo(() => {
    const parents = new Map<string, { id: string; field?: string }[]>();
    const children = new Map<string, string[]>();
    const siblings = new Map<string, string[]>();
    for (const relationship of relationships) {
      if (relationship.type === "PARENT") {
        const list = parents.get(relationship.personAId) ?? [];
        list.push({ id: relationship.personBId, field: String(relationship.evidence?.field ?? "") || undefined });
        parents.set(relationship.personAId, list);
        const childList = children.get(relationship.personBId) ?? [];
        childList.push(relationship.personAId);
        children.set(relationship.personBId, childList);
      }
      if (relationship.type === "CHILD") {
        const list = children.get(relationship.personAId) ?? [];
        list.push(relationship.personBId);
        children.set(relationship.personAId, list);
      }
      if (relationship.type === "SIBLING") {
        const fromA = siblings.get(relationship.personAId) ?? [];
        fromA.push(relationship.personBId);
        siblings.set(relationship.personAId, fromA);
        const fromB = siblings.get(relationship.personBId) ?? [];
        fromB.push(relationship.personAId);
        siblings.set(relationship.personBId, fromB);
      }
    }
    return { parents, children, siblings };
  }, [relationships]);

  const family = useMemo(() => {
    const parentLinks = adjacency.parents.get(centralId) ?? [];
    const fatherId = parentLinks.find((link) => link.field === "father")?.id ?? parentLinks[0]?.id;
    const motherId = parentLinks.find((link) => link.field === "mother")?.id ?? parentLinks[1]?.id;
    const parentIds = unique([fatherId, motherId].filter((id): id is string => Boolean(id)));
    const siblingIds = unique(adjacency.siblings.get(centralId) ?? []);
    const childIds = unique(adjacency.children.get(centralId) ?? []);
    const coParentIds = unique(childIds.flatMap((childId) => (adjacency.parents.get(childId) ?? []).map((link) => link.id)).filter((id) => id !== centralId));
    const paternalGrandparents = fatherId ? unique((adjacency.parents.get(fatherId) ?? []).map((link) => link.id)) : [];
    const maternalGrandparents = motherId ? unique((adjacency.parents.get(motherId) ?? []).map((link) => link.id)) : [];
    const paternalAuntsUncles = fatherId ? unique(adjacency.siblings.get(fatherId) ?? []) : [];
    const maternalAuntsUncles = motherId ? unique(adjacency.siblings.get(motherId) ?? []) : [];
    const paternalCousins = unique(paternalAuntsUncles.flatMap((id) => adjacency.children.get(id) ?? []));
    const maternalCousins = unique(maternalAuntsUncles.flatMap((id) => adjacency.children.get(id) ?? []));
    const paternalGreatGrandparents = unique(paternalGrandparents.flatMap((id) => (adjacency.parents.get(id) ?? []).map((link) => link.id)));
    const maternalGreatGrandparents = unique(maternalGrandparents.flatMap((id) => (adjacency.parents.get(id) ?? []).map((link) => link.id)));
    return { fatherId, motherId, parentIds, siblingIds, childIds, coParentIds, paternalGrandparents, maternalGrandparents, paternalAuntsUncles, maternalAuntsUncles, paternalCousins, maternalCousins, paternalGreatGrandparents, maternalGreatGrandparents };
  }, [adjacency, centralId]);

  const selectPerson = (id: string, placement: DetailPlacement) => {
    setDetail((current) => current?.id === id ? null : { id, placement });
  };
  const closeDetail = () => setDetail(null);

  if (!central) return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center text-sm text-white/60">לא נמצאה רשומה מאומתת לעץ הזה.</div>;

  const renderGroup = (ids: string[], relation: string, emptyLabel: string, opts: { central?: boolean } = {}) => (
    <PeopleGroup ids={ids} relation={relation} personById={personById} centralId={centralId} selectedId={detail?.id ?? null} onSelect={selectPerson} onCenter={onSelect} onClose={closeDetail} emptyLabel={emptyLabel} central={opts.central}/>
  );

  return (
    <section className="family-tree-shell overflow-hidden rounded-[28px] border border-[#f06298]/20 bg-[#150d14] text-white shadow-[0_24px_80px_rgba(21,13,20,0.4)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7">
        <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#ff9fc1]"><GitBranch size={14}/> מפת קשרים משפחתיים</div><p className="mt-1 text-sm text-white/55">לחצו על כרטיס לפרטים; בכרטיס הפרטים אפשר לבחור למרכז את העץ באדם הזה.</p></div>
        <Badge className="border border-emerald-300/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/10"><ShieldCheck size={13} className="ml-1"/> VERIFIED / SOURCE-BACKED</Badge>
      </div>
      <div className="border-b border-[#f06298]/10 bg-[#23121d]/70 px-4 py-3 text-center text-xs text-[#f3bfd1]/65 lg:hidden">לתצוגת העץ הרחבה והנוחה ביותר מומלץ להשתמש במחשב. בטלפון אפשר לגלול לצדדים.</div>
      <div className="tree-scroll overflow-x-auto px-3 py-6 sm:px-6 sm:py-8">
        <div className="tree-stage mx-auto min-w-[1040px] max-w-[1480px] space-y-6" dir="rtl">
          <div className="grid grid-cols-3 gap-5">
            <section className="tree-side-branch space-y-4 rounded-[22px] border border-[#e56a9c]/15 bg-[#e56a9c]/[0.025] p-4">
              <SectionTitle>דור סבים · צד האב</SectionTitle>
              <div className="space-y-3"><p className="text-center text-[10px] text-white/35">סבא וסבתא רבה</p>{renderGroup(family.paternalGreatGrandparents, "סבא/סבתא רבה", "לא נמצאו רשומות מאומתות")}</div>
              <div className="tree-connector"/>
              <div className="space-y-3"><p className="text-center text-[10px] text-white/35">סבא וסבתא</p>{renderGroup(family.paternalGrandparents, "סבא/סבתא", "לא נמצאו רשומות מאומתות")}</div>
            </section>
            <section className="flex flex-col items-center justify-center gap-4 rounded-[22px] border border-[#ff4b91]/20 bg-[#ff4b91]/[0.035] p-4">
              <SectionTitle>דור ההורים</SectionTitle>
              <div className="tree-connector" />
              <p className="max-w-[220px] text-center text-xs leading-6 text-white/40">ההורים והדודים מוצגים יחד בשורה שמתחת</p>
            </section>
            <section className="tree-side-branch space-y-4 rounded-[22px] border border-[#e56a9c]/15 bg-[#e56a9c]/[0.025] p-4">
              <SectionTitle>דור סבים · צד האם</SectionTitle>
              <div className="space-y-3"><p className="text-center text-[10px] text-white/35">סבא וסבתא רבה</p>{renderGroup(family.maternalGreatGrandparents, "סבא/סבתא רבה", "לא נמצאו רשומות מאומתות")}</div>
              <div className="tree-connector"/>
              <div className="space-y-3"><p className="text-center text-[10px] text-white/35">סבא וסבתא</p>{renderGroup(family.maternalGrandparents, "סבא/סבתא", "לא נמצאו רשומות מאומתות")}</div>
            </section>
          </div>

          <div className="grid grid-cols-3 items-stretch gap-5">
            <section className="tree-side-branch flex flex-col gap-4 rounded-[22px] border border-[#e56a9c]/15 bg-[#e56a9c]/[0.025] p-4">
              <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[#ffa2c3]"><UsersRound size={14}/> דודים ודודות · צד האב</div>
              {renderGroup(family.paternalAuntsUncles, "דוד/ה", "אין רשומת אח/ות להורה")}
            </section>
            <section className="flex flex-col items-center justify-center gap-4 rounded-[22px] border border-[#ff4b91]/30 bg-[#2b1420]/70 p-4">
              <SectionTitle>הורים</SectionTitle>
              {renderGroup(family.parentIds, "הורה", "לא נמצאה רשומת הורה")}
            </section>
            <section className="tree-side-branch flex flex-col gap-4 rounded-[22px] border border-[#e56a9c]/15 bg-[#e56a9c]/[0.025] p-4">
              <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[#ffa2c3]"><UsersRound size={14}/> דודים ודודות · צד האם</div>
              {renderGroup(family.maternalAuntsUncles, "דוד/ה", "אין רשומת אח/ות להורה")}
            </section>
          </div>

          <div className="tree-connector"/>
          <section className="space-y-4 rounded-[24px] border border-[#ff4b91]/30 bg-[#28121e]/75 p-4 sm:p-6">
            <SectionTitle>האדם המרכזי · אחים ואחיות</SectionTitle>
            <div className="flex flex-wrap items-start justify-center gap-4">
              {renderGroup([...family.siblingIds, centralId], "אח/ות", "אין רשומות נוספות", { central: true })}
            </div>
          </section>

          <div className="grid grid-cols-3 gap-5">
            <section className="tree-side-branch space-y-4 rounded-[22px] border border-[#e56a9c]/15 bg-[#e56a9c]/[0.025] p-4">
              <SectionTitle>בני ובנות דודים · צד האב</SectionTitle>{renderGroup(family.paternalCousins, "בן/בת דוד", "לא נמצאו רשומות מתועדות")}
            </section>
            <section className="space-y-4 rounded-[22px] border border-[#ff4b91]/20 bg-[#ff4b91]/[0.025] p-4">
              <SectionTitle>ילדים</SectionTitle>{renderGroup(family.childIds, "ילד/ה", "לא נמצאה רשומת ילד")}
              {family.coParentIds.length > 0 && <div className="border-t border-white/10 pt-4"><p className="mb-3 text-center text-[10px] text-white/40">הורה נוסף/ת לילדים</p>{renderGroup(family.coParentIds, "הורה נוסף/ת", "")}</div>}
            </section>
            <section className="tree-side-branch space-y-4 rounded-[22px] border border-[#e56a9c]/15 bg-[#e56a9c]/[0.025] p-4">
              <SectionTitle>בני ובנות דודים · צד האם</SectionTitle>{renderGroup(family.maternalCousins, "בן/בת דוד", "לא נמצאו רשומות מתועדות")}
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
