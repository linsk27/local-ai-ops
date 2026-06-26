import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type FilterOption = {
  value: string;
  label: string;
  badge?: number | string;
};

export type FilterToolbarFilter = {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

type FilterToolbarProps = {
  ariaLabel: string;
  searchLabel: string;
  clearSearchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  filters: FilterToolbarFilter[];
  resetLabel: string;
  resetDisabled: boolean;
  onReset: () => void;
  className?: string;
};

export function FilterToolbar({
  ariaLabel,
  searchLabel,
  clearSearchLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  filters,
  resetLabel,
  resetDisabled,
  onReset,
  className
}: FilterToolbarProps): JSX.Element {
  return (
    <div className={["filter-toolbar", className].filter(Boolean).join(" ")} role="search" aria-label={ariaLabel}>
      <label className="filter-search-control">
        <Search aria-hidden="true" />
        <input
          type="search"
          aria-label={searchLabel}
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
        />
        {searchValue ? (
          <button
            type="button"
            className="filter-search-clear"
            onClick={() => onSearchChange("")}
            aria-label={clearSearchLabel}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </label>
      <div className="filter-toolbar-controls">
        {filters.map((filter) => (
          <FilterSelect key={filter.id} filter={filter} />
        ))}
        <button type="button" className="filter-toolbar-reset" disabled={resetDisabled} onClick={onReset}>
          {resetLabel}
        </button>
      </div>
    </div>
  );
}

function FilterSelect({ filter }: { filter: FilterToolbarFilter }): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();
  const selectedOption = useMemo(
    () => filter.options.find((option) => option.value === filter.value) ?? filter.options[0],
    [filter.options, filter.value]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={open ? "filter-select is-open" : "filter-select"} ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="filter-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={filter.disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="filter-select-label">{filter.label}</span>
        <span className="filter-select-value">{selectedOption?.label ?? filter.value}</span>
        <ChevronDown className="filter-select-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="filter-select-menu" id={listboxId} role="listbox" aria-label={filter.label}>
          {filter.options.map((option) => {
            const selected = option.value === filter.value;
            return (
              <button
                type="button"
                key={option.value}
                role="option"
                aria-selected={selected}
                className={selected ? "filter-select-option is-selected" : "filter-select-option"}
                onClick={() => {
                  filter.onChange(option.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span>{option.label}</span>
                {option.badge !== undefined ? <span className="filter-select-badge">{option.badge}</span> : null}
                {selected ? <Check aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
