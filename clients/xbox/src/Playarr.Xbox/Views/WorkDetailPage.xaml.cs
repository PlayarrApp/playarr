using System;
using System.Linq;
using System.ComponentModel;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// A work's detail screen: title/overview/genres/backdrop, and for a
    /// <see cref="WorkKind.Series"/> a browsable season/episode list, with
    /// a "Play" affordance that navigates to <see cref="PlayerPage"/> once
    /// a playable media file id is resolvable.
    /// </summary>
    /// <remarks>
    /// Follows <see cref="LoginPage"/>'s established
    /// page/ViewModel/<c>Render()</c> pattern (see that type's own remarks
    /// for the full writeup), with one necessary deviation: this page takes
    /// a <see cref="Guid"/> work id as its navigation parameter, which
    /// <see cref="Frame.Navigate(Type, object)"/> only hands to
    /// <see cref="OnNavigatedTo"/> (via <c>NavigationEventArgs.Parameter</c>)
    /// -- a page's own constructor is parameterless and runs before that
    /// parameter exists. <see cref="WorkDetailViewModel"/> is therefore
    /// constructed in <see cref="OnNavigatedTo"/> rather than this page's
    /// constructor. This is safe without extra guarding because this
    /// project never sets <c>NavigationCacheMode</c>, so <see cref="Frame"/>
    /// creates a fresh page instance -- and therefore a fresh constructor
    /// call -- for every navigation to this page; <see cref="OnNavigatedTo"/>
    /// is never called twice against the same instance.
    /// </remarks>
    public sealed partial class WorkDetailPage : Page
    {
        private WorkDetailViewModel _viewModel = null!;
        private Work? _backdropWork;

        /// <summary>The title's kind once loaded; read by the parity trace.</summary>
        internal WorkKind? Kind => _viewModel?.Work?.Kind;

        public WorkDetailPage()
        {
            InitializeComponent();
            BackdropLayer.Opacity = Theme.KeyArtGroupOpacity;
            BackdropImageMaskWash.Fill = Theme.KeyArtImageMaskWash();
            BackdropFade.Fill = Theme.KeyArtStageHorizontalWash();
            BackdropVerticalFade.Fill = Theme.KeyArtVerticalWash();
            BackdropStageWashRight.Fill = Theme.KeyArtStageWashRight();
            BackdropStageWashLeft.Fill = Theme.KeyArtStageWashLeft();
            PlaybackButton = Ui.Filled(Ui.Pill("\u2637  Playback", OpenPlaybackDrawer, 142));
            PlaybackButton.Height = 64;
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);

            var workId = e.Parameter is Guid id ? id : Guid.Empty;
            _viewModel = new WorkDetailViewModel(App.Environment, workId);
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            _viewModel.Load();
            Render();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
            base.OnNavigatedFrom(e);
        }

        private void ViewModel_PropertyChanged(object sender, PropertyChangedEventArgs e) => Render();

        /// <summary>
        /// Pushes the ViewModel's current state onto this page's named
        /// elements. See <see cref="LoginPage"/>'s remarks for why this is
        /// one unconditional method rather than a per-property handler.
        /// </summary>
        private void Render()
        {
            LoadingRing.IsActive = _viewModel.IsLoading;

            var hasError = !string.IsNullOrEmpty(_viewModel.ErrorMessage);
            ErrorText.Text = _viewModel.ErrorMessage ?? string.Empty;
            ErrorText.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;

            var work = _viewModel.Work;
            // A short number stays with the next word, so "2 Fast 2 Furious" wraps as the web draws it: "2 Fast" / "2 Furious".
            TitleText.Text = System.Text.RegularExpressions.Regex.Replace(_viewModel.Title, @"(?<=^|\s)(\d{1,2}) (?=\S)", "$1\u00a0");
            LibraryText.Text = work?.Kind switch
            {
                WorkKind.Movie => "Movies",
                WorkKind.Series => "Series",
                WorkKind.Artist => "Music",
                _ => string.Empty,
            };
            SubtitleText.Text = _viewModel.Title.ToUpperInvariant();
            EyebrowText.Text = work != null && work.Genres.Count > 0 ? work.Genres[0].ToUpperInvariant() : string.Empty;
            // Web meta row: kind, year, then genres, spaced (runtime and release date need fields this client lacks).
            var meta = new System.Collections.Generic.List<string>();
            if (work != null)
            {
                meta.Add(WorkLabels.KindLabel(work.Kind));
                if (_viewModel.RuntimeMs is { } runtime && runtime > 0)
                {
                    var totalMinutes = Math.Max(1, (int)Math.Round(runtime / 60000.0)); // web formatRuntime rounds
                    meta.Add(totalMinutes >= 60 ? (totalMinutes % 60 > 0 ? $"{totalMinutes / 60}h {totalMinutes % 60}m" : $"{totalMinutes / 60}h") : $"{totalMinutes}m");
                }

                if (WorkLabels.YearRange(work) is { } years)
                {
                    meta.Add(years);
                }

                if (work.Kind != WorkKind.Series && DateTimeOffset.TryParse(work.ReleaseDate, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var released))
                {
                    meta.Add("Released " + released.ToString("d MMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-GB")));
                }

                meta.AddRange(work.Genres);
            }

            MetaText.Text = string.Join("      ", meta);
            OverviewText.Text = _viewModel.Overview;

            if (work != null && !ReferenceEquals(_backdropWork, work))
            {
                _backdropWork = work;
                BackdropLayer.Opacity = Theme.KeyArtGroupOpacity;
                Artwork.Load(BackdropImage, work, 999, new[] { ImageKind.Backdrop }, requestWidth: 780, applyKeyArtFilter: true);
            }

            RenderActions();
            PlayButton.IsEnabled = _viewModel.CanPlay;
            // In the row only for a film (a collapsed child would still add its spacing).
            var showPlayback = work?.Kind == WorkKind.Movie && _viewModel.CanPlay;
            if (showPlayback != PrimaryRow.Children.Contains(PlaybackButton))
            {
                if (showPlayback)
                {
                    PrimaryRow.Children.Insert(0, PlaybackButton);
                }
                else
                {
                    PrimaryRow.Children.Remove(PlaybackButton);
                }
            }

            PrimaryRow.Margin = new Thickness(0, _viewModel.IsSeries ? 9 : 32, 0, 0);
            if (_viewModel.IsSeries && !ReferenceEquals(ActionRow.Parent, PrimaryRow))
            {
                // The web's series page keeps Start, Add to watchlist and Add to Playlist on one row.
                ((Panel)ActionRow.Parent).Children.Remove(ActionRow);
                ActionRow.Margin = new Thickness(0);
                PrimaryRow.Children.Add(ActionRow);
            }
            PlayLabel.Text = _viewModel.ResumePositionMs is { } resumeMs
                ? "Resume from " + TimeSpan.FromMilliseconds(resumeMs).ToString(resumeMs >= 3600000 ? @"h\:mm\:ss" : @"m\:ss")
                : _viewModel.IsSeries ? PlanLabel() : "Play";

            var isMovie = work?.Kind == WorkKind.Movie && _viewModel.PlayableMediaFileId.HasValue;
            SeriesPanel.Visibility = _viewModel.IsSeries || isMovie ? Visibility.Visible : Visibility.Collapsed;
            if (isMovie)
            {
                _ = RenderChaptersAsync();
            }

            EpisodeTitleText.Visibility = Visibility.Collapsed;
            if (_viewModel.IsSeries)
            {
                RenderSeasonRails();
                ShowEpisode(_viewModel.SelectedEpisode);
            }

            if (work != null && !_viewModel.IsLoading)
            {
                EnsureCast(work);
                if (_viewModel.IsSeries)
                {
                    EnsurePlan(work);
                }
            }

            if (_focusPrimary && !_viewModel.IsLoading && work != null)
            {
                _focusPrimary = false;
                // The web puts focus on the primary action: Play for a title, the next-up episode for a series.
                FocusClaim.Start(this, () => _viewModel.IsSeries ? NextUpEpisodeContainer() : (PlayButton.IsEnabled ? PlayButton : null));
            }
        }

        private bool _focusPrimary = true;
        private ResumePlan? _plan;
        private Guid? _planFor;
        private Guid? _castFor;
        private StackPanel? _castSection;

        /// <summary>The web's series button wording follows the server's resume plan: Start, Resume or Watch again.</summary>
        private string PlanLabel() => _plan?.Action switch
        {
            null or "" or "start" => "Start",
            "restart" => "Watch again",
            _ => "Resume",
        };

        private async void EnsurePlan(Work work)
        {
            if (_planFor == work.Id)
            {
                return;
            }

            _planFor = work.Id;
            try
            {
                _plan = await App.Environment.ApiClient.GetResumePlanAsync(work.Id);
                PlayLabel.Text = PlanLabel();
                _actionsInWatchlist = null;
                RenderActions();
            }
            catch (Exception)
            {
                // An older server has no plan: the button keeps its Start label and plays the next-up episode.
            }
        }

        /// <summary>Start / Resume plays the plan's episode, or opens the chooser when the plan needs a choice; an episode card has already chosen its own.</summary>
        private void PrimaryPlay_Click(object sender, RoutedEventArgs e)
        {
            if (_viewModel.IsSeries && _plan is { NeedsChoice: true, Options: { Count: > 1 } })
            {
                OpenResumeChooser(_plan);
                return;
            }

            PlayOption(_plan?.Target, sender, e);
        }

        private void PlayOption(ResumeOption? option, object sender, RoutedEventArgs e)
        {
            if (_viewModel.IsSeries && option?.MediaFileId is { } file
                && _viewModel.Seasons.SelectMany(season => season.Episodes).FirstOrDefault(ep => ep.MediaFileId == file) is { } target)
            {
                _viewModel.SelectEpisode(target);
            }

            PlayButton_Click(sender, e);
        }

        /// <summary>The web's resume chooser: where to pick up an ambiguous series, each option with why it is offered.</summary>
        private void OpenResumeChooser(ResumePlan plan)
        {
            var body = new StackPanel();
            foreach (var option in plan.Options)
            {
                var picked = option;
                var caption = picked.Kind switch
                {
                    "unfinished" => "Unfinished",
                    "missed_episode" => "Missed episode",
                    "continue_from_last_watched" => "Continue from last watched",
                    "next_in_series" => "Next in series",
                    _ => "Start over",
                };
                var text = new StackPanel();
                text.Children.Add(Ui.Text(caption.ToUpperInvariant(), 9, FontWeights.Bold, "PlayarrInkSoft", new Thickness(0, 0, 0, 4)));
                text.Children.Add(Ui.Text(string.IsNullOrEmpty(picked.Title) ? picked.Label : picked.Label + " \u00b7 " + picked.Title, 14, FontWeights.SemiBold, "PlayarrInk"));
                if (DateTimeOffset.TryParse(picked.LastWatchedAt, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var watched))
                {
                    text.Children.Add(Ui.Text("Last watched " + watched.ToString("d MMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-GB")), 10, FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 4, 0, 0)));
                }

                if (picked.Kind == "unfinished")
                {
                    text.Children.Add(Ui.Text($"{picked.ProgressPercent}% watched", 10, FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 4, 0, 0)));
                }

                var button = new Button
                {
                    Margin = new Thickness(0, 0, 0, 10),
                    Padding = new Thickness(22, 14, 16, 14),
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    CornerRadius = new CornerRadius(6),
                    Background = Ui.Res("PlayarrSurface"),
                    BorderBrush = Ui.Res("PlayarrLine"),
                    BorderThickness = new Thickness(1),
                    Content = text,
                    FocusVisualPrimaryBrush = Theme.FocusRing,
                    FocusVisualPrimaryThickness = new Thickness(3),
                    FocusVisualSecondaryThickness = new Thickness(0),
                };
                button.Click += async (s, e) =>
                {
                    Drawer.TryCloseCurrent();
                    try
                    {
                        await App.Environment.ApiClient.RecordResumeChoiceAsync(_viewModel.WorkId, picked);
                    }
                    catch (Exception)
                    {
                        // Recording is best effort; the pick still plays.
                    }

                    PlayOption(picked, s, e);
                };
                body.Children.Add(button);
            }

            Drawer.Open((Panel)Content, "Choose where to pick up.", "Resume " + _viewModel.Title, body);
        }

        /// <summary>The web's "Ask again" pill: forgets the recorded answers and reads the plan again.</summary>
        private async void AskAgain()
        {
            try
            {
                await App.Environment.ApiClient.ClearResumeChoicesAsync(_viewModel.WorkId);
                _plan = await App.Environment.ApiClient.GetResumePlanAsync(_viewModel.WorkId);
                PlayLabel.Text = PlanLabel();
                _actionsInWatchlist = null;
                RenderActions();
            }
            catch (Exception)
            {
                // Left as it was.
            }
        }

        /// <summary>The web's Cast rail: a headshot circle (or initials) and the name under it, from the work's credits.</summary>
        private async void EnsureCast(Work work)
        {
            if (_castFor == work.Id)
            {
                return;
            }

            _castFor = work.Id;
            try
            {
                var credits = await App.Environment.ApiClient.GetWorkCreditsAsync(work.Id);
                if (credits.Cast.Count == 0)
                {
                    return;
                }

                var list = new ListView
                {
                    SelectionMode = ListViewSelectionMode.None,
                    Height = 190,
                    ItemContainerStyle = CatalogTileFactory.CardContainerStyle,
                };
                ScrollViewer.SetHorizontalScrollBarVisibility(list, ScrollBarVisibility.Hidden);
                ScrollViewer.SetHorizontalScrollMode(list, ScrollMode.Enabled);
                ScrollViewer.SetVerticalScrollMode(list, ScrollMode.Disabled);
                list.ItemsPanel = (ItemsPanelTemplate)Windows.UI.Xaml.Markup.XamlReader.Load(
                    "<ItemsPanelTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'>" +
                    "<ItemsStackPanel Orientation='Horizontal' /></ItemsPanelTemplate>");
                foreach (var credit in credits.Cast.Take(12))
                {
                    list.Items.Add(CastCard(credit));
                }

                CardFocus.Attach(list);
                var section = new StackPanel { Margin = new Thickness(0, _viewModel.IsSeries ? 44 : 60, 0, 0) };
                section.Children.Add(new TextBlock { Text = "Cast", Style = (Style)Application.Current.Resources["PlayarrRailTitle"] });
                section.Children.Add(new TextBlock
                {
                    Text = credits.Cast.Count == 1 ? "1 person" : $"{credits.Cast.Count} people",
                    FontSize = 10,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"],
                    Margin = new Thickness(0, 6, 0, 36),
                });
                section.Children.Add(list);
                _castSection = section;
                AppendCast();
            }
            catch (Exception)
            {
                // No Cast rail when the credits cannot be read.
            }
        }

        /// <summary>Re-adds the Cast rail after a rail rebuild cleared the panel.</summary>
        private void AppendCast()
        {
            if (_castSection != null && !SeriesPanel.Children.Contains(_castSection))
            {
                SeriesPanel.Visibility = Visibility.Visible;
                SeriesPanel.Children.Add(_castSection);
            }
        }

        private static FrameworkElement CastCard(Credit credit)
        {
            var circle = new Grid { Width = 104, Height = 104, HorizontalAlignment = HorizontalAlignment.Center };
            circle.Children.Add(new Windows.UI.Xaml.Shapes.Ellipse { Fill = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrSurfaceSoft"] });
            var initials = string.Concat(credit.Person.Name.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries).Take(2).Select(w => w.Substring(0, 1))).ToUpperInvariant();
            circle.Children.Add(new TextBlock { Text = initials, FontSize = 34, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Foreground = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"] });
            if (!string.IsNullOrEmpty(credit.Person.HeadshotUrl))
            {
                var photo = new Windows.UI.Xaml.Shapes.Ellipse();
                circle.Children.Add(photo);
                _ = LoadHeadshotAsync(photo, credit.Person.Id);
            }

            var root = new StackPanel { Width = 152, Tag = credit };
            root.Children.Add(circle);
            root.Children.Add(new TextBlock { Text = credit.Person.Name, FontSize = 12, FontWeight = FontWeights.SemiBold, TextAlignment = TextAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(0, 12, 0, 0) });
            if (!string.IsNullOrEmpty(credit.Character))
            {
                root.Children.Add(new TextBlock { Text = credit.Character, FontSize = 10, TextAlignment = TextAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, Foreground = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"] });
            }

            return root;
        }

        private static async System.Threading.Tasks.Task LoadHeadshotAsync(Windows.UI.Xaml.Shapes.Ellipse photo, Guid personId)
        {
            try
            {
                var bytes = await App.Environment.ApiClient.GetPersonArtworkAsync(personId, 240);
                using (var stream = new Windows.Storage.Streams.InMemoryRandomAccessStream())
                {
                    await stream.WriteAsync(System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsBuffer(bytes));
                    stream.Seek(0);
                    var bitmap = new BitmapImage { DecodePixelWidth = 208 };
                    await bitmap.SetSourceAsync(stream);
                    photo.Fill = new Windows.UI.Xaml.Media.ImageBrush { ImageSource = bitmap, Stretch = Windows.UI.Xaml.Media.Stretch.UniformToFill };
                }
            }
            catch (Exception)
            {
                // The initials stay.
            }
        }
        private Guid? _chaptersFor;

        /// <summary>
        /// A film's Chapters rail (web <c>MovieChapterTrack</c>): the file's own chapters, else a marker every 5 to 30 minutes
        /// so about ten cover the runtime; each card shows a frame at its start and plays from there.
        /// </summary>
        private async System.Threading.Tasks.Task RenderChaptersAsync()
        {
            if (_viewModel.PlayableMediaFileId is not { } file || _chaptersFor == file)
            {
                return;
            }

            _chaptersFor = file;
            System.Collections.Generic.List<MediaChapter> chapters;
            try
            {
                chapters = (await App.Environment.ApiClient.GetMediaChaptersAsync(file)).ToList();
            }
            catch (Exception)
            {
                chapters = new System.Collections.Generic.List<MediaChapter>();
            }

            var real = chapters.Count > 0;
            if (!real && _viewModel.RuntimeMs is { } runtimeMs && runtimeMs > 0)
            {
                var interval = new[] { 5, 10, 15, 20, 30 }.Select(m => m * 60000L).FirstOrDefault(c => c >= runtimeMs / 10.0);
                interval = interval == 0 ? 30 * 60000L : interval;
                var count = (int)Math.Max(1, (runtimeMs + interval - 1) / interval);
                chapters = Enumerable.Range(0, count).Select(i => new MediaChapter { Index = i, StartMs = i * interval, Title = $"Chapter {i + 1}" }).ToList();
            }

            if (chapters.Count == 0 || _chaptersFor != file)
            {
                return;
            }

            SeriesPanel.Children.Clear();
            var list = new ListView
            {
                SelectionMode = ListViewSelectionMode.None,
                IsItemClickEnabled = true,
                Height = 210,
                ItemContainerStyle = CatalogTileFactory.CardContainerStyle,
            };
            ScrollViewer.SetHorizontalScrollBarVisibility(list, ScrollBarVisibility.Hidden);
            ScrollViewer.SetHorizontalScrollMode(list, ScrollMode.Enabled);
            ScrollViewer.SetVerticalScrollMode(list, ScrollMode.Disabled);
            list.ItemsPanel = (ItemsPanelTemplate)Windows.UI.Xaml.Markup.XamlReader.Load(
                "<ItemsPanelTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'>" +
                "<ItemsStackPanel Orientation='Horizontal' /></ItemsPanelTemplate>");
            foreach (var chapter in chapters)
            {
                list.Items.Add(ChapterCard(file, chapter));
            }

            list.ItemClick += (s, e) =>
            {
                if (e.ClickedItem is FrameworkElement { Tag: MediaChapter chapter })
                {
                    App.Navigation.Navigate(typeof(PlayerPage), new PlayerNavigationParameter(file, resumePositionMs: chapter.StartMs, title: _viewModel.Title, workId: _viewModel.WorkId));
                }
            };
            CardFocus.Attach(list);
            var section = new StackPanel { Margin = new Thickness(0, 195, 0, 0) };
            section.Children.Add(new TextBlock { Text = "Chapters", Style = (Style)Application.Current.Resources["PlayarrRailTitle"] });
            section.Children.Add(new TextBlock
            {
                Text = real ? $"{chapters.Count} chapters" : $"{chapters.Count} scene markers",
                FontSize = 10,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"],
                Margin = new Thickness(0, 6, 0, 36),
            });
            section.Children.Add(list);
            SeriesPanel.Children.Add(section);
            AppendCast();
        }

        private static FrameworkElement ChapterCard(Guid file, MediaChapter chapter)
        {
            var art = new Grid
            {
                Width = 268,
                Height = 151,
                CornerRadius = new CornerRadius(12),
                Background = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrSurfaceSoft"],
            };
            var frame = new Image { Stretch = Windows.UI.Xaml.Media.Stretch.UniformToFill };
            art.Children.Add(frame);
            _ = LoadFrameAsync(frame, file, chapter.StartMs);
            art.Children.Add(new TextBlock
            {
                Text = (chapter.Index + 1).ToString("00", System.Globalization.CultureInfo.InvariantCulture),
                FontSize = 22,
                FontWeight = FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 12, 8),
            });
            var clock = TimeSpan.FromMilliseconds(chapter.StartMs);
            var caption = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(2, 10, 0, 0) };
            caption.Children.Add(new TextBlock { Text = clock.TotalHours >= 1 ? $"{(int)clock.TotalHours}:{clock.Minutes:00}:{clock.Seconds:00}" : $"{clock.Minutes}:{clock.Seconds:00}", FontSize = 9, FontWeight = FontWeights.SemiBold, Foreground = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"], VerticalAlignment = VerticalAlignment.Center });
            caption.Children.Add(new TextBlock { Text = chapter.Title ?? $"Chapter {chapter.Index + 1}", FontSize = 12, FontWeight = FontWeights.SemiBold, MaxWidth = 200, TextTrimming = TextTrimming.CharacterEllipsis });
            var root = new StackPanel { Width = 268, Tag = chapter };
            root.Children.Add(art);
            root.Children.Add(caption);
            return root;
        }

        private static async System.Threading.Tasks.Task LoadFrameAsync(Image image, Guid file, long positionMs)
        {
            try
            {
                var bytes = await App.Environment.ApiClient.GetMediaThumbnailAsync(file, positionMs);
                if (bytes.Length == 0)
                {
                    return;
                }

                using (var stream = new Windows.Storage.Streams.InMemoryRandomAccessStream())
                {
                    await stream.WriteAsync(System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsBuffer(bytes));
                    stream.Seek(0);
                    var bitmap = new Windows.UI.Xaml.Media.Imaging.BitmapImage();
                    await bitmap.SetSourceAsync(stream);
                    image.Source = bitmap;
                }
            }
            catch (Exception)
            {
                // A card without its frame still plays from its chapter.
            }
        }
        private bool? _actionsInWatchlist;
        private Button? _downloadPill;
        private Button PlaybackButton { get; }

        /// <summary>The web's Playback settings drawer: the viewer's remembered quality, audio and subtitle choices for this file.</summary>
        private async void OpenPlaybackDrawer()
        {
            if (_viewModel.PlayableMediaFileId is not { } file)
            {
                return;
            }

            try
            {
                var options = await App.Environment.ApiClient.GetMediaPlaybackOptionsAsync(file);
                ShowPlaybackDrawer(file, options, options.Preferences);
            }
            catch (Exception)
            {
                // No drawer when the options cannot be read: the pill stays, as the web's does.
            }
        }

        private void ShowPlaybackDrawer(Guid file, MediaPlaybackOptions options, MediaPlaybackPreferences chosen)
        {
            // A pick re-opens the drawer so the filled segment follows it. Index 0 of Audio and Subtitles is "Automatic" / "Off" (a null id).
            void Pick(Action change) { change(); Drawer.TryCloseCurrent(); ShowPlaybackDrawer(file, options, chosen); }
            int Find(System.Collections.Generic.IList<PlaybackChoice> list, string? id) => id == null ? 0 : 1 + Math.Max(0, list.ToList().FindIndex(o => o.Id == id));
            var body = new StackPanel();
            body.Children.Add(Drawer.Choice("Quality", options.QualityOptions.Select(o => o.Label).ToArray(),
                Math.Max(0, options.QualityOptions.ToList().FindIndex(o => o.Id == chosen.QualityId)), i => Pick(() => chosen.QualityId = options.QualityOptions[i].Id)));
            body.Children.Add(Drawer.Choice("Audio", new[] { "Automatic" }.Concat(options.AudioTracks.Select(o => o.Label)).ToArray(),
                Find(options.AudioTracks, chosen.AudioTrackId), i => Pick(() => chosen.AudioTrackId = i == 0 ? null : options.AudioTracks[i - 1].Id)));
            body.Children.Add(Drawer.Choice("Subtitles", new[] { "Off" }.Concat(options.SubtitleTracks.Select(o => o.Label)).ToArray(),
                Find(options.SubtitleTracks, chosen.SubtitleTrackId), i => Pick(() => chosen.SubtitleTrackId = i == 0 ? null : options.SubtitleTracks[i - 1].Id)));
            body.Children.Add(Drawer.Action("\uE74E", "Save", async () =>
            {
                try
                {
                    await App.Environment.ApiClient.SaveMediaPlaybackPreferencesAsync(file, chosen);
                }
                catch (Exception)
                {
                    // Left as it was.
                }

                Drawer.TryCloseCurrent();
            }));
            Drawer.Open((Panel)Content, "Movie", "Playback settings", body);
        }

        /// <summary>The web's secondary pills under the primary action: watchlist toggle and Add to Playlist.</summary>
        private void RenderActions()
        {
            if (_viewModel.Work == null || _viewModel.IsLoading)
            {
                return;
            }

            var inWatchlist = _viewModel.WatchlistKey != null;
            if (_actionsInWatchlist == inWatchlist)
            {
                return;
            }

            _actionsInWatchlist = inWatchlist;
            ActionRow.Children.Clear();
            ActionRow.Visibility = Visibility.Visible;
            if (_viewModel.IsSeries && _plan is { Action: not ("start" or "") } && !string.IsNullOrEmpty(_plan.Action))
            {
                var ask = Ui.Filled(Ui.Pill("\u21ba  Ask again", AskAgain));
                ask.Height = 64;
                ask.MinWidth = 142;
                ActionRow.Children.Add(ask);
            }

            var download = Ui.Filled(Ui.Pill("Download", null));
            download.Click += async (s, e) =>
            {
                var template = _viewModel.DownloadTemplate();
                if (template == null)
                {
                    return;
                }

                var service = Services.DownloadService.Instance;
                await service.LoadAsync();
                if (service.ForMediaFile(template.MediaFileId) is { } existing)
                {
                    Ui.SetPillText(download, existing.State == Playarr.Core.Models.DownloadState.Ready ? "Downloaded" : "Downloading\u2026");
                    return;
                }

                try
                {
                    Ui.SetPillText(download, "Downloading\u2026");
                    await service.StartAsync(template);
                }
                catch (Exception)
                {
                    Ui.SetPillText(download, "Download failed");
                }
            };
            // The web puts Download first in the film's primary row; a series has none there.
            if (_downloadPill != null)
            {
                PrimaryRow.Children.Remove(_downloadPill);
            }

            _downloadPill = null;
            if (_viewModel.Work?.Kind == WorkKind.Movie)
            {
                download.Height = 64;
                download.MinWidth = 142;
                _downloadPill = download;
                PrimaryRow.Children.Insert(0, download);
            }
            var watch = Ui.Filled(Ui.Pill(inWatchlist ? "\u2713  Remove from watchlist" : "+  Add to watchlist", null));
            watch.Click += async (s, e) =>
            {
                try
                {
                    await _viewModel.ToggleWatchlistAsync();
                }
                catch (Exception)
                {
                    // Left as it was: the pill still shows the real state.
                }

                RenderActions();
            };
            watch.Height = 64;
            watch.MinWidth = 142;
            ActionRow.Children.Add(watch);
            var playlist = Ui.Filled(Ui.Pill("+  Add to Playlist", OpenPlaylistDrawer));
            playlist.Height = 64;
            playlist.MinWidth = 142;
            ActionRow.Children.Add(playlist);
        }

        private async void OpenPlaylistDrawer()
        {
            if (_viewModel.Work is not { } work)
            {
                return;
            }

            try
            {
                var playlists = await App.Environment.ApiClient.ListPlaylistsAsync();
                var body = new StackPanel();
                foreach (var info in playlists.Where(p => !p.IsSystem))
                {
                    var id = info.Id;
                    body.Children.Add(Drawer.Action("\uE710", info.Name, async () =>
                    {
                        try
                        {
                            await App.Environment.ApiClient.AddToPlaylistAsync(id, work.Id);
                        }
                        catch (Exception)
                        {
                        }

                        Drawer.TryCloseCurrent();
                    }));
                }

                Drawer.Open((Panel)Content, "Add to Playlist", work.Title, body);
            }
            catch (Exception)
            {
            }
        }

        private Control? NextUpEpisodeContainer()
        {
            var target = _viewModel.SelectedEpisode;
            foreach (var section in SeriesPanel.Children)
            {
                if (section is StackPanel { Children: { Count: > 0 } kids } && kids[kids.Count - 1] is ListView list)
                {
                    foreach (var item in list.Items)
                    {
                        if (item is FrameworkElement { Tag: EpisodeDetail episode } && ReferenceEquals(episode, target) && list.ContainerFromItem(item) is Control container)
                        {
                            return container;
                        }
                    }
                }
            }

            return null;
        }

        /// <summary>Web series page: one rail per season of 268x151 episode thumbnails with the number overlaid.</summary>
        private void RenderSeasonRails()
        {
            SeriesPanel.Children.Clear();
            foreach (var season in _viewModel.Seasons)
            {
                var list = new ListView
                {
                    SelectionMode = ListViewSelectionMode.None,
                    IsItemClickEnabled = true,
                    Height = 210,
                    ItemContainerStyle = CatalogTileFactory.CardContainerStyle,
                };
                // Match the web episode rail's compensated 12 px top bleed without moving cards or season rails.
                CardFocus.ReserveTopLiftRoom(list, 12);
                ScrollViewer.SetHorizontalScrollBarVisibility(list, ScrollBarVisibility.Hidden);
                ScrollViewer.SetHorizontalScrollMode(list, ScrollMode.Enabled);
                ScrollViewer.SetVerticalScrollMode(list, ScrollMode.Disabled);
                list.ItemsPanel = (ItemsPanelTemplate)Windows.UI.Xaml.Markup.XamlReader.Load(
                    "<ItemsPanelTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'>" +
                    "<ItemsStackPanel Orientation='Horizontal' /></ItemsPanelTemplate>");
                foreach (var episode in season.Episodes)
                {
                    list.Items.Add(EpisodeCard(_viewModel.Work, season.Season.SeasonNumber, episode));
                }

                list.ItemClick += (s, e) =>
                {
                    if (e.ClickedItem is FrameworkElement { Tag: EpisodeDetail episode })
                    {
                        _viewModel.SelectEpisode(episode);
                        PlayButton_Click(this, new RoutedEventArgs());
                    }
                };
                CardFocus.Attach(list);
                list.GotFocus += (s, e) =>
                {
                    if (e.OriginalSource is ListViewItem { Content: FrameworkElement { Tag: EpisodeDetail episode } })
                    {
                        ShowEpisode(episode);
                    }
                };

                var section = new StackPanel { Margin = new Thickness(0, 14, 0, 11) };
                section.Children.Add(new TextBlock { Text = SeasonLabel(season), Style = (Style)Application.Current.Resources["PlayarrRailTitle"] });
                section.Children.Add(new TextBlock
                {
                    Text = $"{season.Episodes.Count} episodes",
                    FontSize = 10,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"],
                    Margin = new Thickness(0, 6, 0, 33),
                });
                section.Children.Add(list);
                SeriesPanel.Children.Add(section);
            }

            AppendCast();
        }

        private static FrameworkElement EpisodeCard(Work? series, int seasonNumber, EpisodeDetail detail)
        {
            var episode = detail.Episode;
            var art = new Grid
            {
                Width = 268,
                Height = 151,
                CornerRadius = new CornerRadius(12),
                Background = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrSurfaceSoft"],
            };
            if (series != null)
            {
                var diagnosticCard = EpisodeArtworkDiagnostics.NewCard();
                var still = new Image { Width = 268, Height = 151, Stretch = Windows.UI.Xaml.Media.Stretch.UniformToFill };
                var requested = false;
                var watchingViewport = false;
                Windows.Foundation.TypedEventHandler<FrameworkElement, EffectiveViewportChangedEventArgs> viewportChanged = null!;
                Action startWatchingViewport = null!;
                Action stopWatchingViewport = null!;
                viewportChanged = (_, args) =>
                {
                    var viewport = args.EffectiveViewport;
                    var intersects = EpisodeArtworkResolver.IntersectsCard(
                        viewport.X,
                        viewport.Y,
                        viewport.Width,
                        viewport.Height,
                        still.ActualWidth,
                        still.ActualHeight);
                    EpisodeArtworkDiagnostics.Viewport(
                        diagnosticCard,
                        viewport.X,
                        viewport.Y,
                        viewport.Width,
                        viewport.Height,
                        still.ActualWidth,
                        still.ActualHeight,
                        art.ActualWidth,
                        art.ActualHeight,
                        intersects,
                        requested);
                    if (requested || !intersects)
                    {
                        return;
                    }

                    EpisodeArtworkDiagnostics.RequestTransition(diagnosticCard, requested, true);
                    requested = true;
                    stopWatchingViewport();
                    Artwork.LoadEpisodeCard(still, series, episode, detail.MediaFileId, 268, diagnosticCard);
                };
                startWatchingViewport = () =>
                {
                    if (!requested && !watchingViewport)
                    {
                        still.EffectiveViewportChanged += viewportChanged;
                        watchingViewport = true;
                    }
                };
                stopWatchingViewport = () =>
                {
                    if (watchingViewport)
                    {
                        still.EffectiveViewportChanged -= viewportChanged;
                        watchingViewport = false;
                    }
                };
                still.Loaded += (_, __) =>
                {
                    EpisodeArtworkDiagnostics.ImageLoaded(diagnosticCard, still.ActualWidth, still.ActualHeight, art.ActualWidth, art.ActualHeight);
                    startWatchingViewport();
                };
                still.Unloaded += (_, __) => stopWatchingViewport();
                startWatchingViewport();
                art.Children.Add(still);
            }

            art.Children.Add(new TextBlock
            {
                Text = episode.EpisodeNumber.ToString("00", System.Globalization.CultureInfo.InvariantCulture),
                FontSize = 22,
                FontWeight = FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 12, 8),
            });

            var caption = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(2, 10, 0, 0) };
            caption.Children.Add(new TextBlock { Text = EpisodeCode(seasonNumber, episode.EpisodeNumber), FontSize = 9, FontWeight = FontWeights.SemiBold, Foreground = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"], VerticalAlignment = VerticalAlignment.Center });
            caption.Children.Add(new TextBlock { Text = episode.Title ?? string.Empty, FontSize = 12, FontWeight = FontWeights.SemiBold, MaxWidth = 200, TextTrimming = TextTrimming.CharacterEllipsis });

            var root = new StackPanel { Width = 268, Tag = detail };
            root.Children.Add(art);
            root.Children.Add(caption);
            return root;
        }

        /// <summary>The web series header follows the focused (or next) episode: "S01 · E01" eyebrow, episode title, meta.</summary>
        private void ShowEpisode(EpisodeDetail? detail)
        {
            var work = _viewModel.Work;
            if (detail == null || work == null)
            {
                return;
            }

            var seasonNumber = 0;
            foreach (var season in _viewModel.Seasons)
            {
                if (season.Episodes.Contains(detail))
                {
                    seasonNumber = season.Season.SeasonNumber;
                }
            }

            var episode = detail.Episode;
            EyebrowText.Text = EpisodeCode(seasonNumber, episode.EpisodeNumber);
            EpisodeTitleText.Text = episode.Title ?? string.Empty;
            EpisodeTitleText.Visibility = string.IsNullOrEmpty(episode.Title) ? Visibility.Collapsed : Visibility.Visible;
            var meta = new System.Collections.Generic.List<string> { $"Season {seasonNumber}", EpisodeCode(seasonNumber, episode.EpisodeNumber) };
            if (episode.RuntimeMinutes is { } minutes)
            {
                meta.Add($"{minutes} min");
            }

            if (WorkLabels.YearRange(work) is { } years)
            {
                meta.Add(years);
            }

            if (DateTimeOffset.TryParse(episode.AirDate, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var aired))
            {
                meta.Add("Aired " + aired.ToString("d MMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-GB")));
            }

            meta.AddRange(work.Genres);
            MetaText.Text = string.Join("      ", meta);
            if (!string.IsNullOrEmpty(episode.Overview))
            {
                OverviewText.Text = episode.Overview;
            }
        }

        private static string EpisodeCode(int season, int episode) =>
            $"S{season.ToString("00", System.Globalization.CultureInfo.InvariantCulture)} \u00b7 E{episode.ToString("00", System.Globalization.CultureInfo.InvariantCulture)}";

        private static string SeasonLabel(SeasonDetail season) =>
            string.IsNullOrEmpty(season.Season.Title)
                ? $"Season {season.Season.SeasonNumber}"
                : season.Season.Title!;

        private void BackButton_Click(object sender, RoutedEventArgs e) => App.Navigation.GoBack();

        private void PlayButton_Click(object sender, RoutedEventArgs e)
        {
            var mediaFileId = _viewModel.PlayableMediaFileId;
            if (mediaFileId.HasValue)
            {
                // PlayerNavigationParameter (not a bare Guid) is the real
                // contract PlayerPage.xaml.cs already established -- see
                // that type's own remarks. ResumePositionMs is left null
                // (start from the beginning): this screen doesn't fetch
                // IPlayarrApiClient.ListWatchProgressAsync, which is out
                // of this screen's scope as requested.
                var parameter = new PlayerNavigationParameter(
                    mediaFileId.Value,
                    resumePositionMs: _viewModel.ResumePositionMs,
                    title: _viewModel.Title,
                    workId: _viewModel.WorkId,
                    upNext: _viewModel.UpNextQueue);
                App.Navigation.Navigate(typeof(PlayerPage), parameter);
            }
        }
    }
}
