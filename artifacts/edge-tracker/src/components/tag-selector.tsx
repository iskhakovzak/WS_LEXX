import { useState } from "react";
import { TRADE_TAGS, type TagCategory } from "@/lib/tags";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronUp } from "lucide-react";

interface TagSelectorProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
}

export function TagSelector({ selectedTags, onChange }: TagSelectorProps) {
  const [expanded, setExpanded] = useState<TagCategory | null>(null);

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onChange(selectedTags.filter((t) => t !== tag));
    } else {
      onChange([...selectedTags, tag]);
    }
  };

  return (
    <div className="space-y-2">
      {(Object.entries(TRADE_TAGS) as Array<[TagCategory, any]>).map(([key, category]) => (
        <div key={key} className="border border-border rounded-none bg-background">
          <button
            type="button"
            onClick={() => setExpanded(expanded === key ? null : key)}
            className="w-full px-3 py-2 flex items-center justify-between hover:bg-muted/40 transition-colors"
          >
            <span className="text-xs font-mono uppercase font-semibold text-muted-foreground">
              {category.name}
            </span>
            {expanded === key ? (
              <ChevronUp className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            )}
          </button>

          {expanded === key && (
            <div className="px-3 py-2 border-t border-border grid grid-cols-2 sm:grid-cols-3 gap-2">
              {category.tags.map((tag) => (
                <label
                  key={tag}
                  className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <Checkbox
                    checked={selectedTags.includes(tag)}
                    onCheckedChange={() => toggleTag(tag)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs font-mono text-muted-foreground hover:text-foreground">
                    {tag}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}

      {selectedTags.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground uppercase mb-2">Выбранные теги:</div>
          <div className="flex flex-wrap gap-1">
            {selectedTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="px-2 py-1 text-[10px] font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors rounded-none flex items-center gap-1"
              >
                {tag}
                <span className="text-primary/60 text-xs">×</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
