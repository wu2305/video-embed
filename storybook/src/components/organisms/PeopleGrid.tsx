import { useState } from "react";
import type { Person } from "../../types";
import { Chip } from "../atoms/Chip";
import { PersonCard } from "../molecules/PersonCard";
import { useI18n } from "../../i18n";

export interface PeopleGridProps {
  people: readonly Person[];
  samples?: Readonly<Record<string, string>>;
  selectedId?: string | null;
  onOpen?: (person: Person) => void;
}

type Filter = "all" | "unnamed" | "named";

/** Every person cluster, largest first, with a named/unnamed filter. */
export function PeopleGrid({ people, samples = {}, selectedId = null, onOpen }: PeopleGridProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const unnamed = people.filter((p) => !p.name).length;
  const shown = [...people]
    .filter((p) => filter === "all" || (filter === "named" ? p.name : !p.name))
    .sort((a, b) => b.faces - a.faces);

  return (
    <section aria-label={t("people.label")}>
      <div className="mm-toolbar" style={{ marginBottom: 14 }}>
        <div className="mm-chips" role="group" aria-label={t("people.filter")}>
          {(["all", "unnamed", "named"] as const).map((f) => (
            <Chip key={f} pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "unnamed" ? `unnamed (${unnamed})` : f}
            </Chip>
          ))}
        </div>
        <span className="mm-mono">{people.length} clusters · {people.length - unnamed} named</span>
      </div>
      {shown.length === 0 ? (
        <p className="mm-empty">{filter === "unnamed" ? t("people.allNamed") : t("people.none")}</p>
      ) : (
        <div className="mm-grid" style={{ ["--card-min" as string]: "160px" }}>
          {shown.map((p) => (
            <PersonCard key={p.id} person={p} sampleSrc={samples[p.id]} selected={p.id === selectedId} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}
