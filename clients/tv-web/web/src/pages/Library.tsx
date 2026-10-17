import { ensureLibraryIndex, registerEnsureLibraryIndex } from "../lib/libraryIndexRegistry";
import { setScrollInstant, smoothScrollIntoView, smoothScrollTo } from "../lib/smoothScroll";
import { useScrollEdges } from "../lib/useScrollEdges";
import { useRemoteMarkerFollow } from "../lib/remoteMarkerFollow";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  describeApiError,
  type CatalogPage,
  type LanguageFacets,
  type WatchProgress,
  type Work,
  type WorkKind,
} from "@playarr-tv/api-client";
import {
  indexWatchProgressByWork,
  WatchStateOverlay,
} from "../components/WatchStateOverlay";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLiveRevision, useLiveSubscription } from "../lib/liveEvents";
import { CachedArtworkImage } from "../lib/artwork";
import {
  libraryChunkRanges,
  sameLibraryChunkItems,
} from "../lib/libraryChunks";
import { whenNavigationIdle } from "../lib/navigationActivity";
import {
  libraryExpandMountedEnd,
  libraryWindowContains,
} from "../lib/focusGeometry";
import {
  isNavigationLayerRestoring,
  useNavigationLayer,
} from "../lib/navigationLayer";
import { rememberWorks } from "../lib/knownWorks";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import {
  formatLanguageParam,
  languageDisplayName,
  parseLanguageParam,
} from "../lib/languageFilters";
import { ListPanel } from "../components/tv/ListPanel";
import { useDwellPrefetch } from "../lib/prefetch";
import { retryTransient } from "../lib/retryTransient";
import { createPreviewStore } from "../lib/previewStore";
import { gridNeighbours } from "../lib/detailNeighbours";
import { useFocusedDetailsController } from "../lib/useFocusedDetails";
import { CrossfadeArt, LibraryPreview } from "../components/LibraryPreview";
import {
  applyLibraryView,
  LEGACY_SIZE_PARAM,
  parseLibraryView,
  rememberLibraryView,
  storedLibraryView,
  LIBRARY_PAGE_SIZE,
  libraryFirstPageKey,
  libraryLoadedKey,
  type LibraryLoadedList,
  libraryImageKinds,
  libraryFirstPageParams,
  type LibraryKind,
  type LibrarySort,
  type LibraryView,
  type SortOrder,
} from "../lib/libraryView";
import { adoptLegacyArtworkSize, useArtworkSize } from "../lib/artworkSize";
import { useCoverflowMotion } from "../lib/libraryCoverflow";
import { usePanelParam } from "../lib/usePanelParam";
import { releaseYear, yearRangeLabel } from "../lib/workYear";
import { FilterSection, FiltersDrawer, LoadingTrail, PageLayout, SkeletonCard, ViewToggle } from "../components/shell";
import { MultiSelect } from "../components/ui";

/** Initial DOM mount for dense grids — enough for a full 4K viewport + headroom. */
const INITIAL_MOUNTED = 48;
/** Idle time after the last remote move before the page's selection (backdrop art, prefetch) settles. */
const SELECT_SETTLE_MS = 140;

/** Rows kept mounted ahead of the settled selection (filled while idle). */
const PREMOUNT_AHEAD_ROWS = 70;
/** Rows above and below the viewport whose artwork is kept loaded. */
const ARTWORK_MARGIN_ROWS = 2;
/** Rows mounted per idle task, and the pause between tasks. */
const PREMOUNT_SLICE_ROWS = 2;
const PREMOUNT_GAP_MS = 24;

/** The next page is requested once fewer than this many pixels of the loaded list remain below (right of) the viewport. */
const LOAD_AHEAD_PX = 1600;
/** Rows mounted below the viewport while the user scrolls by touch or wheel (selection-driven mounting only follows focus). */
const MOUNT_AHEAD_ROWS = 12;

const PAGE_SIZE = LIBRARY_PAGE_SIZE;
const ALPHABET = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"] as const;

/**
 * The letter column: always ONE column of 44px targets. When they do not fit the stage the column scrolls, with the
 * shared soft edge fade at the top and bottom (present from first paint), and the focused letter is scrolled into view
 * smoothly. The highlighted letter follows the grid unless the user is on the rail.
 */
function AlphabetRail({
  alphabet,
  activeLetter,
  jumpingLetter,
  label,
  symbolsLabel,
  refreshKey,
  onJump,
  onEnterGrid,
}: {
  alphabet: readonly string[];
  activeLetter: string;
  jumpingLetter: string | null;
  label: string;
  symbolsLabel: string;
  refreshKey: string;
  onJump: (letter: string) => void;
  onEnterGrid: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useScrollEdges(ref, "vertical", refreshKey);
  // Phones: the letters are shorter than 44px, so the whole column is one control; dragging a finger down it scrubs the letters.
  const scrubbed = useRef<string | null>(null);
  const scrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    const letter = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("button[data-letter]")?.dataset.letter;
    if (!letter || letter === scrubbed.current) return;
    scrubbed.current = letter;
    onJump(letter);
  };
  useEffect(() => {
    const rail = ref.current;
    if (!rail || rail.contains(document.activeElement)) return;
    const active = rail.querySelector<HTMLElement>("button.is-active");
    if (active) smoothScrollIntoView(active, { block: "center" });
  }, [activeLetter, refreshKey]);
  return (
    <nav
      ref={ref}
      className="tv-alphabet"
      aria-label={label}
      onKeyDown={(event) => {
        // Only Right leaves the rail for the grid; a jump never moves focus (owner 2026-10-18).
        if (event.key !== "ArrowRight" || event.defaultPrevented) return;
        event.preventDefault();
        onEnterGrid();
      }}
      onPointerMove={scrub}
      onPointerUp={() => { scrubbed.current = null; }}
      onPointerCancel={() => { scrubbed.current = null; }}
    >
      {alphabet.map((letter) => (
        <button
          key={letter}
          type="button"
          className={activeLetter === letter ? "is-active" : ""}
          data-letter={letter}
          onClick={() => onJump(letter)}
          onFocus={(event) => smoothScrollIntoView(event.currentTarget)}
          aria-current={activeLetter === letter ? "true" : undefined}
          aria-label={letter === "#" ? symbolsLabel : letter}
        >
          <span>{jumpingLetter === letter ? "·" : letter}</span>
        </button>
      ))}
    </nav>
  );
}

