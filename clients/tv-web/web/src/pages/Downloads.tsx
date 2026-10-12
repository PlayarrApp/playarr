import { DetailsPanel } from "../components/DetailsPanel";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DownloadKeepUntilPolicy, DownloadRecord } from "../lib/downloadsDb";
import { useDownloads } from "../lib/DownloadsProvider";
import { formatBytes } from "../lib/formatBytes";
import { releaseYear } from "../lib/workYear";
import { useApiClient } from "../lib/ApiClientProvider";
import { CachedArtworkImage } from "../lib/artwork";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { useNavigationLayer } from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { EditKeepUntilDrawer } from "../components/EditKeepUntilDrawer";
import { Drawer, EmptyState, FilterSection, FiltersDrawer, PageLayout, ScrollArea } from "../components/shell";
import { SegmentedControl, Select } from "../components/ui";
import {
  activeFilterCount,
  aggregateDownloads,
  buildDownloadTree,
  DEFAULT_DOWNLOAD_FILTERS,
  filterAndSortDownloads,
  isFailed,
  isRunning,
  type DownloadAggregate,
  type DownloadFilters,
  type DownloadListItem,
  type SeasonNode,
  type SeriesNode,
} from "../lib/downloadGroups";
import { TvRailSurface } from "../components/tv/TvStage";
import { NotFoundPage } from "./NotFound";
import type { Work, WorkDetail } from "@playarr-tv/api-client";

type TFunc = (key: TranslationKey, params?: Record<string, string | number>) => string;

interface FocusedEpisodeInfo {
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string | null;
  episodeOverview: string | null;
}

interface FocusedPreview {
  detail: WorkDetail | null;
  episode: FocusedEpisodeInfo | null;
}

function statusLabel(record: DownloadRecord, t: TFunc): string {
  switch (record.status) {
    case "queued":
      return t("pages.downloads.statusQueued");
    case "processing":
      return t("pages.downloads.statusProcessing");
    case "downloading":
      return t("pages.downloads.statusDownloading");
    case "paused":
      return t("pages.downloads.statusPaused");
    case "ready":
      return t("pages.downloads.statusReady");
    case "failed":
      return t("pages.downloads.statusFailed");
    case "canceled":
      return t("pages.downloads.statusCanceled");
    case "expired":
      return t("pages.downloads.statusExpired");
    default:
      return record.status;
  }
}

function recordTypeLabel(record: DownloadRecord, t: TFunc): string | null {
  switch (record.workKind) {
    case "movie":
      return t("pages.downloads.typeMovie");
    case "series":
      return t("pages.downloads.typeEpisode");
    case "site":
      return t("pages.downloads.typeVideo");
    case "artist":
      return t("pages.downloads.typeTrack");
    default:
      return null;
  }
}

/** `/music/:id` for a track (its `workId` is the artist work); `/library/:id` (the generic detail route) for everything else. */
function recordDetailRoute(record: DownloadRecord): string {
  return record.workKind === "artist" ? `/music/${record.workId}` : `/library/${record.workId}`;
}

function keepUntilLabel(record: DownloadRecord, t: TFunc): string {
  const policy = record.keepUntil;
  if (policy.type === "forever") return t("pages.downloads.keepForever");
  if (policy.type === "date") {
    return t("pages.downloads.keepUntilDate", {
      date: new Date(policy.date).toLocaleDateString(),
    });
  }
  return policy.unit === "weeks"
    ? t("pages.downloads.keepUntilAfterWatchedWeeks", { count: policy.amount })
    : t("pages.downloads.keepUntilAfterWatchedDays", { count: policy.amount });
}

/** Genre/kind kicker fallback for the preview panel, mirroring `WorkDetail.tsx`'s local `workKindLabel` (reused translation keys -- see that file's `pages.workDetail.kind*` strings). */
function workDetailKindLabel(work: Work, t: TFunc): string {
  switch (work.kind) {
    case "site":
      return t("pages.workDetail.kindSite");
    case "series":
      return t("pages.workDetail.kindSeries");
    case "movie":
      return t("pages.workDetail.kindMovie");
    default:
      return work.kind;
  }
}

