import type { ReactNode } from "react";
import { SkeletonBlock, SkeletonLines } from "./Skeleton";

/**
 * The shared skeleton set (owner ruling, 8 October 2026: every page loads with skeletons, never with a centred loading
 * screen). It reuses the Calendar's shimmer block, so the pulse, tokens and both themes are the same everywhere. Skeletons
 * sit inside the normal page frame (the header and Back stay up), mimic the final layout's geometry so nothing jumps when
 * data arrives, and are never focusable: they are `aria-hidden` blocks inside one polite status region.
 */
export type SkeletonKind = "grid" | "rails" | "detail" | "rows" | "settings";

/**
 * One card placeholder (also the single extra row a library shows while it loads more). It wears the loaded card's own
 * classes, so its art ratio, radius and caption line box come from the card CSS and cannot drift from it (the kind label hangs out of flow, so only the title line is drawn).
 */
export function SkeletonCard({ variant = "title" }: { variant?: "title" | "search" }) {
  const card = variant === "search" ? "tv-search-result" : "tv-title-card";
  return (
    <div className={`media-card ${card} is-skeleton skeleton-card`}>
      <span className={`${card}-art skeleton-card-art`}>
        <SkeletonBlock width="100%" height="100%" />
      </span>
      <span className={`${card}-copy`}>
        <strong className="skeleton skeleton-text-line">{"\u00a0"}</strong>
      </span>
    </div>
  );
}

/** A poster or thumbnail grid (Library, Playlists, Folders, Search results). Search lays out on its real grid. */
export function SkeletonGrid({ count = 12, variant = "title" }: { count?: number; variant?: "title" | "search" }) {
  return (
    <div
      className={variant === "search" ? "tv-search-results-grid tv-search-rail-grid" : "skeleton-set skeleton-grid-set"}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} variant={variant} />
      ))}
    </div>
  );
}

/** Horizontal rails with their titles (Home, playlist detail, title tracks). */
export function SkeletonRails({ rails = 3, cards = 6 }: { rails?: number; cards?: number }) {
  return (
    <div className="skeleton-set skeleton-rails-set" aria-hidden="true">
      {Array.from({ length: rails }, (_, r) => (
        <div className="skeleton-rail" key={r}>
          <SkeletonBlock height="1.1rem" width="14rem" />
          <div className="skeleton-rail-row">
            {Array.from({ length: cards }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The detail hero (kicker, title, meta, synopsis, buttons) and its first track. */
export function SkeletonDetail() {
  return (
    <div className="skeleton-set skeleton-detail-set" aria-hidden="true">
      <div className="skeleton-detail-copy">
        <SkeletonBlock height="0.8rem" width="8rem" />
        <SkeletonBlock height="3.4rem" width="min(24rem, 90%)" />
        <SkeletonBlock height="3.4rem" width="min(16rem, 60%)" />
        <SkeletonBlock height="0.9rem" width="14rem" />
        <SkeletonLines count={3} />
        <div className="skeleton-detail-actions">
          <SkeletonBlock height="3rem" width="8rem" style={{ borderRadius: 999 }} />
          <SkeletonBlock height="3rem" width="9rem" style={{ borderRadius: 999 }} />
        </div>
      </div>
      <SkeletonRails rails={1} cards={5} />
    </div>
  );
}

/** List rows (Downloads, Watchlist, Requests). */
export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-set skeleton-rows-set" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <SkeletonBlock className="skeleton-row-thumb" />
          <div className="skeleton-row-copy">
            <SkeletonBlock height="0.9rem" width="46%" />
            <SkeletonBlock height="0.65rem" width="28%" />
          </div>
          <SkeletonBlock height="2.2rem" width="6rem" style={{ borderRadius: 999 }} />
        </div>
      ))}
    </div>
  );
}

/** Settings option rows (a label and its control). */
export function SkeletonSettings({ count = 5 }: { count?: number }) {
  return (
    <div className="skeleton-set skeleton-settings-set" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-settings-row" key={i}>
          <div className="skeleton-row-copy">
            <SkeletonBlock height="0.9rem" width="34%" />
            <SkeletonBlock height="0.65rem" width="58%" />
          </div>
          <SkeletonBlock height="2.4rem" width="9rem" style={{ borderRadius: 12 }} />
        </div>
      ))}
    </div>
  );
}

/** One skeleton inside a polite status region. `label` is announced, never drawn. */
export function SkeletonState({
  kind,
  label,
  compact = false,
  cards,
}: {
  kind: SkeletonKind;
  label: string;
  compact?: boolean;
  cards?: "title" | "search";
}) {
  const set: Record<SkeletonKind, ReactNode> = {
    grid: <SkeletonGrid variant={cards} />,
    rails: <SkeletonRails />,
    detail: <SkeletonDetail />,
    rows: <SkeletonRows />,
    settings: <SkeletonSettings />,
  };
  return (
    <div className={`skeleton-state is-${kind}${compact ? " is-compact" : ""}`} role="status" aria-busy="true" aria-label={label}>
      {set[kind]}
    </div>
  );
}
