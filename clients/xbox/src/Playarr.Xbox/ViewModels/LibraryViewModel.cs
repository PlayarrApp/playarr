using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// Backs <see cref="Views.LibraryPage"/>. Loads the server's catalog
    /// kinds via <see cref="IPlayarrApiClient.ListCatalogKindsAsync"/> on
    /// construction (rendered as filter tabs), then loads one page of
    /// <see cref="IPlayarrApiClient.BrowseCatalogAsync"/> results for the
    /// current kind/sort selection, reloading whenever either changes.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="SelectedSort"/>'s two values match
    /// <c>BrowseQueryParams::sort</c> on the server exactly
    /// (<c>backend/crates/playarr-api/src/catalog.rs</c>):
    /// <see cref="SortRecentlyAdded"/> (<c>"recent"</c>) for recently-added
    /// first, or <c>null</c> for the server's own default (title, ascending)
    /// -- there is no separate <c>"title"</c> wire value to send.
    /// </para>
    /// <para>
    /// Both <see cref="LoadKindsAndWorksAsync"/> and <see cref="LoadWorksAsync"/>
    /// deliberately omit <c>.ConfigureAwait(false)</c> -- see
    /// <see cref="ProfilesViewModel"/>'s remarks for why: the properties they
    /// set are read straight into XAML elements by
    /// <see cref="Views.LibraryPage"/>'s <c>Render()</c>, so their
    /// continuations must stay on the UI thread.
    /// </para>
    /// </remarks>
    public sealed class LibraryViewModel : ViewModelBase
    {
        /// <summary>Wire value for "recently added first". See this type's remarks.</summary>
        public const string SortRecentlyAdded = "recent";

        private const int PageLimit = 200;

        private readonly XboxAppEnvironment _environment;

        // The last answer per kind, sort and order: Back from a title paints the grid at once (as the web does) so the
        // remembered card can take focus straight away; the refresh only replaces it when the titles changed.
        private static readonly Dictionary<string, (IReadOnlyList<Work> Works, long? Total)> Snapshots = new Dictionary<string, (IReadOnlyList<Work>, long?)>();
        private static IReadOnlyList<WorkKind>? _kindsSnapshot;

        private string SnapshotKey() => $"{SelectedKind}|{SelectedSort}|{Reversed}|{string.Join(",", AudioLangs)}|{string.Join(",", SubtitleLangs)}";

        private IReadOnlyList<WorkKind> _kinds = Array.Empty<WorkKind>();
        private WorkKind? _selectedKind;
        private string? _selectedSort;
        private IReadOnlyList<Work> _works = Array.Empty<Work>();
        private long? _total;
        private bool _isLoadingKinds;
        private bool _isLoadingWorks;
        private string? _errorMessage;

        public LibraryViewModel(XboxAppEnvironment environment)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
            _ = LoadKindsAndWorksAsync();
        }

        /// <summary>
        /// The kinds this server actually has, for the filter tabs. Never
        /// includes an "All" entry -- that's <c>null</c> <see cref="SelectedKind"/>,
        /// a page-level concept <see cref="Views.LibraryPage"/> adds itself.
        /// </summary>
        public IReadOnlyList<WorkKind> Kinds
        {
            get => _kinds;
            private set => SetProperty(ref _kinds, value);
        }

        /// <summary><c>null</c> means "All" (no kind filter).</summary>
        public WorkKind? SelectedKind
        {
            get => _selectedKind;
            private set => SetProperty(ref _selectedKind, value);
        }

        /// <summary><see cref="SortRecentlyAdded"/>, or <c>null</c> for title ascending. See this type's remarks.</summary>
        public string? SelectedSort
        {
            get => _selectedSort;
            private set => SetProperty(ref _selectedSort, value);
        }

        /// <summary>Server total for the current kind (the web header's "N TITLES"), when the server reports it.</summary>
        public long? Total
        {
            get => _total;
            private set => SetProperty(ref _total, value);
        }

        public IReadOnlyList<Work> Works
        {
            get => _works;
            private set => SetProperty(ref _works, value);
        }

        public bool IsLoadingKinds
        {
            get => _isLoadingKinds;
            private set => SetProperty(ref _isLoadingKinds, value);
        }

        public bool IsLoadingWorks
        {
            get => _isLoadingWorks;
            private set => SetProperty(ref _isLoadingWorks, value);
        }

        /// <summary>Set when either load fails; <c>null</c> otherwise.</summary>
        public string? ErrorMessage
        {
            get => _errorMessage;
            private set => SetProperty(ref _errorMessage, value);
        }

        /// <summary>Wired to LibraryPage's kind tabs. <c>null</c> selects "All".</summary>
        public void SelectKind(WorkKind? kind)
        {
            if (SelectedKind == kind)
            {
                return;
            }

            SelectedKind = kind;
            _ = LoadWorksAsync();
        }

        /// <summary>Wired to LibraryPage's two sort buttons.</summary>
        public void SelectSort(string? sort)
        {
            if (SelectedSort == sort)
            {
                return;
            }

            SelectedSort = sort;
            _ = LoadWorksAsync();
        }

        /// <summary>Z-A / oldest first instead of the default A-Z / newest first (web Filters "Order").</summary>
        public bool Reversed { get; private set; }

        public void SelectOrder(bool reversed)
        {
            if (Reversed == reversed)
            {
                return;
            }

            Reversed = reversed;
            _ = LoadWorksAsync();
        }

        /// <summary>Web Filters "Audio language" and "Subtitle language": any number of codes each (none is "Any language").</summary>
        public List<string> AudioLangs { get; } = new List<string>();

        public List<string> SubtitleLangs { get; } = new List<string>();

        /// <summary>Toggles <paramref name="code"/> in the audio or subtitle filter; <c>null</c> clears that filter (web <c>toggleLanguage</c>).</summary>
        public void SelectLanguage(bool audio, string? code)
        {
            var list = audio ? AudioLangs : SubtitleLangs;
            if (code == null)
            {
                if (list.Count == 0)
                {
                    return;
                }

                list.Clear();
            }
            else if (!list.Remove(code))
            {
                list.Add(code);
            }

            _ = LoadWorksAsync();
        }

        /// <summary>The languages still offered for the current kind and filters (web <c>catalogLanguages</c>).</summary>
        public Task<LanguageFacets> LoadLanguagesAsync() =>
            _environment.ApiClient.GetCatalogLanguagesAsync(
                SelectedKind,
                true,
                AudioLangs.Count == 0 ? null : string.Join(",", AudioLangs),
                SubtitleLangs.Count == 0 ? null : string.Join(",", SubtitleLangs));

        /// <summary>The web's <c>languageDisplayName</c>: the culture's English name for a two-letter code, else the server's name, else the upper-case code.</summary>
        public static string LanguageName(string code, string? serverName)
        {
            try
            {
                if (code.Length == 2)
                {
                    var name = System.Globalization.CultureInfo.GetCultureInfo(code).EnglishName;
                    if (!string.IsNullOrEmpty(name) && !string.Equals(name, code, StringComparison.OrdinalIgnoreCase))
                    {
                        return name;
                    }
                }
            }
            catch (System.Globalization.CultureNotFoundException)
            {
                // Falls through to the server's name.
            }

            return string.IsNullOrEmpty(serverName) ? code.ToUpperInvariant() : serverName!;
        }

        /// <summary>Retries a failed load. Wired to LibraryPage's retry button.</summary>
        public void Retry() => _ = LoadWorksAsync();

        private async Task LoadKindsAndWorksAsync()
        {
            var haveKinds = _kindsSnapshot != null;
            if (haveKinds)
            {
                Kinds = _kindsSnapshot!;
            }

            IsLoadingKinds = !haveKinds;
            ErrorMessage = null;

            try
            {
                var kinds = await _environment.ApiClient.ListCatalogKindsAsync();
                Kinds = _kindsSnapshot = new List<WorkKind>(kinds);
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
                IsLoadingKinds = false;
            }

            await LoadWorksAsync();
        }

        private async Task LoadWorksAsync()
        {
            var key = SnapshotKey();
            var cached = Snapshots.TryGetValue(key, out var snapshot);
            if (cached)
            {
                Total = snapshot.Total;
                Works = snapshot.Works;
            }

            IsLoadingWorks = !cached;
            ErrorMessage = null;

            try
            {
                // Same first page as the web library: available titles only, title ascending (or newest first).
                var byTitle = SelectedSort == null;
                var page = await _environment.ApiClient.BrowseCatalogAsync(
                    kind: SelectedKind,
                    sort: byTitle ? "title" : "date_added",
                    limit: PageLimit,
                    availableOnly: true,
                    order: byTitle != Reversed ? "asc" : "desc",
                    audioLang: AudioLangs.Count == 0 ? null : string.Join(",", AudioLangs),
                    subtitleLang: SubtitleLangs.Count == 0 ? null : string.Join(",", SubtitleLangs));
                Total = page.Total;
                var works = new List<Work>(page.Items);
                if (byTitle)
                {
                    works.Sort(WorkLabels.CompareTitles);
                    if (Reversed)
                    {
                        works.Reverse();
                    }
                }

                // The web's card overlay: a progress line or the unseen dot (best effort: cards stay plain without it).
                await HomeViewModel.MarkWatchStateAsync(works, _environment.ApiClient.ListWatchProgressAsync());
                Snapshots[key] = (works, page.Total);
                if (!cached || !works.Select(w => w.Id).SequenceEqual(snapshot.Works.Select(w => w.Id)))
                {
                    Works = works;
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
                IsLoadingWorks = false;
            }
        }
    }
}