/** Resolves which episode (if any) a download's `mediaFileId` plays within a fetched `WorkDetail` -- `null` for movies/sites-without-a-match, or while the detail is still an in-flight/failed fetch. */
function findFocusedEpisode(detail: WorkDetail, mediaFileId: string): FocusedEpisodeInfo | null {
  if (typeof detail.children !== "object" || detail.children === null || !("Series" in detail.children)) {
    return null;
  }
  for (const season of detail.children.Series) {
    const match = season.episodes.find((candidate) => candidate.media_file_id === mediaFileId);
    if (match) {
      return {
        seasonNumber: season.season.season_number,
        episodeNumber: match.episode.episode_number,
        episodeTitle: match.episode.title ?? null,
        episodeOverview: match.episode.overview ?? null,
      };
    }
  }
  return null;
}

type NavigationLayerLink = Pick<ReturnType<typeof useNavigationLayer>, "origin" | "captureLink">;

/** What the controls of one level (a download, a season, a series) can act on. */
interface DownloadActionState {
  running: number;
  paused: number;
  failedOne: boolean;
  /** Downloads that cancelling would stop: running or paused. */
  pending: number;
}

function actionStateFor(records: readonly DownloadRecord[]): DownloadActionState {
  const aggregate = aggregateDownloads(records);
  return {
    running: aggregate.running,
    paused: aggregate.paused,
    failedOne: records.length === 1 && records[0] !== undefined && isFailed(records[0]),
    pending: aggregate.running + aggregate.paused,
  };
}

/**
 * The one set of controls every level shares: Pause (or Resume), Edit, Cancel and Delete (and Retry for one failed
 * download). On a season or a series they act on every download inside it.
 */
function DownloadActions({
  state,
  t,
  onPause,
  onResume,
  onEdit,
  onCancel,
  onDelete,
  onRetry,
}: {
  state: DownloadActionState;
  t: TFunc;
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="tv-download-row-actions">
      {state.running === 0 && state.paused > 0 ? (
        <button type="button" onClick={onResume}>
          {t("pages.downloads.resume")}
        </button>
      ) : (
        <button type="button" onClick={onPause} disabled={state.running === 0}>
          {t("pages.downloads.pause")}
        </button>
      )}
      <button type="button" onClick={onEdit}>
        {t("pages.downloads.edit")}
      </button>
      {state.failedOne && onRetry ? (
        <button type="button" onClick={onRetry}>
          {t("pages.downloads.retry")}
        </button>
      ) : null}
      <button type="button" onClick={onCancel} disabled={state.pending === 0}>
        {t("pages.downloads.cancel")}
      </button>
      <button type="button" className="tv-download-row-remove" onClick={onDelete}>
        {t("pages.downloads.delete")}
      </button>
    </div>
  );
}

function aggregateSizeLine(aggregate: DownloadAggregate, t: TFunc): string {
  if (aggregate.running + aggregate.paused > 0) {
    return t("pages.downloads.bytesOfTotal", {
      downloaded: formatBytes(aggregate.bytesDownloaded),
      total: aggregate.totalBytes !== null ? formatBytes(aggregate.totalBytes) : t("pages.downloads.unknownSize"),
    });
  }
  return formatBytes(aggregate.totalBytes ?? aggregate.bytesDownloaded);
}

interface RowHandlers {
  onPause: (ids: string[]) => void;
  onResume: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  onRetry: (id: string) => void;
  onEdit: (records: DownloadRecord[]) => void;
  onDelete: (records: DownloadRecord[], title: string) => void;
  onFocusRow: (id: string) => void;
}