function titleLetter(title: string): string {
  const first = title
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .charAt(0)
    .toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

function workLetter(work: Work): string {
  return titleLetter(work.sort_title || work.title);
}

// One collator for every comparison: `localeCompare(..., options)` builds a new
// collator per call, which made re-sorting a few hundred titles when a
// catalogue page arrived a visible main-thread stall on TV-class CPUs.
const TITLE_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function orderWorks(items: Work[], sort: LibrarySort, order: SortOrder): Work[] {
  const direction = order === "asc" ? 1 : -1;
  if (sort === "date_added") {
    const added = new Map(items.map((work) => [work.id, new Date(work.added_at).getTime()]));
    return [...items].sort((a, b) => (added.get(a.id)! - added.get(b.id)!) * direction);
  }
  return [...items].sort(
    (a, b) => TITLE_COLLATOR.compare(a.sort_title || a.title, b.sort_title || b.title) * direction
  );
}

function sameWorkIds(a: Work[] | null, b: Work[]): boolean {
  return a !== null && a.length === b.length && a.every((work, i) => work.id === b[i]!.id);
}

function afterTwoFrames(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

/**
 * Remote-first Movies/Series/Sites/Music library. Titles live in a large, vertically
 * scrolling TV rail; focus reveals the selected title on the left and
 * activation opens its detail page. Playback never starts from this view.
 */
export function LibraryPage({ kind }: { kind: LibraryKind }) {
  const { t, language: uiLanguage } = useLanguage();
  const singular =
    kind === "series"
      ? t("pages.library.singular.series")
      : kind === "site"
        ? t("pages.library.singular.site")
        : kind === "artist"
          ? t("pages.library.singular.artist")
          : t("pages.library.singular.movie");
  const plural =
    kind === "series"
      ? t("pages.library.plural.series")
      : kind === "site"
        ? t("pages.library.plural.sites")
        : kind === "artist"
          ? t("pages.library.plural.music")
          : t("pages.library.plural.movies");
  const routeBase =
    kind === "series"
      ? "/series"
      : kind === "site"
        ? "/sites"
        : kind === "artist"
          ? "/music"
          : "/movies";
  const emptyGraphic =
    kind === "movie" ? "movies" : kind === "artist" ? "music" : "series";
  const collectionNoun =
    kind === "artist" ? t("pages.library.collectionNoun.artists") : t("pages.library.collectionNoun.titles");
  useDocumentTitle(plural);

  const client = useApiClient();
  const [initialError, setInitialError] = useState<string | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [jumpingLetter, setJumpingLetter] = useState<string | null>(null);
  // The open Filters panel lives in the URL (`?panel=filters`) so refresh and deep links restore it.
  const [panel, setPanel] = usePanelParam(["filters"] as const);
  const filtersOpen = panel === "filters";
  const setFiltersOpen = (next: boolean | ((open: boolean) => boolean)) =>
    setPanel((typeof next === "function" ? next(filtersOpen) : next) ? "filters" : null);
  const previousKind = useRef(kind);
  // Audio/subtitle language filters live in the URL (`?audio=en,ja&subs=fr`)
  // so they survive reloads and can be shared or bookmarked.
  const [searchParams, setSearchParams] = useSearchParams();
  // View and sort live in the URL too (`?view=list&sort=date_added&order=desc`);
  // localStorage only supplies the default for a fresh URL with none of them.
  const {
    view,
    sort,
    order,
  } = useMemo(
    () => parseLibraryView(searchParams, kind, storedLibraryView(kind)),
    [kind, searchParams]
  );
  // The artwork size is a global setting (Settings > Appearance). An old `?size=` link is adopted once
  // when nothing is saved yet, then dropped from the URL.
  const { size: artworkSize, setSize: setArtworkSize } = useArtworkSize();
  const legacySize = searchParams.get(LEGACY_SIZE_PARAM);
  useEffect(() => {
    if (legacySize === null) return;
    adoptLegacyArtworkSize(legacySize, setArtworkSize);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(LEGACY_SIZE_PARAM);
        return next;
      },
      { replace: true }
    );
  }, [legacySize, setArtworkSize, setSearchParams]);
  const audioKey = searchParams.get("audio") ?? "";
  const subtitleKey = searchParams.get("subs") ?? "";
  const audioLangs = useMemo(() => parseLanguageParam(audioKey), [audioKey]);
  const subtitleLangs = useMemo(() => parseLanguageParam(subtitleKey), [subtitleKey]);
  const languageParams = useMemo(
    () => ({
      audio_lang: formatLanguageParam(audioLangs),
      subtitle_lang: formatLanguageParam(subtitleLangs),
    }),
    [audioLangs, subtitleLangs]
  );
  // Stale-while-revalidate on the very first render: a stored first page (Back, a revisit, a tab switch) is read
  // here, not in an effect, so the page never paints a skeleton frame before content it already has.
  const [seed] = useState(() => {
    const params = libraryFirstPageParams(kind, sort, order, languageParams);
    // The whole list scrolled through before (Back from a title opened deep in it), else the first page.
    const loaded = client.queries.peek<LibraryLoadedList<Work>>(libraryLoadedKey(params));
    if (loaded) return { items: loaded.data.items, total: loaded.data.total };
    const stored = client.queries.peek<CatalogPage>(libraryFirstPageKey(params));
    if (!stored) return null;
    const ordered = orderWorks(stored.data.items, sort, order);
    return { items: ordered, total: stored.data.total ?? ordered.length };
  });
  const [items, setItems] = useState<Work[] | null>(seed?.items ?? null);
  const [total, setTotal] = useState<number | null>(seed?.total ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(seed?.items[0]?.id ?? null);
  const [refreshing, setRefreshing] = useState(Boolean(seed));
  const [activeLetter, setActiveLetter] = useState(seed?.items[0] ? workLetter(seed.items[0]) : "#");
  // null while the lists load, "error" when they could not be read.
  const [languageFacets, setLanguageFacets] = useState<LanguageFacets | "error" | null>(null);
  const [watchProgress, setWatchProgress] = useState<WatchProgress[] | null>(null);
  // Expand-only virtual mount: grow DOM prefix as focus moves, never shrink.
  const [mountedEnd, setMountedEnd] = useState(INITIAL_MOUNTED);

  const gridRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Work[]>(seed?.items ?? []);
  const totalRef = useRef<number | null>(seed?.total ?? null);
  const requestRef = useRef<Promise<Work[]> | null>(null);
  const generationRef = useRef(0);
  const loadedKindRef = useRef(kind);
  const selectTimerRef = useRef(0);
  const previewStore = useMemo(() => createPreviewStore<Work>(), []);
  const pendingSelectIdRef = useRef<string | null>(null);
  const gridMetricsRef = useRef({ cols: 3, rowHeight: 180, gap: 0 });
  const mountedEndRef = useRef(mountedEnd);
  mountedEndRef.current = mountedEnd;
  const coverflowProfile = useCoverflowMotion(
    gridRef,
    view === "cover-flow",
    `${kind}:${artworkSize}:${items?.length ?? 0}:${items !== null && items.length > 0}`
  );

  /** Remembers the whole loaded list, so Back from a title opened deep in it paints that list at once. */
  const storeLoadedList = useCallback(() => {
    if (itemsRef.current.length <= PAGE_SIZE) return;
    const params = libraryFirstPageParams(kind, sort, order, languageParams);
    client.queries.set(
      libraryLoadedKey(params),
      { items: itemsRef.current, total: totalRef.current ?? itemsRef.current.length } satisfies LibraryLoadedList<Work>,
      ["catalog"]
    );
  }, [client, kind, languageParams, order, sort]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;
    const kindChanged = loadedKindRef.current !== kind;
    const firstPageParams = libraryFirstPageParams(kind, sort, order, languageParams);
    const cacheKey = libraryFirstPageKey(firstPageParams);
    // Stale-while-revalidate: a stored list paints at once (Back, revisits, tab switches); the request below
    // revalidates its first page and swaps in only what changed. The loaded list (every page scrolled
    // through) wins over the first page, so Back to a deep title does not start from the top.
    const loadedList = client.queries.peek<LibraryLoadedList<Work>>(libraryLoadedKey(firstPageParams));
    const storedPage = client.queries.peek<CatalogPage>(cacheKey);
    const stored = loadedList
      ? { data: { items: loadedList.data.items, total: loadedList.data.total } as CatalogPage }
      : storedPage;
    const hasVisibleItems = !kindChanged && itemsRef.current.length > 0;
    loadedKindRef.current = kind;

    itemsRef.current = [];
    totalRef.current = null;
    requestRef.current = null;
    if (stored) {
      const orderedItems = loadedList ? loadedList.data.items : orderWorks(stored.data.items, sort, order);
      itemsRef.current = orderedItems;
      totalRef.current = stored.data.total ?? orderedItems.length;
      // The first render already holds this copy (see `seed`): keep that array so nothing re-renders for it.
      setItems((current) => (sameWorkIds(current, orderedItems) ? current : orderedItems));
      setTotal(totalRef.current);
      setSelectedId((current) => (current && orderedItems.some((work) => work.id === current) ? current : orderedItems[0]?.id ?? null));
      previewStore.set(null);
      setActiveLetter(orderedItems[0] ? workLetter(orderedItems[0]) : "#");
    } else {
      if (!hasVisibleItems) setItems(null);
      setTotal(null);
      if (!hasVisibleItems) {
        setSelectedId(null);
        previewStore.set(null);
      }
      if (!hasVisibleItems) setActiveLetter("#");
    }
    setInitialError(null);
    setLoadMoreError(null);
    setRefreshing(hasVisibleItems || Boolean(stored));

    client.queries
      .fetch(cacheKey, () => retryTransient(() => client.browseCatalog(firstPageParams)), { tags: ["catalog"] })
      .then((page) => {
        if (cancelled || generation !== generationRef.current) return;
        const head = orderWorks(page.items, sort, order);
        // A stored list longer than the first page keeps the rows past it: only the head is revalidated
        // (the same merge a live catalogue change does), so the grid never collapses to its first page.
        const keptTail =
          loadedList && itemsRef.current.length > head.length
            ? itemsRef.current.slice(head.length).filter((work) => !head.some((first) => first.id === work.id))
            : [];
        const orderedItems = keptTail.length > 0 ? orderWorks([...head, ...keptTail], sort, order) : head;
        const nextTotal = page.total ?? orderedItems.length;
        if (
          stored &&
          itemsRef.current.length > 0 &&
          nextTotal === totalRef.current &&
          JSON.stringify(orderedItems) === JSON.stringify(itemsRef.current)
        ) {
          // Nothing changed since the stored copy: keep the grid, selection and focus as they are.
          setRefreshing(false);
          return;
        }
        itemsRef.current = orderedItems;
        totalRef.current = nextTotal;
        setItems(orderedItems);
        setTotal(totalRef.current);
        if (orderedItems.length > PAGE_SIZE) storeLoadedList();
        if (!stored) {
          setSelectedId(orderedItems[0]?.id ?? null);
          previewStore.set(null);
          setActiveLetter(orderedItems[0] ? workLetter(orderedItems[0]) : "#");
        }
        setRefreshing(false);
      })
      .catch((error: unknown) => {
        if (!cancelled && generation === generationRef.current) {
          if (hasVisibleItems) {
            setLoadMoreError(describeApiError(error));
          } else {
            setInitialError(describeApiError(error));
          }
          setRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, kind, languageParams, order, previewStore, sort, reloadAttempt]);

  useEffect(() => {
    if (previousKind.current !== kind) {
      previousKind.current = kind;
      setPanel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const liveProgressRevision = useLiveRevision({ areas: ["progress"] });
  useEffect(() => {
    let cancelled = false;
    // A live refresh keeps the current badges until the new rows arrive.
    if (liveProgressRevision === 0) setWatchProgress(null);
    client
      .listWatchProgress()
      .then((rows) => {
        if (!cancelled) setWatchProgress(rows);
      })
      .catch(() => {
        if (!cancelled && liveProgressRevision === 0) setWatchProgress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [client, liveProgressRevision]);

  // Live catalogue changes refresh the first page in place: the grid keeps its
  // items, selection and focus, and only changed works are swapped.
  const liveCatalog = useLiveSubscription({ areas: ["catalog"] });
  useEffect(
    () =>
      liveCatalog(() => {
        const generation = generationRef.current;
        const firstPageParams = libraryFirstPageParams(kind, sort, order, languageParams);
        // The change makes any stored copy stale: drop it, then refetch (and store) the first page.
        client.queries.invalidate(["catalog"]);
        client.queries
          .fetch(libraryFirstPageKey(firstPageParams), () => client.browseCatalog(firstPageParams), {
            tags: ["catalog"],
          })
          .then((page) => {
            if (generation !== generationRef.current || itemsRef.current.length === 0) return;
            const head = orderWorks(page.items, sort, order);
            const headIds = new Set(head.map((work) => work.id));
            const tail = itemsRef.current.slice(PAGE_SIZE).filter((work) => !headIds.has(work.id));
            const merged = orderWorks([...head, ...tail], sort, order);
            const nextTotal = page.total ?? merged.length;
            if (
              nextTotal === totalRef.current &&
              JSON.stringify(merged) === JSON.stringify(itemsRef.current)
            ) {
              return;
            }
            itemsRef.current = merged;
            totalRef.current = nextTotal;
            setItems(merged);
            setTotal(nextTotal);
            storeLoadedList();
          })
          .catch(() => undefined);
      }),
    [client, kind, languageParams, liveCatalog, order, sort, storeLoadedList]
  );

  // Facets follow the other active filters, so only offer languages that
  // still match something. Fetched while the drawer is open.
  useEffect(() => {
    if (!filtersOpen) return;
    let cancelled = false;
    // A retry after a failed load shows the skeleton again, not the error.
    setLanguageFacets((current) => (current === "error" ? null : current));
    client
      .catalogLanguages({ kind, available_only: true, ...languageParams })
      .then((facets) => {
        if (!cancelled) setLanguageFacets(facets);
      })
      .catch(() => {
        if (!cancelled) setLanguageFacets("error");
      });
    return () => {
      cancelled = true;
    };
  }, [client, filtersOpen, kind, languageParams]);

  function changeLanguages(which: "audio" | "subs", next: string[]) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        const value = formatLanguageParam(next);
        if (value) params.set(which, value);
        else params.delete(which);
        return params;
      },
      { replace: true }
    );
  }

  function clearLanguages() {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete("audio");
        params.delete("subs");
        return params;
      },
      { replace: true }
    );
  }

  const loadedFacets = languageFacets === "error" ? null : languageFacets;

  function languageOptions(
    facets: LanguageFacets["audio"] | undefined,
    selected: string[]
  ): { code: string; name: string; count: number | null }[] {
    const rows = (facets ?? []).map((facet) => ({
      code: facet.code,
      name: languageDisplayName(facet.code, uiLanguage, facet.name),
      count: facet.count as number | null,
    }));
    for (const code of selected) {
      if (!rows.some((row) => row.code === code)) {
        rows.push({ code, name: languageDisplayName(code, uiLanguage), count: null });
      }
    }
    return rows;
  }

  /** Each view/size/sort change is its own history entry, so back/forward step through them. */
  function updateView(patch: Partial<{ view: LibraryView; sort: LibrarySort; order: SortOrder }>) {
    rememberLibraryView(kind, patch);
    setSearchParams((current) => applyLibraryView(current, patch));
  }

  function changeView(nextView: LibraryView) {
    updateView({ view: nextView });
  }

  function changeSort(nextSort: LibrarySort) {
    const reordered = orderWorks(itemsRef.current, nextSort, order);
    itemsRef.current = reordered;
    setItems(reordered);
    updateView({ sort: nextSort });
  }

  function changeOrder(nextOrder: SortOrder) {
    const reordered = orderWorks(itemsRef.current, sort, nextOrder);
    itemsRef.current = reordered;
    setItems(reordered);
    setSelectedId((current) => current ?? reordered[0]?.id ?? null);
    previewStore.set(null);
    updateView({ order: nextOrder });
  }

  useEffect(() => rememberWorks(items), [items]);
  const itemCount = items?.length ?? 0;
  // Expand-only: start fixed at 0 so we never remount sliding windows mid-hold.
  const renderWindow = useMemo(() => {
    if (view === "cover-flow") return { start: 0, end: itemCount };
    return {
      start: 0,
      end: Math.min(itemCount, Math.max(mountedEnd, INITIAL_MOUNTED)),
    };
  }, [itemCount, mountedEnd, view]);
  const renderWindowRef = useRef(renderWindow);
  renderWindowRef.current = renderWindow;

  // Publish grid metrics for O(1) remote title-grid nav. Columns and row pitch
  // do not change when more rows mount, so measure only when the layout can
  // change (first items, view/size change, resize) -- never per expansion,
  // which would force a full style+layout of every mounted card.
  const hasItems = itemCount > 0;
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || view === "cover-flow" || !hasItems) return;
    const measure = () => {
      const content = grid.querySelector<HTMLElement>(".tv-title-grid-content");
      const sample = content?.querySelector<HTMLElement>(".tv-title-card");
      if (!content || !sample) return;
      const styles = window.getComputedStyle(content);
      const colCount = Math.max(
        1,
        styles.gridTemplateColumns.split(" ").filter(Boolean).length
      );
      const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
      // The real row pitch (a phone list row is ~85px): a 120px floor over-sized the spacer below the mounted rows and under-mounted them.
      const measured = sample.offsetHeight + gap;
      const rowHeight = measured > 0 ? measured : 120;
      gridMetricsRef.current = { cols: colCount, rowHeight, gap };
      grid.dataset.libraryCols = String(colCount);
      grid.dataset.libraryRowHeight = String(rowHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [view, artworkSize, hasItems]);

  // Grow mount prefix when remote nav leaves the mounted set.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || view === "cover-flow") return;
    const ensure = (index: number) => {
      const totalItems = itemsRef.current.length;
      if (index < 0 || index >= totalItems) return;
      if (libraryWindowContains(renderWindowRef.current, index)) return;
      const cols = Math.max(1, gridMetricsRef.current.cols);
      const nextEnd = libraryExpandMountedEnd(
        mountedEndRef.current,
        index,
        totalItems,
        cols,
        18
      );
      if (nextEnd <= mountedEndRef.current) return;
      flushSync(() => {
        setMountedEnd(nextEnd);
      });
    };
    return registerEnsureLibraryIndex(grid, ensure);
  }, [view, kind, itemCount]);

  // Cards near the viewport get artwork; everything else (pre-mounted rows,
  // rows scrolled past) stays unloaded and unobserved. Driven by scroll position
  // at idle instead of one IntersectionObserver target per mounted card, which
  // cost a per-frame intersection pass over every card.
  const [artworkRange, setArtworkRange] = useState({ start: 0, end: 36 });
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || view === "cover-flow" || itemCount === 0) return;
    let frame = 0;
    let cancelIdle = () => {};
    const update = () => {
      // Row arithmetic from the grid metrics: two rect reads however many cards are mounted.
      const content = grid.querySelector<HTMLElement>(".tv-title-grid-content");
      if (!content) return;
      const { cols: rawCols, rowHeight } = gridMetricsRef.current;
      const cols = Math.max(1, rawCols);
      if (!(rowHeight > 0)) return;
      const gridRect = grid.getBoundingClientRect();
      const contentTop = content.getBoundingClientRect().top;
      const lastIndex = Math.max(0, itemsRef.current.length - 1);
      const firstRow = Math.max(0, Math.floor((gridRect.top - contentTop) / rowHeight));
      const lastRow = Math.max(firstRow, Math.floor((gridRect.bottom - contentTop) / rowHeight));
      const first = Math.min(lastIndex, firstRow * cols);
      const last = Math.min(lastIndex, (lastRow + 1) * cols - 1);
      const start = Math.max(0, first - ARTWORK_MARGIN_ROWS * cols);
      const end = last + 1 + ARTWORK_MARGIN_ROWS * cols;
      setArtworkRange((current) =>
        current.start === start && current.end === end ? current : { start, end }
      );
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        cancelIdle();
        cancelIdle = whenNavigationIdle(update);
      });
    };
    schedule();
    grid.addEventListener("scroll", schedule, { passive: true });
    return () => {
      grid.removeEventListener("scroll", schedule);
      window.cancelAnimationFrame(frame);
      cancelIdle();
    };
  }, [itemCount, view, mountedEnd]);

  // Pre-mount rows ahead of the settled selection while the user is idle, a
  // couple of rows per task with a gap between, so a later hold scrolls over
  // rows that already exist instead of mounting them on the keypress path and
  // a key pressed mid-way only ever waits for one small slice.
  useEffect(() => {
    if (view === "cover-flow" || itemCount === 0) return;
    const cols = Math.max(1, gridMetricsRef.current.cols);
    const settledIndex = selectedId
      ? Math.max(0, itemsRef.current.findIndex((work) => work.id === selectedId))
      : 0;
    const desired = Math.min(
      itemCount,
      settledIndex + (PREMOUNT_AHEAD_ROWS + 1) * cols
    );
    let cursor = mountedEndRef.current;
    if (desired <= cursor) return;
    let cancelIdle = () => {};
    let gap = 0;
    const step = () => {
      cursor = Math.min(desired, cursor + cols * PREMOUNT_SLICE_ROWS);
      const next = cursor;
      startTransition(() => setMountedEnd((current) => Math.max(current, next)));
      if (cursor < desired) {
        gap = window.setTimeout(() => {
          cancelIdle = whenNavigationIdle(step);
        }, PREMOUNT_GAP_MS);
      }
    };
    cancelIdle = whenNavigationIdle(step);
    return () => {
      cancelIdle();
      window.clearTimeout(gap);
    };
  }, [itemCount, selectedId, view]);

  // Reset mount prefix when the catalogue kind changes. Not on mount: the layout effect that mounts rows up to the
  // title a Back returns to has already run by then, and resetting here unmounted it again (Back from a title
  // past the first rows landed on the first card).
  const mountedKindRef = useRef(kind);
  useEffect(() => {
    if (mountedKindRef.current === kind) return;
    mountedKindRef.current = kind;
    setMountedEnd(INITIAL_MOUNTED);
  }, [kind]);

  useEffect(() => {
    return () => {
      window.clearTimeout(selectTimerRef.current);
    };
  }, []);

  const updateActiveLetterNow = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const gridRect = grid.getBoundingClientRect();
    if (view === "cover-flow") {
      // One pass, nearest centre wins (no sort, one rect read per card).
      const trackingLine = gridRect.left + gridRect.width / 2;
      let closest: HTMLElement | undefined;
      let closestDistance = Infinity;
      for (const card of grid.querySelectorAll<HTMLElement>(".tv-title-card")) {
        const rect = card.getBoundingClientRect();
        if (rect.right <= gridRect.left || rect.left >= gridRect.right) continue;
        const distance = Math.abs(rect.left + rect.width / 2 - trackingLine);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = card;
        }
      }
      const visibleLetter = closest?.dataset.libraryLetter;
      if (visibleLetter) setActiveLetter(visibleLetter);
      return;
    }

    // Row arithmetic instead of measuring every card.
    const content = grid.querySelector<HTMLElement>(".tv-title-grid-content");
    const { cols: rawCols, rowHeight } = gridMetricsRef.current;
    if (!content || !(rowHeight > 0)) return;
    const cols = Math.max(1, rawCols);
    const trackingLine = gridRect.top + Math.min(64, grid.clientHeight * 0.1);
    const row = Math.max(0, Math.floor((trackingLine - content.getBoundingClientRect().top) / rowHeight));
    const lastIndex = Math.max(0, itemsRef.current.length - 1);
    const card = grid.querySelector<HTMLElement>(`[data-library-index="${Math.min(lastIndex, row * cols)}"]`);
    const visibleLetter = card?.dataset.libraryLetter;
    if (visibleLetter) setActiveLetter(visibleLetter);
  }, [view]);

  // Set while a letter jump scrolls the grid: scroll tracking must not flip the circle to a neighbour letter.
  const jumpLockRef = useRef(false);
  const jumpSeqRef = useRef(0);
  const remoteLetterTimerRef = useRef(0);
  const updateActiveLetter = useCallback(() => {
    if (jumpLockRef.current) return;
    // Alphabet chrome re-renders the filter strip: mid remote hold, wait until the focus settles.
    if (document.body.dataset.inputMode === "remote") {
      window.clearTimeout(remoteLetterTimerRef.current);
      remoteLetterTimerRef.current = window.setTimeout(() => {
        if (!jumpLockRef.current) updateActiveLetterNow();
      }, 150);
      return;
    }
    updateActiveLetterNow();
  }, [view]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateActiveLetter);
    const grid = gridRef.current;
    if (!grid) return () => window.cancelAnimationFrame(frame);
    const observer = new ResizeObserver(updateActiveLetter);
    observer.observe(grid);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [items, view, updateActiveLetter]);

  const appendNextPage = useCallback((): Promise<Work[]> => {
    if (requestRef.current) return requestRef.current;
    if (totalRef.current !== null && itemsRef.current.length >= totalRef.current) {
      return Promise.resolve([]);
    }

    const generation = generationRef.current;
    const offset = itemsRef.current.length;
    setLoadingMore(true);
    setLoadMoreError(null);

    const request = client
      .browseCatalog({
        kind,
        available_only: true,
        sort,
        order,
        limit: PAGE_SIZE,
        offset,
        ...languageParams,
      })
      .then((page) => {
        if (generation !== generationRef.current) return [];
        const existingIds = new Set(itemsRef.current.map((work) => work.id));
        const uniqueItems = page.items.filter((work) => !existingIds.has(work.id));
        const merged = orderWorks([...itemsRef.current, ...uniqueItems], sort, order);
        itemsRef.current = merged;
        totalRef.current = page.total ?? totalRef.current ?? merged.length;
        setItems(merged);
        setTotal(totalRef.current);
        storeLoadedList();
        return uniqueItems;
      })
      .catch((error: unknown) => {
        if (generation === generationRef.current) {
          setLoadMoreError(describeApiError(error));
        }
        throw error;
      })
      .finally(() => {
        if (generation === generationRef.current) setLoadingMore(false);
        // Only the request that is still current clears the marker: a stale one finishing late must not
        // drop the in-flight marker of the newer generation (it would allow a duplicate page fetch).
        if (requestRef.current === request) requestRef.current = null;
      });

    requestRef.current = request;
    return request;
  }, [client, kind, languageParams, order, sort, storeLoadedList]);

  const hasMore =
    !refreshing && items !== null && (total === null || items.length < total);

  // Paging and mounting follow the scroll position. They used to hang on a sentinel after the mounted rows, which a fast
  // fling scrolled past (the unmounted rows below are only padding), so it never intersected again and nothing loaded.
  // The list's scroll extent always covers every loaded row, so "how far from the end" is exact however many rows are
  // mounted, and it is re-checked after every page, so one fling keeps fetching until the end.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || itemCount === 0) return;
    const horizontal = view === "cover-flow";
    const sync = () => {
      if (!horizontal) {
        const content = grid.querySelector<HTMLElement>(".tv-title-grid-content");
        const { cols: rawCols, rowHeight } = gridMetricsRef.current;
        if (content && rowHeight > 0) {
          const cols = Math.max(1, rawCols);
          const lastRow = Math.floor((grid.getBoundingClientRect().bottom - content.getBoundingClientRect().top) / rowHeight);
          const want = Math.min(itemsRef.current.length, (lastRow + 1 + MOUNT_AHEAD_ROWS) * cols);
          if (want > mountedEndRef.current) setMountedEnd((current) => Math.max(current, want));
        }
      }
      if (!hasMore || loadMoreError) return;
      const remaining = horizontal
        ? grid.scrollWidth - grid.scrollLeft - grid.clientWidth
        : grid.scrollHeight - grid.scrollTop - grid.clientHeight;
      if (remaining < LOAD_AHEAD_PX) void appendNextPage().catch(() => undefined);
    };
    sync();
    grid.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(grid);
    return () => {
      grid.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [appendNextPage, hasMore, itemCount, loadMoreError, loadingMore, view]);

  const selected = useMemo(
    () => items?.find((work) => work.id === selectedId) ?? items?.[0] ?? null,
    [items, selectedId]
  );
  const progressByWork = useMemo(
    () => indexWatchProgressByWork(watchProgress ?? []),
    [watchProgress]
  );
  const handleProgressChanged = useCallback(
    (_workId: string, updated: WatchProgress[]) => {
      const updatedIds = new Set(updated.map((progress) => progress.media_file_id));
      setWatchProgress((current) => [
        ...(current ?? []).filter(
          (progress) => !updatedIds.has(progress.media_file_id)
        ),
        ...updated,
      ]);
    },
    []
  );
  const mediaContext = useMediaContextMenu({
    onProgressChanged: handleProgressChanged,
  });
  const itemIdsKey = useMemo(
    () => items?.map((work) => work.id).join(",") ?? "loading",
    [items]
  );
  const letters = useMemo(() => items?.map(workLetter) ?? [], [items]);
  const navigationLayer = useNavigationLayer(
    `${kind}:${view}:${artworkSize}:${sort}:${order}:${itemIdsKey}`,
    // Not while the stored list is being revalidated: `hasMore` is false then only because loading more waits for
    // it, and a restore attempt that cannot find its title yet must not give up and drop the saved position.
    items !== null && !refreshing && !hasMore
  );
  const restoreFocusPrefix = `library:${kind}:`;
  const restoreWorkId = navigationLayer.focusKey?.startsWith(restoreFocusPrefix)
    ? navigationLayer.focusKey.slice(restoreFocusPrefix.length)
    : null;

  useEffect(() => {
    if (
      !navigationLayer.hasSnapshot ||
      !restoreWorkId ||
      items === null ||
      items.some((work) => work.id === restoreWorkId) ||
      !hasMore
    ) {
      return;
    }
    void appendNextPage().catch(() => undefined);
  }, [
    appendNextPage,
    hasMore,
    items,
    navigationLayer.hasSnapshot,
    restoreWorkId,
  ]);

  // Returning from a detail page restores focus to a specific title; rows are
  // mounted on demand, so mount up to it before the restore looks for it.
  useLayoutEffect(() => {
    if (!restoreWorkId || view === "cover-flow") return;
    const index = itemsRef.current.findIndex((work) => work.id === restoreWorkId);
    if (index < 0) return;
    setMountedEnd((current) => Math.max(current, index + PREMOUNT_AHEAD_ROWS * 3));
  }, [restoreWorkId, items, view]);

  /** Right from the rail: focus the first card of the active section (explicit only; a jump never moves focus). */
  function enterGridFromRail() {
    const list = itemsRef.current;
    const index = list.findIndex((work) => workLetter(work) === activeLetter);
    const grid = gridRef.current;
    if (index < 0 || !grid) return;
    ensureLibraryIndex(grid, index);
    void afterTwoFrames().then(() => grid.querySelector<HTMLElement>(`[data-library-index="${index}"]`)?.focus());
  }

  async function jumpToLetter(letter: string) {
    // A newer jump (a touch scrub crosses many letters) supersedes this one: stale jumps never scroll or release the lock.
    const seq = (jumpSeqRef.current += 1);
    const stale = () => seq !== jumpSeqRef.current;
    setJumpingLetter(letter);
    jumpLockRef.current = true;
    setActiveLetter(letter);
    try {
      const letters = order === "desc" ? [...ALPHABET].reverse() : [...ALPHABET];
      const targetPosition = letters.indexOf(letter as (typeof ALPHABET)[number]);
      // First title at or after the letter in the current sort order (a letter
      // with no titles lands on the next one that has some).
      const findIndex = () => {
        const list = itemsRef.current;
        for (let i = 0; i < list.length; i += 1) {
          const position = letters.indexOf(
            workLetter(list[i]!) as (typeof ALPHABET)[number]
          );
          if (position >= targetPosition) return i;
        }
        return -1;
      };
      let index = findIndex();
      while (
        index < 0 &&
        (totalRef.current === null || itemsRef.current.length < totalRef.current)
      ) {
        let added: Work[];
        try {
          added = await appendNextPage();
        } catch {
          // The failed page is already reported through `loadMoreError`; jump to what is loaded.
          break;
        }
        if (added.length === 0) break;
        index = findIndex();
      }
      if (index < 0) index = itemsRef.current.length - 1;
      if (index < 0 || stale()) return;

      const grid = gridRef.current;
      // Rows are mounted on demand; make sure the destination exists first.
      ensureLibraryIndex(grid, index);
      await afterTwoFrames();
      const destination = grid?.querySelector<HTMLElement>(
        `[data-library-index="${index}"]`
      );
      if (!grid || !destination || stale()) return;
      // Focus stays on the pressed letter; the circle moves at once (to the next letter that has titles when this one has none).
      setActiveLetter(destination.dataset.libraryLetter ?? letter);
      // A jump can cross hundreds of unmounted rows: scroll instantly, top-aligned so the section's first card leads.
      if (view === "cover-flow") smoothScrollIntoView(destination, { block: "center", inline: "center", instant: true });
      else {
        // Mounting rows shifts the layout under the target: re-align until it sits at the top.
        for (let pass = 0; pass < 4; pass += 1) {
          if (stale()) return;
          const delta = destination.getBoundingClientRect().top - grid.getBoundingClientRect().top;
          if (pass > 0 && Math.abs(delta) < 1) break;
          setScrollInstant(grid, { top: grid.scrollTop + delta });
          await afterTwoFrames();
        }
      }
      await afterTwoFrames();
    } finally {
      if (!stale()) {
        jumpLockRef.current = false;
        setJumpingLetter(null);
      }
    }
  }

  // One delegated focus handler for the whole grid keeps every card free of
  // per-render closures, so `LibraryTitleCard` can be memoised.
  const focusStateRef = useRef({ items, hasMore, view, appendNextPage });
  focusStateRef.current = { items, hasMore, view, appendNextPage };
  /**
   * The remote (or a pointer) is now on `work`. The preview text follows at once from the list data; only the
   * heavier selection (backdrop art, prefetch, card chrome) waits for a short idle so holds stay lag-free.
   */
  const details = useFocusedDetailsController();
  const focusIndexRef = useRef(0);
  useEffect(() => {
    // Neighbours and the idle warm-up are resolved off the key path (after the focus dwell / on idle time).
    const grid = () => gridRef.current;
    details.setNear(() => {
      const list = focusStateRef.current.items ?? [];
      const container = grid();
      const first = container?.querySelector<HTMLElement>("[data-library-index]");
      const columns = first
        ? [...container!.querySelectorAll<HTMLElement>("[data-library-index]")].filter(
            (card) => card.offsetTop === first.offsetTop
          ).length
        : 1;
      return gridNeighbours(list, focusIndexRef.current, view === "cover-flow" ? list.length : columns);
    });
    details.setWarm(() => {
      const list = focusStateRef.current.items ?? [];
      const mounted = grid()?.querySelectorAll<HTMLElement>("[data-library-index]") ?? [];
      return [...mounted]
        .map((card) => Number.parseInt(card.dataset.libraryIndex ?? "", 10))
        .filter((index) => Number.isFinite(index) && list[index] !== undefined)
        .sort((a, b) => Math.abs(a - focusIndexRef.current) - Math.abs(b - focusIndexRef.current))
        .map((index) => list[index]!.id);
    });
    return () => details.release();
  }, [details, view]);
  const focusWork = useCallback(
    (work: Work, remote: boolean) => {
      previewStore.set(work);
      focusIndexRef.current = Math.max(0, focusStateRef.current.items?.findIndex((item) => item.id === work.id) ?? 0);
      details.focus(work.id);
      pendingSelectIdRef.current = work.id;
      window.clearTimeout(selectTimerRef.current);
      selectTimerRef.current = window.setTimeout(() => {
        const id = pendingSelectIdRef.current;
        if (!id) return;
        startTransition(() => {
          setSelectedId(id);
        });
      }, remote ? SELECT_SETTLE_MS : 0);
    },
    [details, previewStore]
  );
  const handleGridFocus = useCallback((event: React.FocusEvent<HTMLElement>) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>(
      ".tv-title-card"
    );
    if (!card) return;
    const index = Number.parseInt(card.dataset.libraryIndex ?? "", 10);
    const state = focusStateRef.current;
    const work = state.items?.[index];
    if (!work) return;
    focusWork(work, document.body.dataset.inputMode === "remote");
    if (state.view === "cover-flow" && !isNavigationLayerRestoring()) {
      const grid = gridRef.current;
      if (grid) {
        const targetLeft =
          card.offsetLeft + card.offsetWidth / 2 - grid.clientWidth / 2;
        smoothScrollTo(grid, { left: Math.max(0, targetLeft) }, coverflowProfile);
      }
    }
    if (state.items && index >= state.items.length - 12 && state.hasMore) {
      void state.appendNextPage().catch(() => undefined);
    }
  }, [focusWork, coverflowProfile]);

  // In remote mode real DOM focus trails the virtual focus marker by its settle time, so the preview follows the
  // marker itself: the card carrying `data-remote-active` is the one the user is looking at.
  const hasGrid = items !== null && items.length > 0;
  useRemoteMarkerFollow(
    gridRef,
    (card) => {
      const work = focusStateRef.current.items?.[Number.parseInt(card.dataset.libraryIndex ?? "", 10)];
      if (work) focusWork(work, true);
    },
    hasGrid
  );

  const filtersDrawer = (
      <FiltersDrawer
        key="filters"
        id={`${kind}-library-filters`}
        open={filtersOpen}
        kicker={t("pages.library.libraryControls")}
        title={t("pages.library.filters")}
        ariaLabel={t("pages.library.filterDrawerAriaLabel", { plural })}
        closeLabel={t("pages.library.closeFilters")}
        onClose={() => setFiltersOpen(false)}
      >
          <FilterSection title={t("pages.library.view")}>
            <ViewToggle
              ariaLabel={t("pages.library.view")}
              value={view}
              onChange={changeView}
              options={(
                (kind === "artist"
                  ? (["list", "screen", "cover", "cover-flow"] as LibraryView[])
                  : (["list", "screen", "cover"] as LibraryView[])
                ).map((option) => ({
                  value: option,
                  icon: option,
                  label:
                    option === "cover-flow"
                      ? t("pages.library.viewCoverFlow")
                      : option === "list"
                        ? t("pages.library.viewList")
                        : option === "screen"
                          ? t("pages.library.viewScreen")
                          : t("pages.library.viewCover"),
                }))
              )}
            />
          </FilterSection>

          <FilterSection title={t("pages.library.sortBy")}>
            <div className="tv-filter-choice-grid tv-filter-choice-grid-wide">
              <button
                type="button"
                className={sort === "title" ? "is-active" : ""}
                onClick={() => changeSort("title")}
                aria-pressed={sort === "title"}
              >
                {t("pages.library.sortTitle")}
              </button>
              <button
                type="button"
                className={sort === "date_added" ? "is-active" : ""}
                onClick={() => changeSort("date_added")}
                aria-pressed={sort === "date_added"}
              >
                {t("pages.library.sortDateAdded")}
              </button>
            </div>
          </FilterSection>

          <FilterSection title={t("pages.library.order")}>
            <div className="tv-filter-choice-grid tv-filter-choice-grid-wide">
              <button
                type="button"
                className={order === "asc" ? "is-active" : ""}
                onClick={() => changeOrder("asc")}
                aria-pressed={order === "asc"}
              >
                {sort === "title" ? t("pages.library.sortAscAlpha") : t("pages.library.sortAscDate")}
              </button>
              <button
                type="button"
                className={order === "desc" ? "is-active" : ""}
                onClick={() => changeOrder("desc")}
                aria-pressed={order === "desc"}
              >
                {sort === "title" ? t("pages.library.sortDescAlpha") : t("pages.library.sortDescDate")}
              </button>
            </div>
          </FilterSection>

          {(
            [
              ["audio", t("pages.library.audioLanguage"), loadedFacets?.audio, audioLangs],
              ["subs", t("pages.library.subtitleLanguage"), loadedFacets?.subtitle, subtitleLangs],
            ] as const
          ).map(([which, heading, facets, selected]) => {
            const options = languageOptions(facets, [...selected]);
            return (
              <FilterSection key={which} title={heading} data-language-filter={which}>
                {options.length === 0 ? (
                  languageFacets === null ? (
                    <div
                      className="skeleton tv-filter-language-skeleton"
                      role="status"
                      aria-busy="true"
                      aria-label={t("pages.library.loadingLanguages")}
                    />
                  ) : (
                    <p>
                      {languageFacets === "error"
                        ? t("pages.library.languagesUnavailable")
                        : t("pages.library.noLanguages")}
                    </p>
                  )
                ) : (
                  <MultiSelect
                    ariaLabel={heading}
                    options={options.map((option) => ({
                      value: option.code,
                      label: option.name,
                      hint: option.count === null ? undefined : String(option.count),
                    }))}
                    selected={selected}
                    onChange={(next) => changeLanguages(which, next)}
                    labels={{
                      none: t("pages.library.anyLanguage"),
                      add: t("pages.library.addLanguage"),
                      remove: (name) => t("pages.library.removeLanguage", { name }),
                      announce: (count, shown) => t("pages.library.languagesAnnounce", { count, shown }),
                    }}
                  />
                )}
              </FilterSection>
            );
          })}
          {audioLangs.length + subtitleLangs.length > 0 ? (
            <FilterSection>
              <div className="tv-filter-choice-grid">
                <button type="button" onClick={clearLanguages}>
                  {t("pages.library.clearLanguages")}
                </button>
              </div>
            </FilterSection>
          ) : null}
      </FiltersDrawer>
  );

  if (items === null || initialError || !items.length || !selected) {
    // The header and Back stay up while the library loads, fails or is empty.
    return (
      <PageLayout
        pageId="library"
        className={`tv-library tv-directory tv-directory-${view} tv-artwork-${artworkSize}`}
        ariaLabel={t("pages.library.stageAriaLabel", { plural })}
        header={{ title: plural, back: { label: t("pages.library.backToHome"), to: "/" } }}
        overlay={
          <>
            {filtersDrawer}
            {items === null && !initialError ? <LoadingTrail /> : null}
          </>
        }
        state={
          initialError
            ? {
                kind: "error",
                props: {
                  graphic: emptyGraphic,
                  title: t("pages.library.errorTitle", { plural: plural.toLowerCase() }),
                  description: initialError,
                  onRetry: () => setReloadAttempt((value) => value + 1),
                  retryLabel: t("components.states.retry"),
                },
              }
            : items === null
              ? { kind: "loading", skeleton: "grid", label: t("pages.library.preparingLabel", { label: plural.toLowerCase() }) }
              : {
                  kind: "empty",
                  props: {
                    graphic: emptyGraphic,
                    title: t("pages.library.emptyTitle", { plural: plural.toLowerCase() }),
                    description: t("pages.library.emptyDescription", { collectionNoun }),
                  },
                }
        }
      />
    );
  }

  const alphabet = order === "desc" ? [...ALPHABET].reverse() : [...ALPHABET];
  const unmountedRows =
    Math.ceil(items.length / Math.max(1, gridMetricsRef.current.cols)) - Math.ceil(renderWindow.end / Math.max(1, gridMetricsRef.current.cols));
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selected.id)
  );

  return (
    <PageLayout
      pageId="library"
      className={`tv-library tv-directory tv-directory-${view} tv-artwork-${artworkSize}`}
      ariaLabel={t("pages.library.stageAriaLabel", { plural })}
      // Same Fragment shape as the loading branch, so the open Filters panel is not remounted when the list arrives.
      overlay={
        <>
          {filtersDrawer}
          {null}
        </>
      }
      backdrop={{
        artKey: "library-art",
        art: <CrossfadeArt work={selected} kinds={["backdrop", "poster"]} />,
      }}
      header={{
        title: plural,
        back: { label: t("pages.library.backToHome"), to: "/" },
        detail: `${(total ?? items.length).toLocaleString()} ${collectionNoun}`,
        actions: [
          {
            kind: "filters",
            label: t("pages.library.filters"),
            open: filtersOpen,
            onToggle: () => setFiltersOpen((open) => !open),
            controls: `${kind}-library-filters`,
            activeCount: audioLangs.length + subtitleLangs.length,
          },
        ],
      }}
    >
      <LibraryPreview store={previewStore} fallback={selected} singular={singular} />

      <ListPanel
        panelClassName={`is-${view} artwork-${artworkSize}`}
        ariaLabel={t("pages.library.railAriaLabel", { plural, collectionNoun })}
        scrollKey={`library:${kind}:grid`}
        refreshKey={`${kind}:${view}:${artworkSize}:${items.length}`}
        axis={view === "cover-flow" ? "horizontal" : "vertical"}
        gridRef={gridRef}
        gridProps={{
          onScroll: updateActiveLetter,
          onFocus: handleGridFocus,
          "data-library-count": items.length,
          "aria-busy": refreshing,
        }}
        overlay={
          refreshing || loadingMore ? (
            <LoadingTrail label={refreshing ? t("pages.library.updatingLibrary") : t("pages.library.loadingMoreTitles")} />
          ) : null
        }
        footer={
          loadMoreError ? (
            <button type="button" className="tv-inline-error" onClick={() => void appendNextPage().catch(() => undefined)}>
              {t("pages.library.retryLoadMore")}
            </button>
          ) : null
        }
      >
            {view === "cover-flow"
              ? items.map((work, index) => {
                  const letter = letters[index] ?? workLetter(work);
                  return (
                    <LibraryTitleCard
                      key={work.id}
                      work={work}
                      index={index}
                      routeBase={routeBase}
                      kind={kind}
                      view={view}
                      imageKinds={libraryImageKinds("cover")}
                      letter={letter}
                      isSelected={work.id === selected.id}
                      coverFlowOffset={Math.max(-4, Math.min(4, index - selectedIndex))}
                      progress={progressByWork.get(work.id)}
                      showUnwatched={watchProgress !== null}
                      singular={singular}
                      navigationOrigin={navigationLayer.origin}
                      onCapture={navigationLayer.captureLink}
                      itemProps={mediaContext.itemProps}
                      artworkEnabled
                    />
                  );
                })
              : libraryChunkRanges(renderWindow.end).map(({ chunk, start, end }) => (
                  <LibraryChunk
                    key={chunk}
                    items={items}
                    start={start}
                    end={end}
                    selectedId={
                      selectedIndex >= start && selectedIndex < end ? selected.id : null
                    }
                    routeBase={routeBase}
                    kind={kind}
                    view={view}
                    progressByWork={progressByWork}
                    showUnwatched={watchProgress !== null}
                    singular={singular}
                    navigationOrigin={navigationLayer.origin}
                    onCapture={navigationLayer.captureLink}
                    itemProps={mediaContext.itemProps}
                    artworkFrom={Math.min(end, Math.max(start, artworkRange.start))}
                    artworkTo={Math.max(start, Math.min(end, artworkRange.end))}
                  />
                ))}

            {view === "cover-flow" ? null : (
              <>
                {unmountedRows > 0 ? (
                  // The rows below the mounted prefix: their exact height, so the scroll extent covers every loaded row.
                  <div
                    aria-hidden="true"
                    className="tv-grid-spacer"
                    style={{ gridColumn: "1 / -1", height: Math.max(0, unmountedRows * gridMetricsRef.current.rowHeight - gridMetricsRef.current.gap) }}
                  />
                ) : null}
                {loadingMore
                  ? // Exactly one extra row of skeleton cards while the next page loads.
                    Array.from({ length: Math.max(1, gridMetricsRef.current.cols) }, (_, index) => <SkeletonCard key={`more-${index}`} />)
                  : null}
              </>
            )}
      </ListPanel>


      {sort === "title" ? (
        <AlphabetRail
          alphabet={alphabet}
          activeLetter={activeLetter}
          jumpingLetter={jumpingLetter}
          label={t("pages.library.jumpThrough", { plural: plural.toLowerCase() })}
          symbolsLabel={t("pages.library.numbersAndSymbols")}
          refreshKey={order}
          onJump={(letter) => void jumpToLetter(letter)}
          onEnterGrid={enterGridFromRail}
        />
      ) : null}
      {mediaContext.contextMenu}
    </PageLayout>
  );
}

