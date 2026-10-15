import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional glyph shown above the label. Decorative: the label names the segment. */
  icon?: ReactNode;
}

/**
 * The one segmented control for mutually exclusive choices in a panel: ONE row of equal segments (view mode, size ...).
 * Pressed state is `aria-pressed`; Left and Right move focus between segments, Up and Down step to the neighbouring
 * segmented row of the same settings card (so a 2-segment row is not skipped by the geometric search in favour of a
 * 3-segment row whose centres line up better), and leave the row at the first and last. Styling is the shared `.tv-filter-choice-grid` / `.tv-segmented` rules.
 */
/**
 * Index of the segment, in the row one step up or down, whose centre is nearest `centreX`; null when there is no such row.
 * `rows` holds the segment centres of every segmented row of the card, top to bottom.
 */
export function nearestSegmentInNeighbourRow(rows: readonly number[][], rowIndex: number, centreX: number, delta: 1 | -1): { row: number; segment: number } | null {
  const row = rowIndex + delta;
  const centres = rows[row];
  if (!centres?.length) return null;
  const distances = centres.map((c) => Math.abs(c - centreX));
  return { row, segment: distances.indexOf(Math.min(...distances)) };
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  function stepRow(event: KeyboardEvent<HTMLDivElement>) {
    const card = rowRef.current?.closest(".settings-card");
    const active = document.activeElement as HTMLElement | null;
    if (!card || !rowRef.current || !active) return;
    const rows = [...card.querySelectorAll<HTMLElement>(".tv-segmented")];
    const centreOf = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.left + r.width / 2;
    };
    const target = nearestSegmentInNeighbourRow(
      rows.map((row) => [...row.querySelectorAll("button")].map(centreOf)),
      rows.indexOf(rowRef.current),
      centreOf(active),
      event.key === "ArrowDown" ? 1 : -1,
    );
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    rows[target.row]?.querySelectorAll("button")[target.segment]?.focus();
  }

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") return stepRow(event);
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = [...(rowRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next = buttons[index + (event.key === "ArrowRight" ? 1 : -1)];
    // At either end focus stays put; it never wraps and never leaves the row sideways.
    event.preventDefault();
    event.stopPropagation();
    next?.focus();
  }

  return (
    <div
      ref={rowRef}
      className={`tv-filter-choice-grid tv-segmented${className ? ` ${className}` : ""}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={move}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.icon}
          <strong>{option.label}</strong>
        </button>
      ))}
    </div>
  );
}