function DownloadRow({
  record,
  t,
  handlers,
  layer,
  level = 0,
  label,
}: {
  layer: NavigationLayerLink;
  record: DownloadRecord;
  t: TFunc;
  handlers: RowHandlers;
  /** 0 for a flat download, 2 for an episode inside a season. */
  level?: number;
  /** Replaces the title, for an episode ("E03 · Title"). */
  label?: string;
}) {
  const isActive = isRunning(record);
  const typeLabel = recordTypeLabel(record, t);
  const progressPercent =
    record.totalBytes && record.totalBytes > 0
      ? Math.min(100, Math.round((record.bytesDownloaded / record.totalBytes) * 100))
      : null;
  const showProgress = isActive || record.status === "paused";

  return (
    <li
      className="media-card media-card-row tv-download-row"
      data-level={level || undefined}
      data-navigation-focus-key={`downloads:${record.id}`}
      onFocus={() => handlers.onFocusRow(record.id)}
    >
      <Link
        to={recordDetailRoute(record)}
        state={{ navigationOrigin: layer.origin }}
        onClick={layer.captureLink}
        className="tv-download-row-copy"
      >
        <strong>{label ?? record.title}</strong>
        {record.subtitle && level === 0 ? <small>{record.subtitle}</small> : null}
        <span className="tv-download-row-meta">
          {typeLabel && level === 0 ? (
            <>
              <span>{typeLabel}</span>
              <i aria-hidden="true" />
            </>
          ) : null}
          <span>{record.qualityLabel}</span>
          <i aria-hidden="true" />
          <span>{statusLabel(record, t)}</span>
          <i aria-hidden="true" />
          <span>{keepUntilLabel(record, t)}</span>
        </span>
        {showProgress ? (
          <div
            className="tv-download-progress"
            role="progressbar"
            aria-valuenow={progressPercent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("pages.downloads.progressAriaLabel", { title: record.title })}
          >
            <span
              className="tv-download-progress-fill"
              style={progressPercent !== null ? { width: `${progressPercent}%` } : undefined}
              data-indeterminate={progressPercent === null && isActive ? "true" : undefined}
            />
          </div>
        ) : null}
        <span className="tv-download-row-size">
          {showProgress
            ? t("pages.downloads.bytesOfTotal", {
                downloaded: formatBytes(record.bytesDownloaded),
                total: record.totalBytes !== null ? formatBytes(record.totalBytes) : t("pages.downloads.unknownSize"),
              })
            : formatBytes(record.totalBytes ?? record.bytesDownloaded)}
        </span>
        {record.status === "failed" && record.errorMessage ? (
          <span className="tv-download-row-error" role="alert">
            {record.errorMessage}
          </span>
        ) : null}
      </Link>
      <DownloadActions
        state={actionStateFor([record])}
        t={t}
        onPause={() => handlers.onPause([record.id])}
        onResume={() => handlers.onResume([record.id])}
        onEdit={() => handlers.onEdit([record])}
        onCancel={() => handlers.onRemove([record.id])}
        onDelete={() => handlers.onDelete([record], record.title)}
        onRetry={() => handlers.onRetry(record.id)}
      />
    </li>
  );
}

/** A season or a series: one row with the totals, a toggle for what is inside, and the shared controls for all of it. */
function DownloadGroupRow({
  groupKey,
  level,
  title,
  meta,
  records,
  aggregate,
  expanded,
  onToggle,
  t,
  handlers,
  children,
}: {
  groupKey: string;
  level: 1 | 2;
  title: string;
  meta: string;
  records: DownloadRecord[];
  aggregate: DownloadAggregate;
  expanded: boolean;
  onToggle: () => void;
  t: TFunc;
  handlers: RowHandlers;
  children: React.ReactNode;
}) {
  const showProgress = aggregate.running + aggregate.paused > 0;
  const first = records[0];
  return (
    <li className="tv-download-group" data-level={level}>
      <div
        className="media-card media-card-row tv-download-row tv-download-group-row"
        data-level={level === 2 ? 1 : undefined}
        data-navigation-focus-key={`downloads:${groupKey}`}
        onFocus={() => first && handlers.onFocusRow(first.id)}
      >
        <button
          type="button"
          className="tv-download-row-copy tv-download-group-toggle"
          aria-expanded={expanded}
          aria-label={t(expanded ? "pages.downloads.collapseGroup" : "pages.downloads.expandGroup", { title })}
          onClick={onToggle}
        >
          <strong>
            <span className="tv-download-group-caret" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
            {title}
          </strong>
          <span className="tv-download-row-meta">
            <span>{meta}</span>
            <i aria-hidden="true" />
            <span>{groupStatusLabel(aggregate, t)}</span>
          </span>
          {showProgress ? (
            <div
              className="tv-download-progress"
              role="progressbar"
              aria-valuenow={aggregate.percent ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("pages.downloads.progressAriaLabel", { title })}
            >
              <span
                className="tv-download-progress-fill"
                style={aggregate.percent !== null ? { width: `${aggregate.percent}%` } : undefined}
                data-indeterminate={aggregate.percent === null && aggregate.running > 0 ? "true" : undefined}
              />
            </div>
          ) : null}
          <span className="tv-download-row-size">{aggregateSizeLine(aggregate, t)}</span>
        </button>
        <DownloadActions
          state={actionStateFor(records)}
          t={t}
          onPause={() => handlers.onPause(records.map((record) => record.id))}
          onResume={() => handlers.onResume(records.map((record) => record.id))}
          onEdit={() => handlers.onEdit(records)}
          onCancel={() =>
            handlers.onRemove(records.filter((record) => isRunning(record) || record.status === "paused").map((record) => record.id))
          }
          onDelete={() => handlers.onDelete(records, title)}
        />
      </div>
      {expanded ? <ul className="tv-download-children">{children}</ul> : null}
    </li>
  );
}