type MediaItemProps = ReturnType<typeof useMediaContextMenu>["itemProps"];

interface LibraryTitleCardProps {
  work: Work;
  index: number;
  routeBase: string;
  kind: LibraryKind;
  view: LibraryView;
  imageKinds: readonly ("poster" | "backdrop")[];
  letter: string;
  isSelected: boolean;
  coverFlowOffset: number;
  progress: WatchProgress | undefined;
  showUnwatched: boolean;
  singular: string;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onCapture: ReturnType<typeof useNavigationLayer>["captureLink"];
  itemProps: MediaItemProps;
  artworkEnabled: boolean;
}


interface LibraryChunkProps {
  items: Work[];
  start: number;
  end: number;
  /** Selected work id when it lives in this chunk, otherwise null, so a selection change re-renders at most two chunks. */
  selectedId: string | null;
  routeBase: string;
  kind: LibraryKind;
  view: LibraryView;
  progressByWork: Map<string, WatchProgress>;
  showUnwatched: boolean;
  singular: string;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onCapture: ReturnType<typeof useNavigationLayer>["captureLink"];
  itemProps: MediaItemProps;
  /** Cards in `[artworkFrom, artworkTo)` load artwork (already clamped to this chunk). */
  artworkFrom: number;
  artworkTo: number;
}

