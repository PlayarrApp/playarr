using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// Backs <see cref="Views.HomePage"/>. Loads the most recently added
    /// works via <see cref="IPlayarrApiClient.BrowseCatalogAsync"/>
    /// (<c>sort: "recent"</c>) on construction.
    /// </summary>
    /// <remarks>
    /// Follows the same load-on-construct, fire-and-forget shape as
    /// <see cref="ProfilesViewModel"/> -- see that type's remarks for why
    /// tile selection itself needs no ViewModel-observed state:
    /// <see cref="Views.HomePage"/> navigates to <see cref="Views.WorkDetailPage"/>
    /// directly from its tile <c>ItemClick</c> handler, and
    /// <see cref="LoadAsync"/> likewise omits <c>.ConfigureAwait(false)</c>
    /// so its continuation stays on the UI thread that <c>Render()</c>
    /// needs.
    /// </remarks>
    public sealed class HomeViewModel : ViewModelBase
    {
        private readonly XboxAppEnvironment _environment;

        private IReadOnlyList<HomeRail> _rails = Array.Empty<HomeRail>();
        private bool _isLoading;
        private string? _errorMessage;

        public HomeViewModel(XboxAppEnvironment environment)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
            _ = LoadAsync();
        }

        public IReadOnlyList<HomeRail> Rails
        {
            get => _rails;
            private set => SetProperty(ref _rails, value);
        }

        public bool IsLoading
        {
            get => _isLoading;
            private set => SetProperty(ref _isLoading, value);
        }

        /// <summary>Set when <see cref="LoadAsync"/> fails; <c>null</c> otherwise.</summary>
        public string? ErrorMessage
        {
            get => _errorMessage;
            private set => SetProperty(ref _errorMessage, value);
        }

        private static readonly TimeSpan OnDeckWait = TimeSpan.FromMilliseconds(2500);

        /// <summary>
        /// The web's On deck rail (<c>lib/onDeck.ts</c>): the most recently played part-watched titles, newest first,
        /// at most ten, one per title; a series shows the episode to resume. Null when nothing is part-watched.
        /// </summary>
        private async Task<HomeRail?> LoadOnDeckAsync(Task<IList<WatchProgress>> progressTask)
        {
            try
            {
                var progress = await progressTask;
                var seen = new HashSet<Guid>();
                var resumable = progress
                    .Where(p => p.State == WatchState.InProgress)
                    .OrderByDescending(p => p.UpdatedAt ?? DateTimeOffset.MinValue)
                    .Where(p => seen.Add(p.WorkId))
                    .Take(10)
                    .ToList();
                var details = await Task.WhenAll(resumable.Select(async p =>
                {
                    try
                    {
                        return (p, detail: await _environment.ApiClient.GetWorkAsync(p.WorkId));
                    }
                    catch (Exception)
                    {
                        return (p, detail: (WorkDetail?)null);
                    }
                }));

                var items = new List<Work>();
                foreach (var (p, detail) in details)
                {
                    if (detail == null)
                    {
                        continue;
                    }

                    var work = detail.Work;
                    work.WatchPercent = p.DurationMs > 0 ? Math.Min(100, Math.Max(0, p.PositionMs * 100.0 / p.DurationMs)) : 0;
                    if (work.Kind == WorkKind.Series || work.Kind == WorkKind.Site)
                    {
                        var found = detail.Children.Seasons
                            .SelectMany(season => season.Episodes.Select(e => (season, e)))
                            .FirstOrDefault(x => x.e.MediaFileId == p.MediaFileId);
                        if (found.e == null)
                        {
                            continue;
                        }

                        work.OnDeckEpisode = found.e.Episode;
                        work.OnDeckSeason = found.season.Season.SeasonNumber;
                    }

                    items.Add(work);
                }

                return items.Count == 0 ? null : new HomeRail { Id = "on-deck", Kind = "on-deck", Title = "On deck", Items = items };
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The web's card overlay (<c>WatchStateOverlay</c>): a part-watched title shows its progress line, a title with no
        /// watch history (or an unseen one) shows the brand dot. The most advanced state per title wins.
        /// </summary>
        internal static Task MarkWatchStateAsync(IEnumerable<HomeRail> rails, Task<IList<WatchProgress>> progressTask) =>
            MarkWatchStateAsync(rails.SelectMany(r => r.Items), progressTask);

        /// <summary>The same overlay for any list of titles (the library grid).</summary>
        internal static async Task MarkWatchStateAsync(IEnumerable<Work> works, Task<IList<WatchProgress>> progressTask)
        {
            IList<WatchProgress> rows;
            try
            {
                rows = await progressTask;
            }
            catch (Exception)
            {
                return;
            }

            int Priority(WatchState state) => state == WatchState.InProgress ? 2 : state == WatchState.Watched ? 1 : 0;
            var byWork = new Dictionary<Guid, WatchProgress>();
            foreach (var row in rows)
            {
                if (!byWork.TryGetValue(row.WorkId, out var current) || Priority(row.State) > Priority(current.State))
                {
                    byWork[row.WorkId] = row;
                }
            }

            foreach (var work in works)
            {
                if (byWork.TryGetValue(work.Id, out var row))
                {
                    if (row.State == WatchState.InProgress)
                    {
                        work.WatchPercent ??= row.DurationMs > 0 ? Math.Min(100, Math.Max(0, row.PositionMs * 100.0 / row.DurationMs)) : 0;
                    }
                    else
                    {
                        work.ShowUnwatched = row.State == WatchState.Unwatched;
                    }
                }
                else
                {
                    work.ShowUnwatched = true;
                }
            }
        }

        /// <summary>Retries a failed load. Wired to HomePage's retry button.</summary>
        public void Retry() => _ = LoadAsync();

        private async Task LoadAsync()
        {
            IsLoading = true;
            ErrorMessage = null;

            try
            {
                // The same server-computed rails the web Home renders, in the same order, led by On deck.
                var progressTask = _environment.ApiClient.ListWatchProgressAsync();
                var onDeck = LoadOnDeckAsync(progressTask);
                var response = await _environment.ApiClient.GetHomeRailsAsync();
                var rails = new List<HomeRail>(response.Rails);
                await MarkWatchStateAsync(rails, progressTask);
                // The web waits at most this long for On deck before showing the rest, then adds it when it arrives.
                var first = await Task.WhenAny(onDeck, Task.Delay(OnDeckWait));
                if (first == onDeck && onDeck.Result is { } early)
                {
                    rails.Insert(0, early);
                    onDeck = null!;
                }

                Rails = rails;
                if (onDeck != null && await onDeck is { } late)
                {
                    var withLate = new List<HomeRail>(rails);
                    withLate.Insert(0, late);
                    Rails = withLate;
                }
            }
            catch (ApiException error)
            {
                ErrorMessage = error.DisplayMessage;
            }
            catch (Exception error)
            {
                ErrorMessage = error.Message;
            }
            finally
            {
                IsLoading = false;
            }
        }
    }
}