function groupStatusLabel(aggregate: DownloadAggregate, t: TFunc): string {
  if (aggregate.running > 0) return t("pages.downloads.statusDownloading");
  if (aggregate.paused > 0) return t("pages.downloads.statusPaused");
  if (aggregate.failed > 0) return t("pages.downloads.statusFailed");
  return t("pages.downloads.statusReady");
}

function countLabel(count: number, one: TranslationKey, many: TranslationKey, t: TFunc): string {
  return count === 1 ? t(one) : t(many, { count });
}

function SeasonGroup({
  season,
  seriesKey,
  t,
  handlers,
  layer,
  expandedKeys,
  toggle,
}: {
  season: SeasonNode;
  seriesKey: string;
  t: TFunc;
  handlers: RowHandlers;
  layer: NavigationLayerLink;
  expandedKeys: ReadonlySet<string>;
  toggle: (key: string) => void;
}) {
  void seriesKey;
  return (
    <DownloadGroupRow
      groupKey={season.key}
      level={2}
      title={t("pages.downloads.seasonLabel", { number: season.seasonNumber })}
      meta={countLabel(season.episodes.length, "pages.downloads.episodeCountOne", "pages.downloads.episodeCountMany", t)}
      records={season.records}
      aggregate={season.aggregate}
      expanded={expandedKeys.has(season.key)}
      onToggle={() => toggle(season.key)}
      t={t}
      handlers={handlers}
    >
      {season.episodes.map((episode) => (
        <DownloadRow
          key={episode.record.id}
          record={episode.record}
          t={t}
          handlers={handlers}
          layer={layer}
          level={2}
          label={`E${String(episode.episodeNumber).padStart(2, "0")} · ${episode.record.title}`}
        />
      ))}
    </DownloadGroupRow>
  );
}

function SeriesGroup({
  series,
  t,
  handlers,
  layer,
  expandedKeys,
  toggle,
}: {
  series: SeriesNode;
  t: TFunc;
  handlers: RowHandlers;
  layer: NavigationLayerLink;
  expandedKeys: ReadonlySet<string>;
  toggle: (key: string) => void;
}) {
  const meta = `${countLabel(series.seasons.length, "pages.downloads.seasonCountOne", "pages.downloads.seasonCountMany", t)} · ${countLabel(
    series.records.length,
    "pages.downloads.episodeCountOne",
    "pages.downloads.episodeCountMany",
    t
  )}`;
  return (
    <DownloadGroupRow
      groupKey={series.key}
      level={1}
      title={series.title}
      meta={meta}
      records={series.records}
      aggregate={series.aggregate}
      expanded={expandedKeys.has(series.key)}
      onToggle={() => toggle(series.key)}
      t={t}
      handlers={handlers}
    >
      {series.seasons.map((season) => (
        <SeasonGroup
          key={season.key}
          season={season}
          seriesKey={series.key}
          t={t}
          handlers={handlers}
          layer={layer}
          expandedKeys={expandedKeys}
          toggle={toggle}
        />
      ))}
    </DownloadGroupRow>
  );
}