/**
 * A fixed-size run of library cards. Appending a catalogue page or mounting
 * more rows only renders the chunks whose items changed, so cost per keypress
 * no longer grows with how far down the list the user has travelled.
 */
const LibraryChunk = memo(
  function LibraryChunk({
    items,
    start,
    end,
    selectedId,
    routeBase,
    kind,
    view,
    progressByWork,
    showUnwatched,
    singular,
    navigationOrigin,
    onCapture,
    itemProps,
    artworkFrom,
    artworkTo,
  }: LibraryChunkProps) {
    const imageKinds = libraryImageKinds(view);
    const cards = [];
    for (let index = start; index < end; index += 1) {
      const work = items[index]!;
      const letter = workLetter(work);
      cards.push(
        <LibraryTitleCard
          key={work.id}
          work={work}
          index={index}
          routeBase={routeBase}
          kind={kind}
          view={view}
          imageKinds={imageKinds}
          letter={letter}
          isSelected={work.id === selectedId}
          coverFlowOffset={0}
          progress={progressByWork.get(work.id)}
          showUnwatched={showUnwatched}
          singular={singular}
          navigationOrigin={navigationOrigin}
          onCapture={onCapture}
          itemProps={itemProps}
          artworkEnabled={index >= artworkFrom && index < artworkTo}
        />
      );
    }
    return <>{cards}</>;
  },
  (prev, next) =>
    sameLibraryChunkItems(prev, next) &&
    prev.selectedId === next.selectedId &&
    prev.routeBase === next.routeBase &&
    prev.kind === next.kind &&
    prev.view === next.view &&
    prev.progressByWork === next.progressByWork &&
    prev.showUnwatched === next.showUnwatched &&
    prev.singular === next.singular &&
    prev.navigationOrigin === next.navigationOrigin &&
    prev.onCapture === next.onCapture &&
    prev.itemProps === next.itemProps &&
    prev.artworkFrom === next.artworkFrom &&
    prev.artworkTo === next.artworkTo
);

