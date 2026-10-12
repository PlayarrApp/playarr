using System;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Core.Playback;
using Playarr.Xbox;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// Backs <see cref="Views.WorkDetailPage"/>. Loads
    /// <see cref="IPlayarrApiClient.GetWorkAsync"/> once for the work id
    /// carried by that page's navigation parameter -- see
    /// <see cref="Views.WorkDetailPage"/>'s own remarks for why this
    /// ViewModel is constructed in that page's <c>OnNavigatedTo</c> rather
    /// than its constructor, the one deviation from
    /// <see cref="LoginViewModel"/>'s reference shape.
    /// </summary>
    /// <remarks>
    /// Most properties here are plain computed pass-throughs over the
    /// loaded <see cref="WorkDetail"/> (<see cref="Title"/>,
    /// <see cref="Overview"/>, <see cref="GenresText"/>, ...) rather than
    /// their own <c>SetProperty</c>-backed fields -- exactly the shape
    /// <see cref="LoginViewModel.PairingState"/> already uses for state it
    /// reads from elsewhere. A page's <c>Render()</c> re-reads every
    /// property on every notification regardless of which one actually
    /// changed (see <see cref="Views.LoginPage"/>'s remarks), so it is
    /// enough that <em>some</em> backing-field property
    /// (<see cref="IsLoading"/>, <see cref="ErrorMessage"/>,
    /// <see cref="SelectedSeasonIndex"/>, <see cref="SelectedEpisode"/>)
    /// actually raises <c>PropertyChanged</c> on each state transition; the
    /// computed properties don't need notifications of their own.
    /// <para>
    /// <see cref="LoadAsync"/> deliberately omits <c>.ConfigureAwait(false)</c>,
    /// unlike <c>XboxAppEnvironment</c>'s async methods (see
    /// <c>ProfilesViewModel</c>'s identical remark): this ViewModel's own
    /// continuation sets <see cref="_detail"/>, which every computed
    /// property above reads, and <see cref="Views.WorkDetailPage"/>'s
    /// <c>Render()</c> pushes those straight onto XAML elements -- so it
    /// must resume on the UI thread (the default once the awaited call's
    /// continuation isn't opted out of the UWP-installed
    /// <c>SynchronizationContext</c>), not on whatever thread-pool thread
    /// the HTTP call happened to complete on.
    /// </para>
    /// </remarks>
    public sealed class WorkDetailViewModel : ViewModelBase
    {
        private readonly XboxAppEnvironment _environment;
        private readonly Guid _workId;

        private WorkDetail? _detail;

        /// <summary>The watchlist entry for this title, when it is saved (its key removes it).</summary>
        public string? WatchlistKey { get; private set; }
        private Dictionary<Guid, WatchProgress> _progress = new Dictionary<Guid, WatchProgress>();
        private bool _isLoading;
        private string? _errorMessage;
        private int _selectedSeasonIndex = -1;
        private EpisodeDetail? _selectedEpisode;

        public WorkDetailViewModel(XboxAppEnvironment environment, Guid workId)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
            _workId = workId;
        }

        public bool IsLoading
        {
            get => _isLoading;
            private set => SetProperty(ref _isLoading, value);
        }

        /// <summary>Set when <see cref="Load"/> fails; <c>null</c> otherwise.</summary>
        public string? ErrorMessage
        {
            get => _errorMessage;
            private set => SetProperty(ref _errorMessage, value);
        }

        /// <summary>The loaded work (null until loaded).</summary>
        public Work? Work => _detail?.Work;

        public string Title => _detail?.Work.Title ?? string.Empty;

        public string Overview => _detail?.Work.Overview ?? string.Empty;

        public string GenresText => _detail is null ? string.Empty : string.Join(", ", _detail.Work.Genres);

        public WorkKind Kind => _detail?.Work.Kind ?? WorkKind.Unknown;

        public bool IsSeries => Kind == WorkKind.Series;

        public Uri? BackdropImageUrl => ResolveImage(ImageKind.Backdrop);

        public Uri? PosterImageUrl => ResolveImage(ImageKind.Poster);

        public IList<SeasonDetail> Seasons => _detail?.Children.Seasons ?? Array.Empty<SeasonDetail>();

        public int SelectedSeasonIndex
        {
            get => _selectedSeasonIndex;
            private set => SetProperty(ref _selectedSeasonIndex, value);
        }

        public IList<EpisodeDetail> Episodes
        {
            get
            {
                var seasons = Seasons;
                return SelectedSeasonIndex >= 0 && SelectedSeasonIndex < seasons.Count
                    ? seasons[SelectedSeasonIndex].Episodes
                    : Array.Empty<EpisodeDetail>();
            }
        }

        public EpisodeDetail? SelectedEpisode
        {
            get => _selectedEpisode;
            private set => SetProperty(ref _selectedEpisode, value);
        }

        /// <summary>
        /// The id a "Play" affordance would navigate <see cref="Views.PlayerPage"/>
        /// with: <see cref="WorkDetail.MediaFileId"/> directly for a movie,
        /// or <see cref="SelectedEpisode"/>'s for a series. <c>null</c>
        /// when nothing playable is resolvable yet (no file has synced).
        /// </summary>
        public Guid? PlayableMediaFileId => IsSeries ? SelectedEpisode?.MediaFileId : _detail?.MediaFileId;

        /// <summary>Where to resume the playable file: its part-watched position, or null to start from the beginning.</summary>
        public long? ResumePositionMs =>
            PlayableMediaFileId is { } id && _progress.TryGetValue(id, out var p) && p.State == WatchState.InProgress && p.PositionMs > 0 ? p.PositionMs : (long?)null;

        public bool CanPlay => PlayableMediaFileId.HasValue;

        /// <summary>A film's runtime from its media file (null for a series, or before a file has synced).</summary>
        public long? RuntimeMs => IsSeries ? null : _detail?.RuntimeMs;

        /// <summary>What a Download of the playable file records: the title, and for an episode its series, season and number.</summary>
        public Playarr.Core.Models.DownloadRecord? DownloadTemplate()
        {
            if (PlayableMediaFileId is not { } id)
            {
                return null;
            }

            var record = new Playarr.Core.Models.DownloadRecord { WorkId = _workId, MediaFileId = id, Kind = IsSeries ? "series" : "movie", Title = Title };
            if (IsSeries && SelectedEpisode is { } episode)
            {
                record.SeriesTitle = Title;
                record.Title = string.IsNullOrEmpty(episode.Episode.Title) ? Title : episode.Episode.Title!;
                record.EpisodeNumber = episode.Episode.EpisodeNumber;
                record.SeasonNumber = Seasons.FirstOrDefault(season => season.Episodes.Contains(episode))?.Season.SeasonNumber;
            }

            return record;
        }

        /// <summary>The work whose similar titles the end-of-playback screen suggests.</summary>
        public Guid WorkId => _workId;

        /// <summary>
        /// The playable episodes that follow <see cref="SelectedEpisode"/>
        /// (across seasons) -- the up-next queue handed to the player.
        /// Empty for a movie or when the selection is the last playable one.
        /// </summary>
        public IList<PlaybackQueueItem> UpNextQueue
        {
            get
            {
                if (!IsSeries || SelectedEpisode is null)
                {
                    return new List<PlaybackQueueItem>();
                }

                var queue = PlaybackQueue.FromSeries(_workId, Title, Seasons, SelectedEpisode.Episode.Id);
                if (queue.Count > 0 && queue[0].MediaFileId == SelectedEpisode.MediaFileId)
                {
                    queue.RemoveAt(0);
                }

                return queue;
            }
        }

        public async Task RefreshWatchlistAsync()
        {
            try
            {
                var list = await _environment.ApiClient.GetWatchlistAsync();
                WatchlistKey = list.Items.FirstOrDefault(i => i.Title.Sources.Any(src => src.WorkId == _workId))?.Title.TitleKey;
            }
            catch (Exception)
            {
                WatchlistKey = null;
            }
        }

        /// <summary>Adds the title to the watchlist, or removes it when it is already there.</summary>
        public async Task ToggleWatchlistAsync()
        {
            if (_detail == null)
            {
                return;
            }

            if (WatchlistKey != null)
            {
                await _environment.ApiClient.RemoveFromWatchlistAsync(WatchlistKey);
            }
            else
            {
                await _environment.ApiClient.AddToWatchlistAsync(_detail.Work);
            }

            await RefreshWatchlistAsync();
            OnPropertyChanged(nameof(WatchlistKey));
        }

        /// <summary>
        /// Loads the work once. Fire-and-forget from the page's
        /// perspective, exactly like every other screen's ViewModel in this
        /// app -- the page observes progress through
        /// <c>PropertyChanged</c> -&gt; <c>Render()</c>, not by awaiting
        /// this.
        /// </summary>
        public void Load()
        {
            _ = LoadAsync();
        }

        private async Task LoadAsync()
        {
            IsLoading = true;
            ErrorMessage = null;

            try
            {
                _detail = await _environment.ApiClient.GetWorkAsync(_workId);
                try
                {
                    _progress = (await _environment.ApiClient.ListWatchProgressAsync()).GroupBy(p => p.MediaFileId).ToDictionary(g => g.Key, g => g.First());
                }
                catch (Exception)
                {
                    // Resume points are an extra: without them the title plays from the start.
                }

                await RefreshWatchlistAsync();
                SelectDefaultSeasonAndEpisode();
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

        /// <summary>
        /// Selects season 0 (if any) and, within it, the first episode with
        /// a resolvable <see cref="EpisodeDetail.MediaFileId"/> -- falling
        /// back to the first episode outright when none has synced yet, so
        /// the episode list still shows a selection even though
        /// <see cref="CanPlay"/> stays <c>false</c> for it.
        /// </summary>
        private void SelectDefaultSeasonAndEpisode()
        {
            if (Seasons.Count == 0)
            {
                return;
            }

            // Web: a series opens on the next item to play: the episode part-watched most recently, else the one after
            // the last finished episode, else the first. Its season is selected.
            var ordered = Seasons.SelectMany((season, si) => season.Episodes.Select(e => (si, e))).Where(x => x.e.MediaFileId.HasValue).ToList();
            WatchProgress? Of((int si, EpisodeDetail e) x) => _progress.TryGetValue(x.e.MediaFileId!.Value, out var p) ? p : null;
            var resume = ordered.Where(x => Of(x)?.State == WatchState.InProgress).OrderByDescending(x => Of(x)!.UpdatedAt ?? DateTimeOffset.MinValue).Cast<(int si, EpisodeDetail e)?>().FirstOrDefault();
            if (resume == null)
            {
                var lastWatched = ordered.Where(x => Of(x)?.State == WatchState.Watched).OrderByDescending(x => Of(x)!.UpdatedAt ?? DateTimeOffset.MinValue).Cast<(int si, EpisodeDetail e)?>().FirstOrDefault();
                if (lastWatched != null)
                {
                    var at = ordered.FindIndex(x => ReferenceEquals(x.e, lastWatched.Value.e));
                    resume = at >= 0 && at + 1 < ordered.Count ? ordered[at + 1] : lastWatched;
                }
            }

            if (resume != null)
            {
                SelectedSeasonIndex = resume.Value.si;
                SelectedEpisode = resume.Value.e;
                return;
            }

            SelectedSeasonIndex = 0;
            SelectedEpisode = FirstPlayableOrFirst(Episodes);
        }

        /// <summary>Selects a season by index; re-selects its own default episode. No-op for an unchanged or out-of-range index.</summary>
        public void SelectSeason(int index)
        {
            var seasons = Seasons;
            if (index < 0 || index >= seasons.Count || index == SelectedSeasonIndex)
            {
                return;
            }

            SelectedSeasonIndex = index;
            SelectedEpisode = FirstPlayableOrFirst(Episodes);
        }

        public void SelectEpisode(EpisodeDetail episode)
        {
            SelectedEpisode = episode ?? throw new ArgumentNullException(nameof(episode));
        }

        private static EpisodeDetail? FirstPlayableOrFirst(IList<EpisodeDetail> episodes)
        {
            foreach (var episode in episodes)
            {
                if (episode.MediaFileId.HasValue)
                {
                    return episode;
                }
            }

            return episodes.Count > 0 ? episodes[0] : null;
        }

        private Uri? ResolveImage(ImageKind kind)
        {
            var url = _detail?.Work.Image(kind)?.Url;
            return string.IsNullOrEmpty(url) ? null : _environment.ApiClient.ResolveUrl(url!);
        }
    }
}