function ConfirmDeleteDrawer({
  title,
  count,
  t,
  onCancel,
  onConfirm,
}: {
  title: string;
  count: number;
  t: TFunc;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Drawer
      className="tv-playback-settings-drawer download-quality-drawer"
      ariaLabel={t("pages.downloads.confirmDeleteTitle", { title })}
      kicker={t("pages.downloads.title")}
      title={t("pages.downloads.confirmDeleteTitle", { title })}
      closeLabel={t("pages.downloads.closeConfirm")}
      onClose={onCancel}
    >
      <p>{t("pages.downloads.confirmDeleteBody", { count })}</p>
      <div className="tv-playback-settings-actions">
        <button type="button" onClick={onCancel}>
          {t("pages.downloads.cancel")}
        </button>
        <button type="button" className="is-primary" onClick={onConfirm}>
          {t("pages.downloads.delete")}
        </button>
      </div>
    </Drawer>
  );
}

/**
 * The `/downloads` nav destination: this profile's offline downloads,
 * grouped into Active/Needs-attention/Downloaded sections, with a right-hand
 * preview panel (matching every other library-style page's list+preview
 * layout) showing the currently-focused row's richer detail plus this
 * device's storage usage. Unlike most of the app, this page is explicitly
 * *not* offline-soft-gated -- browsing and playing already-downloaded titles
 * is the entire point of being offline, so this page (and the player, for a
 * downloaded item) keeps working with no network at all: the preview panel
 * falls back to the download record's own flat title/subtitle whenever
 * there's no connection (or the enrichment fetch hasn't resolved yet)
 * instead of blocking or erroring.
 */
