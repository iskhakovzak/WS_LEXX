import { ArrowDown, ArrowUp, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { SECTION_META, type SectionId } from "./use-dashboard";

/** Reorder / hide dashboard sections. Saved per viewer in localStorage. */
export function CustomizePopover({
  order,
  hidden,
  onChange,
  onReset,
  staff = false,
}: {
  staff?: boolean;
  order: SectionId[];
  hidden: SectionId[];
  onChange: (patch: { order?: SectionId[]; hidden?: SectionId[] }) => void;
  onReset: () => void;
}) {
  // Staff-only blocks are not offered to traders; moving swaps with the nearest visible-in-list neighbour.
  const list = order.filter((id) => staff || !SECTION_META[id].staffOnly);
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const a = order.indexOf(list[idx]);
    const b = order.indexOf(list[j]);
    const next = [...order];
    [next[a], next[b]] = [next[b], next[a]];
    onChange({ order: next });
  };
  const toggle = (id: SectionId, visible: boolean) =>
    onChange({ hidden: visible ? hidden.filter((h) => h !== id) : [...hidden, id] });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label="Настроить дашборд"
          title="Настроить дашборд"
        >
          <SlidersHorizontal aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,340px)] p-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div>
            <p className="text-sm font-semibold">Разделы дашборда</p>
            <p className="text-xs text-muted-foreground">Соседние блоки встают в один ряд. Сохраняется на этом устройстве</p>
          </div>
        </div>
        <ul className="flex flex-col gap-1">
          {list.map((id, idx) => {
            const visible = !hidden.includes(id);
            const meta = SECTION_META[id];
            const switchId = `dash-sec-${id}`;
            return (
              <li key={id} className="flex items-center gap-2 rounded-xl px-1 py-1.5 hover:bg-[var(--glass-hover-bg)]">
                <Switch id={switchId} checked={visible} onCheckedChange={(v) => toggle(id, v)} />
                <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
                  <span className={`block truncate text-sm ${visible ? "" : "text-muted-foreground"}`}>
                    {meta.label}
                  </span>
                  <span className="block truncate text-2xs text-muted-foreground">{meta.hint}</span>
                </label>
                <div className="flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={idx === 0}
                    onClick={() => move(idx, -1)}
                    aria-label={`Поднять «${meta.label}»`}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={idx === list.length - 1}
                    onClick={() => move(idx, 1)}
                    aria-label={`Опустить «${meta.label}»`}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex items-center justify-end gap-2 border-t border-border/60 px-1 pt-2">
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw aria-hidden="true" />
            Вернуть по умолчанию
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