/**
 * One library title. Memoised: a selection change or a newly mounted row must
 * only render the cards whose props actually changed, never the whole grid.
 */
const LibraryTitleCard = memo(function LibraryTitleCard({
  work,
  index,
  routeBase,
  kind,
  view,
  imageKinds,
  letter,
  isSelected,
  coverFlowOffset,
  progress,
  showUnwatched,
  singular,
  navigationOrigin,
  onCapture,
  itemProps,
  artworkEnabled,
}: LibraryTitleCardProps) {
  const { t } = useLanguage();
  useDwellPrefetch(work, isSelected);
  const contextProps = itemProps({
    work,
    detailRoute: `${routeBase}/${work.id}`,
    parentRoute: routeBase,
    progress,
  });
  const linkState = useMemo(
    () => ({ backTo: routeBase, navigationOrigin }),
    [routeBase, navigationOrigin]
  );
  return (
    <Link
      to={`${routeBase}/${work.id}`}
      state={linkState}
      className={`media-card tv-title-card${isSelected ? " is-selected" : ""}${
        view === "cover-flow"
          ? ` cover-flow-offset-${Math.abs(coverFlowOffset)}${
              coverFlowOffset < 0
                ? " is-before"
                : coverFlowOffset > 0
                  ? " is-after"
                  : ""
            }`
          : ""
      }`}
      {...contextProps}
      data-library-letter={letter}
      data-library-index={index}
      data-tv-focus-default={index === 0 ? true : undefined}
      data-navigation-focus-key={`library:${kind}:${work.id}`}
      onClick={onCapture}
      aria-label={t("pages.library.openWork", { title: work.title })}
    >
      <span className="tv-title-card-art">
        <CachedArtworkImage
          work={work}
          kinds={imageKinds}
          alt=""
          loading={view === "cover-flow" ? "lazy" : undefined}
          enabled={artworkEnabled}
          decoding="async"
          fallback={<span>{work.title}</span>}
        />
        <WatchStateOverlay progress={progress} showUnwatched={showUnwatched} />
      </span>
      <span className="tv-title-card-copy">
        <strong>{work.title}</strong>
        <span className="tv-list-card-meta">
          {work.genres.slice(0, 2).join(" · ") || singular}
          {releaseYear(work) !== null ? (
            <>
              <i aria-hidden="true" />
              {yearRangeLabel(work)}
            </>
          ) : null}
        </span>
      </span>
    </Link>
  );
});