export function DownloadsPage() {
  const { t } = useLanguage();
  const online = useOnlineStatus();
  const client = useApiClient();
  const {
    downloads,
    storageUsage,
    storageSupported,
    downloadStorageAvailable,
    retry,
    remove,
    pause,
    resume,
    notifications,
    updateKeepUntil,
    changeQuality,
    canDownload,
  } = useDownloads();
  useDocumentTitle(t("pages.downloads.title"));

  // Back from a title opened out of the list lands on the same row (audit A19).
  const navigationLayer = useNavigationLayer(`downloads:${downloads.length}`, true, canDownload === true);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusedDetail, setFocusedDetail] = useState<WorkDetail | null>(null);
  const [editingRecords, setEditingRecords] = useState<DownloadRecord[] | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const [deleting, setDeleting] = useState<{ records: DownloadRecord[]; title: string } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<DownloadFilters>(DEFAULT_DOWNLOAD_FILTERS);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // A series or season applies an action to everything inside it: the controls pass every id.
  const handlers: RowHandlers = {
    onPause: (ids) => ids.forEach((id) => pause(id)),
    onResume: (ids) => ids.forEach((id) => resume(id)),
    onRemove: (ids) => ids.forEach((id) => void remove(id)),
    onRetry: (id) => void retry(id),
    onEdit: setEditingRecords,
    onDelete: (records, title) => setDeleting({ records, title }),
    onFocusRow: setFocusedId,
  };

  const confirmEditKeepUntil = (keepUntil: DownloadKeepUntilPolicy, quality: { qualityId: string; qualityLabel: string } | null) => {
    if (!editingRecords) return;
    setEditingBusy(true);
    // A new quality re-converts through a new ticket; a record already at it only takes the keep-until.
    void Promise.all(
      editingRecords.map((record) =>
        quality && record.qualityId !== quality.qualityId
          ? changeQuality(record.id, quality, keepUntil).then(() => undefined)
          : updateKeepUntil(record.id, keepUntil)
      )
    ).catch(() => undefined).finally(() => {
      setEditingBusy(false);
      setEditingRecords(null);
    });
  };

  const visible = filterAndSortDownloads(downloads, filters);
  const tree = buildDownloadTree(visible);
  const seriesItems = tree.filter((item): item is Extract<DownloadListItem, { type: "series" }> => item.type === "series");
  const flat = tree.flatMap((item) => (item.type === "record" ? [item.record] : []));
  const active = flat.filter((record) => isRunning(record) || record.status === "paused");
  const needsAttention = flat.filter(isFailed);
  const completed = flat.filter((record) => record.status === "ready");
  const orderedDownloads = [...seriesItems.flatMap((item) => item.series.records), ...active, ...needsAttention, ...completed];

  const focused =
    orderedDownloads.find((record) => record.id === focusedId) ?? orderedDownloads[0] ?? null;
  const focusedWorkId = focused?.workId ?? null;

  const storageLabel =
    storageSupported && storageUsage
      ? t("pages.downloads.storageUsed", {
          used: formatBytes(storageUsage.usageBytes),
          quota: formatBytes(storageUsage.quotaBytes),
        })
      : "";
  const storagePercent =
    storageUsage && storageUsage.quotaBytes > 0
      ? Math.min(100, Math.round((storageUsage.usageBytes / storageUsage.quotaBytes) * 100))
      : null;

  // Enriches the focused row with its full catalog `WorkDetail` (genre/year/
  // overview/artwork, and -- for a series/site episode -- its season/episode
  // context) whenever it's reachable. Deliberately skipped while offline;
  // the render below falls back to the download record's own flat fields
  // rather than erroring, per this page's offline-exempt design above.
  useEffect(() => {
    if (!focusedWorkId || !online) {
      setFocusedDetail(null);
      return;
    }
    let cancelled = false;
    setFocusedDetail(null);
    client
      .getWork(focusedWorkId)
      .then((detail) => {
        if (!cancelled) setFocusedDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setFocusedDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, focusedWorkId, online]);

  const focusedPreview: FocusedPreview | null = focused
    ? (() => {
        const detail =
          focusedDetail && focusedDetail.work.id === focused.workId ? focusedDetail : null;
        const episode = detail ? findFocusedEpisode(detail, focused.mediaFileId) : null;
        return { detail, episode };
      })()
    : null;

  // `null` (not yet resolved) is a genuinely distinct state from `false`
  // (confirmed no access): show a loading state, not the 404, while it's
  // still in flight -- mirrors the exact tv-compact-loading pattern
  // Home.tsx/Library.tsx/Playlists.tsx already use for their own initial
  // loads. Never the real content during this window either. Applies to
  // both `canDownload` (server grant) and `downloadStorageAvailable`
  // (device/browser managed-storage capability) -- either one still being
  // in flight means it's too early to decide.
  if (canDownload === null || downloadStorageAvailable === null) {
    return (
      <PageLayout
        pageId="downloads"
        className="tv-library tv-downloads"
        ariaLabel={t("pages.downloads.title")}
        header={{ title: t("pages.downloads.title"), back: { label: t("pages.downloads.backToHome"), to: "/" } }}
        state={{ kind: "loading", skeleton: "rows", label: t("pages.downloads.preparingLabel") }}
      />
    );
  }

  // Defense in depth: the nav item is already hidden without this grant,
  // but a direct navigation (bookmark, typed URL) should still land on the
  // same 404 an address that never existed would -- not a redirect (which
  // would confirm "this route exists, you're just not allowed"). A device
  // that can't do managed storage (`downloadStorageAvailable === false`) is
  // 404'd the same way as no `canDownload` grant: there's nothing for this
  // in-app Downloads list to manage on that device.
  if (canDownload === false || downloadStorageAvailable === false) {
    return <NotFoundPage />;
  }

  return (
    <PageLayout
      pageId="downloads"
      className="tv-library tv-downloads"
      ariaLabel={t("pages.downloads.title")}
      backdrop={{
        artKey: focused?.id,
        art: focusedPreview?.detail ? (
          <CachedArtworkImage
            work={focusedPreview.detail.work}
            kinds={["backdrop", "poster"]}
            alt=""
            fallback={<span>{focusedPreview.detail.work.title}</span>}
          />
        ) : undefined,
      }}
      header={{
        title: t("pages.downloads.title"),
        back: { label: t("pages.downloads.backToHome"), to: "/" },
        actions: [
          ...(online ? [] : [{ kind: "status" as const, id: "offline", label: t("pages.downloads.offline") }]),
          {
            kind: "filters" as const,
            label: t("pages.downloads.filters"),
            open: filtersOpen,
            onToggle: () => setFiltersOpen((open) => !open),
            controls: "downloads-filters",
            activeCount: activeFilterCount(filters),
          },
        ],
      }}
    >
      {focused ? (
        <DetailsPanel
          className="tv-library-preview tv-downloads-preview"
          key={`preview-${focused.id}`}
          eyebrow={
            focusedPreview?.detail
              ? focusedPreview.episode
                ? focusedPreview.detail.work.title
                : focusedPreview.detail.work.genres[0] ?? workDetailKindLabel(focusedPreview.detail.work, t)
              : focused.qualityLabel
          }
          title={
            focusedPreview?.detail
              ? focusedPreview.episode
                ? focusedPreview.episode.episodeTitle ??
                  t("pages.workDetail.episodeNumber", { number: focusedPreview.episode.episodeNumber })
                : focusedPreview.detail.work.title
              : focused.title
          }
          meta={
            focusedPreview?.detail ? (
              <>
                {focusedPreview.episode ? (
                  <span>
                    {`S${String(focusedPreview.episode.seasonNumber).padStart(2, "0")} · E${String(
                      focusedPreview.episode.episodeNumber
                    ).padStart(2, "0")}`}
                  </span>
                ) : null}
                {releaseYear(focusedPreview.detail.work) !== null ? (
                  <span>{releaseYear(focusedPreview.detail.work)}</span>
                ) : null}
                <span>
                  {focusedPreview.detail.work.genres.slice(0, 2).join(" · ") ||
                    workDetailKindLabel(focusedPreview.detail.work, t)}
                </span>
              </>
            ) : focused.subtitle ? (
              <span>{focused.subtitle}</span>
            ) : undefined
          }
          overview={
            focusedPreview?.detail
              ? (focusedPreview.episode?.episodeOverview ?? focusedPreview.detail.work.overview) ??
                t("pages.library.noSynopsis")
              : undefined
          }
        />
      ) : null}

      <TvRailSurface
        className="tv-rail-panel tv-library-grid-panel tv-downloads-panel"
        mode="content"
        ariaLabel={t("pages.downloads.title")}
      >
        {storageSupported && storageUsage ? (
          <div className="tv-downloads-storage-panel">
            <span>
              {storageLabel}
            </span>
            {storagePercent !== null ? (
              <div
                className="tv-download-progress tv-downloads-storage-bar"
                role="progressbar"
                aria-valuenow={storagePercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={storageLabel}
              >
                <span className="tv-download-progress-fill" style={{ width: `${storagePercent}%` }} />
              </div>
            ) : null}
          </div>
        ) : null}
        {notifications.supported && notifications.permission !== "denied" ? (
          <div className="tv-downloads-notify">
            <span>{notifications.enabled ? t("pages.downloads.notificationsOn") : t("pages.downloads.notificationsOff")}</span>
            <button type="button" onClick={() => (notifications.enabled ? notifications.disable() : void notifications.enable())}>
              {notifications.enabled ? t("pages.downloads.notificationsTurnOff") : t("pages.downloads.notificationsTurnOn")}
            </button>
          </div>
        ) : null}
        <ScrollArea axis="vertical" scrollKey="downloads:list" className="tv-downloads-content" refreshKey={`${downloads.length}:${visible.length}:${expandedKeys.size}`}>
          {downloads.length === 0 ? (
            <EmptyState
              graphic="details"
              title={t("pages.downloads.emptyTitle")}
              description={t("pages.downloads.emptyDescription")}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              graphic="details"
              title={t("pages.downloads.noMatchesTitle")}
              description={t("pages.downloads.noMatchesDescription")}
            />
          ) : (
            <>
              {seriesItems.length > 0 ? (
                <section className="tv-downloads-section">
                  <h2>{t("pages.downloads.tvShowsHeading")}</h2>
                  <ul>
                    {seriesItems.map((item) => (
                      <SeriesGroup
                        key={item.series.key}
                        series={item.series}
                        t={t}
                        handlers={handlers}
                        layer={navigationLayer}
                        expandedKeys={expandedKeys}
                        toggle={toggleGroup}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {active.length > 0 ? (
                <section className="tv-downloads-section">
                  <h2>{t("pages.downloads.activeHeading")}</h2>
                  <ul>
                    {active.map((record) => (
                      <DownloadRow key={record.id} record={record} t={t} handlers={handlers} layer={navigationLayer} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {needsAttention.length > 0 ? (
                <section className="tv-downloads-section">
                  <h2>{t("pages.downloads.needsAttentionHeading")}</h2>
                  <ul>
                    {needsAttention.map((record) => (
                      <DownloadRow key={record.id} record={record} t={t} handlers={handlers} layer={navigationLayer} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {completed.length > 0 || seriesItems.length === 0 ? (
                <section className="tv-downloads-section">
                  <h2>{t("pages.downloads.completedHeading")}</h2>
                  {completed.length > 0 ? (
                    <ul>
                      {completed.map((record) => (
                        <DownloadRow key={record.id} record={record} t={t} handlers={handlers} layer={navigationLayer} />
                      ))}
                    </ul>
                  ) : (
                    <p className="tv-downloads-section-empty">{t("pages.downloads.noCompletedYet")}</p>
                  )}
                </section>
              ) : null}
            </>
          )}
        </ScrollArea>
      </TvRailSurface>

      {editingRecords && editingRecords[0] ? (
        <EditKeepUntilDrawer
          title={editingRecords.length === 1 ? editingRecords[0].title : t("pages.downloads.editManyTitle", { count: editingRecords.length })}
          keepUntil={editingRecords[0].keepUntil}
          qualityId={editingRecords[0].qualityId}
          mediaFileId={editingRecords[0].mediaFileId}
          busy={editingBusy}
          onClose={() => setEditingRecords(null)}
          onConfirm={confirmEditKeepUntil}
        />
      ) : null}

      {deleting ? (
        <ConfirmDeleteDrawer
          title={deleting.title}
          count={deleting.records.length}
          t={t}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            deleting.records.forEach((record) => void remove(record.id));
            setDeleting(null);
          }}
        />
      ) : null}

      <FiltersDrawer
        id="downloads-filters"
        open={filtersOpen}
        kicker={t("pages.downloads.title")}
        title={t("pages.downloads.filters")}
        ariaLabel={t("pages.downloads.filtersAriaLabel")}
        closeLabel={t("pages.downloads.closeFilters")}
        onClose={() => setFiltersOpen(false)}
        footer={
          activeFilterCount(filters) > 0 ? (
            <button type="button" onClick={() => setFilters(DEFAULT_DOWNLOAD_FILTERS)}>
              {t("pages.downloads.clearFilters")}
            </button>
          ) : undefined
        }
      >
        <FilterSection title={t("pages.downloads.filterKind")}>
          <SegmentedControl
            ariaLabel={t("pages.downloads.filterKind")}
            value={filters.kind}
            onChange={(kind) => setFilters((current) => ({ ...current, kind }))}
            options={[
              { value: "all", label: t("pages.downloads.kindAll") },
              { value: "movies", label: t("pages.downloads.kindMovies") },
              { value: "tv", label: t("pages.downloads.kindTv") },
              { value: "music", label: t("pages.downloads.kindMusic") },
            ]}
          />
        </FilterSection>
        <FilterSection title={t("pages.downloads.filterStatus")}>
          <Select
            ariaLabel={t("pages.downloads.filterStatus")}
            value={filters.status}
            onChange={(status) => setFilters((current) => ({ ...current, status: status as DownloadFilters["status"] }))}
            options={[
              { value: "all", label: t("pages.downloads.statusAll") },
              { value: "downloading", label: t("pages.downloads.statusDownloading") },
              { value: "paused", label: t("pages.downloads.statusPaused") },
              { value: "done", label: t("pages.downloads.statusReady") },
              { value: "failed", label: t("pages.downloads.statusFailed") },
            ]}
          />
        </FilterSection>
        <FilterSection title={t("pages.downloads.sortBy")}>
          <SegmentedControl
            ariaLabel={t("pages.downloads.sortBy")}
            value={filters.sort}
            onChange={(sort) => setFilters((current) => ({ ...current, sort }))}
            options={[
              { value: "recent", label: t("pages.downloads.sortRecent") },
              { value: "title", label: t("pages.downloads.sortTitle") },
              { value: "size", label: t("pages.downloads.sortSize") },
            ]}
          />
        </FilterSection>
      </FiltersDrawer>
    </PageLayout>
  );
}
