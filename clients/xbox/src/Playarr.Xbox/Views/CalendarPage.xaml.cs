using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Playarr.Core.Models;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;
using Windows.UI.Xaml.Navigation;
using CalendarView = Playarr.Core.Models.CalendarView;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web TV calendar (pages/Calendar.tsx) at 1920x1080: agenda (TV default), week and month views over
    /// <c>GET /api/v1/calendar?group=series_day</c>, with the range button (view picker), Previous, Today and Next at the
    /// top right. Status colours and pills follow lib/calendar.ts. Built in code like the other card screens.
    /// </summary>
    public sealed partial class CalendarPage : Page
    {
        private static readonly CultureInfo Uk = CultureInfo.GetCultureInfo("en-GB");
        private static Color Available => Theme.Success;
        private static readonly Color Absent = Color.FromArgb(0xFF, 0xCF, 0x31, 0x57);    // --brand

        private readonly Grid _root;
        private readonly Grid _content = new Grid();
        private readonly Button _rangeButton;
        private readonly Button _todayButton;
        private bool _todayFocused;
        private readonly HashSet<string> _types = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> _statuses = new HashSet<string>(StringComparer.Ordinal);
        private bool _monitoredOnly;
        private CalendarView _view = CalendarView.Agenda;

        /// <summary>The open view; read by the parity trace.</summary>
        internal CalendarView View => _view;
        private DateTime _anchor = ParityClock.Today;
        private IList<CalendarEntry> _entries = new List<CalendarEntry>();
        private int _loadVersion;

        public CalendarPage()
        {
            InitializeComponent();
            _root = RootGrid;
            _root.Children.Add(_content);
            var header = Ui.PageHeader(_root, "Calendar", null, () => App.Navigation.GoBack());
            Windows.UI.Xaml.Automation.AutomationProperties.SetName(header.Back, "Back to home"); // the web names it with a lower-case home here

            var controls = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 12,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 56, 77, 0),
            };
            _rangeButton = HeaderPill(string.Empty, null, 0);
            var picker = new MenuFlyout();
            foreach (var (label, view) in new[] { ("Agenda", CalendarView.Agenda), ("Week", CalendarView.Week), ("Month", CalendarView.Month) })
            {
                var item = new MenuFlyoutItem { Text = label };
                item.Click += (s, e) => { _view = view; _anchor = ParityClock.Today; Load(); };
                picker.Items.Add(item);
            }

            _rangeButton.Flyout = picker;
            controls.Children.Add(_rangeButton);
            controls.Children.Add(ArrowButton("\u2190", () => { _anchor = CalendarRules.Step(_view, _anchor, -1); Load(); }));
            _todayButton = HeaderPill("Today", () => { _anchor = ParityClock.Today; Load(); }, 90);
            controls.Children.Add(_todayButton);
            controls.Children.Add(ArrowButton("\u2192", () => { _anchor = CalendarRules.Step(_view, _anchor, 1); Load(); }));
            _root.Children.Add(controls);

            var linkButton = Ui.ActionTile(BellIcon(), "Calendar link", 151, () => CalendarLinkPanel.Open(_root));
            _root.Children.Add(linkButton);

            var filtersButton = Ui.ActionTile(Ui.FiltersIcon(), "Filters", 237, OpenFilters);
            _root.Children.Add(filtersButton);
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            if (e.Parameter is CalendarView view)
            {
                _view = view;
            }

            Load();
        }

        /// <summary>The web's header pill: bold muted text on the strong surface.</summary>
        private static Button HeaderPill(string text, Action? onClick, double minWidth)
        {
            var pill = Ui.Pill(text, onClick, minWidth);
            pill.Background = Ui.Res("PlayarrSurfaceStrong");
            pill.Content = Ui.Text(text, 14.72, new FontWeight { Weight = 720 }, "PlayarrInkSoft");
            return pill;
        }

        /// <summary>The web's round period arrow: the text arrow in the muted ink.</summary>
        private static Button ArrowButton(string arrow, Action onClick)
        {
            var button = Ui.RoundButton(string.Empty, onClick);
            button.Background = Ui.Res("PlayarrSurfaceStrong");
            LayoutExport.Tag(button, "button", arrow == "\u2190" ? "Previous" : "Next");
            LayoutExport.SetSplit(button, true);
            button.Content = new TextBlock { Text = arrow, FontSize = 14.72, FontFamily = WebFont.Face(720), FontWeight = WebFont.Weight(720), Foreground = Ui.Res("PlayarrInkSoft"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            return button;
        }

        /// <summary>The web's bell icon (icons.tsx "bell", 24 unit viewBox, 1.5 stroke).</summary>
        private static FrameworkElement BellIcon()
        {
            var canvas = new Canvas { Width = 24, Height = 24, HorizontalAlignment = HorizontalAlignment.Center };
            canvas.Children.Add(new Windows.UI.Xaml.Shapes.Path
            {
                Stroke = Ui.Res("PlayarrInkMuted"),
                StrokeThickness = 1.5,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
                Data = (Geometry)Windows.UI.Xaml.Markup.XamlBindingHelper.ConvertValue(typeof(Geometry), "M6,9 A6,6 0 0 1 18,9 C18,15 20,16 20,16 L4,16 C4,16 6,15 6,9 M10,20 A2,2 0 0 0 14,20"),
            });
            return canvas;
        }

        private async void Load()
        {
            var version = ++_loadVersion;
            var (start, end) = CalendarRules.VisibleRange(_view, _anchor);
            Ui.SetPillText(_rangeButton, RangeLabel(start, end));
            Render();

            try
            {
                // Entries are bucketed by local day, which can differ from the UTC day: pad the window by a day.
                var response = await App.Environment.ApiClient.GetCalendarAsync(start.AddDays(-1), end.AddDays(1));
                if (version != _loadVersion)
                {
                    return;
                }

                _entries = response.Entries;
            }
            catch (Exception)
            {
                if (version != _loadVersion)
                {
                    return;
                }

                // Source health is admin-only; viewers see an empty calendar rather than an error banner (owner rule).
                _entries = new List<CalendarEntry>();
            }

            Render();
        }

        private string RangeLabel(DateTime start, DateTime end) => _view == CalendarView.Month
            ? _anchor.ToString("MMM yyyy", Uk)
            : $"{(start.Month == end.Month ? start.Day.ToString(CultureInfo.InvariantCulture) : start.ToString("d MMM", Uk))} – {end.ToString("d MMM", Uk)}";

        private void Render()
        {
            _content.Children.Clear();
            var (start, end) = CalendarRules.VisibleRange(_view, _anchor);
            // All-day entries first within their day, then by time (web entrySortKey).
            var byDay = _entries
                .Select(ApplyFilters)
                .Where(entry => entry != null)
                .Select(entry => entry!)
                .GroupBy(CalendarRules.LocalDay)
                .ToDictionary(g => g.Key, g => g.OrderBy(e => CalendarRules.ReleaseInstant(e)?.UtcTicks ?? long.MinValue).ToList());
            switch (_view)
            {
                case CalendarView.Month:
                    _content.Children.Add(Month(start, end, byDay));
                    break;
                case CalendarView.Week:
                    _content.Children.Add(Week(start, byDay));
                    break;
                default:
                    _content.Children.Add(Agenda(start, end, byDay));
                    break;
            }
        }

        private void OpenFilters()
        {
            var body = new StackPanel();
            body.Children.Add(Drawer.Segmented("View", new[] { "Agenda", "Week", "Month" }, ViewOptionIndex(_view), i =>
            {
                _view = ViewFromOptionIndex(i);
                _anchor = ParityClock.Today;
                Load();
                Drawer.TryCloseCurrent();
            }));
            body.Children.Add(FilterGroup("Type", new[] { ("episode", "TV"), ("movie", "Movies"), ("album", "Music"), ("book", "Books") }, _types));
            body.Children.Add(FilterGroup("Status", new[] { ("aired", "Aired"), ("upcoming", "Upcoming"), ("downloaded", "Downloaded"), ("missing", "Missing") }, _statuses));
            body.Children.Add(Drawer.Segmented("Monitored", new[] { "All", "Monitored only" }, _monitoredOnly ? 1 : 0, i =>
            {
                _monitoredOnly = i == 1;
                Render();
                OpenFilters();
            }));
            body.Children.Add(Drawer.Action("", "Clear filters", () =>
            {
                _types.Clear();
                _statuses.Clear();
                _monitoredOnly = false;
                Render();
                Drawer.TryCloseCurrent();
            }));
            Drawer.Open(_root, "Calendar", "Filters", body);
        }

        private StackPanel FilterGroup(string title, (string Key, string Label)[] options, HashSet<string> selected)
        {
            var group = new StackPanel { Margin = new Thickness(0, 0, 0, 24) };
            var caption = Ui.Text(title.ToUpperInvariant(), 9, FontWeights.Bold, "PlayarrInkSoft", new Thickness(0, 0, 0, 10));
            caption.CharacterSpacing = 120;
            group.Children.Add(caption);

            var perRow = 2;
            var grid = new Grid { ColumnSpacing = 6, RowSpacing = 6 };
            for (var column = 0; column < perRow; column++)
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            }

            for (var row = 0; row < (options.Length + perRow - 1) / perRow; row++)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            for (var i = 0; i < options.Length; i++)
            {
                var option = options[i];
                var label = new TextBlock
                {
                    Text = option.Label,
                    FontSize = 10.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = Ui.Res(selected.Contains(option.Key) ? "PlayarrSurfaceStrong" : "PlayarrInkSoft"),
                    TextWrapping = TextWrapping.WrapWholeWords,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                var button = new Button
                {
                    Height = 56,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    CornerRadius = new CornerRadius(6),
                    Background = Ui.Res(selected.Contains(option.Key) ? "PlayarrInk" : "PlayarrSurfaceStrong"),
                    BorderBrush = Ui.Res("PlayarrLineStrong"),
                    BorderThickness = new Thickness(1),
                    Content = label,
                    FocusVisualPrimaryBrush = Theme.FocusRing,
                    FocusVisualPrimaryThickness = new Thickness(3),
                    FocusVisualSecondaryThickness = new Thickness(0),
                };
                button.Click += (s, e) =>
                {
                    if (!selected.Add(option.Key))
                    {
                        selected.Remove(option.Key);
                    }

                    var isSelected = selected.Contains(option.Key);
                    button.Background = Ui.Res(isSelected ? "PlayarrInk" : "PlayarrSurfaceStrong");
                    label.Foreground = Ui.Res(isSelected ? "PlayarrSurfaceStrong" : "PlayarrInkSoft");
                    Render();
                };
                Grid.SetColumn(button, i % perRow);
                Grid.SetRow(button, i / perRow);
                grid.Children.Add(button);
            }

            group.Children.Add(grid);
            return group;
        }

        private CalendarEntry? ApplyFilters(CalendarEntry entry)
        {
            var type = entry.MediaKind switch
            {
                "episode" => "episode",
                "movie" => "movie",
                "album" => "album",
                "book" => "book",
                _ => entry.MediaKind,
            };
            if (_types.Count > 0 && !_types.Contains(type))
            {
                return null;
            }

            var day = CalendarRules.LocalDay(entry);
            bool MatchesStatus(bool hasFile, bool monitored)
            {
                var aired = day <= ParityClock.Today;
                var matchesStatus = _statuses.Count == 0
                    || (_statuses.Contains("aired") && aired)
                    || (_statuses.Contains("upcoming") && !aired)
                    || (_statuses.Contains("downloaded") && hasFile)
                    || (_statuses.Contains("missing") && aired && !hasFile);
                return matchesStatus && (!_monitoredOnly || monitored);
            }

            if (entry.Members is not { Count: > 0 } members)
            {
                return MatchesStatus(entry.HasFile, entry.Monitored) ? entry : null;
            }

            var filteredMembers = members.Where(member => MatchesStatus(member.HasFile, member.Monitored)).ToList();
            if (filteredMembers.Count == 0)
            {
                return null;
            }

            if (filteredMembers.Count == members.Count)
            {
                return entry;
            }

            return new CalendarEntry
            {
                Id = entry.Id,
                Date = entry.Date,
                Title = entry.Title,
                Subtitle = entry.Subtitle,
                SeasonNumber = entry.SeasonNumber,
                EpisodeNumber = entry.EpisodeNumber,
                HasFile = filteredMembers.All(member => member.HasFile),
                Monitored = filteredMembers.Any(member => member.Monitored),
                MediaKind = entry.MediaKind,
                ReleaseType = entry.ReleaseType,
                ReleaseAt = entry.ReleaseAt,
                PosterUrl = entry.PosterUrl,
                Overview = entry.Overview,
                WorkId = entry.WorkId,
                Members = filteredMembers,
            };
        }

        private static int ViewOptionIndex(CalendarView view) => view switch
        {
            CalendarView.Agenda => 0,
            CalendarView.Week => 1,
            _ => 2,
        };

        private static CalendarView ViewFromOptionIndex(int index) => index switch
        {
            0 => CalendarView.Agenda,
            1 => CalendarView.Week,
            _ => CalendarView.Month,
        };

        // ---- month -------------------------------------------------------------------------------------------------

        private UIElement Month(DateTime start, DateTime end, Dictionary<DateTime, List<CalendarEntry>> byDay)
        {
            // Web month grid: 7 columns of 237.59 x 151.28 px from (153.59, 204.78), day names centred above, a "Month Year" line over it.
            const double left = 153.59, top = 204.78, colWidth = 237.59, rowHeight = 151.28;
            var weeks = (int)((end - start).TotalDays + 1) / 7;
            var canvas = new Canvas();
            var status = Ui.Text(_anchor.ToString("MMMM yyyy", Uk), 19.2, FontWeights.Normal, "PlayarrInk");
            status.LineHeight = 26;
            status.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
            LayoutExport.Tag(status, "status");
            Canvas.SetLeft(status, left);
            Canvas.SetTop(status, 163);
            canvas.Children.Add(status);
            for (var c = 0; c < 7; c++)
            {
                var header = Ui.Text(start.AddDays(c).ToString("ddd", Uk).ToUpperInvariant(), 12, FontWeights.Normal, "PlayarrInkMuted");
                header.CharacterSpacing = 80;
                header.LineHeight = 16;
                header.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
                header.Width = colWidth;
                header.TextAlignment = TextAlignment.Center;
                Canvas.SetLeft(header, left + c * colWidth);
                Canvas.SetTop(header, 181.39);
                canvas.Children.Add(header);
            }

            for (var w = 0; w < weeks; w++)
            {
                for (var c = 0; c < 7; c++)
                {
                    var day = start.AddDays(w * 7 + c);
                    byDay.TryGetValue(day, out var entries);
                    var cell = MonthCell(day, entries ?? new List<CalendarEntry>(), colWidth, rowHeight);
                    Canvas.SetLeft(cell, left + c * colWidth);
                    Canvas.SetTop(cell, top + w * rowHeight);
                    canvas.Children.Add(cell);
                }
            }

            return canvas;
        }

        private FrameworkElement MonthCell(DateTime day, List<CalendarEntry> entries, double width, double height)
        {
            var isToday = day == ParityClock.Today;
            var inMonth = day.Month == _anchor.Month;
            var cell = new Canvas { Width = width, Height = height };
            var frame = new Border
            {
                Width = width,
                Height = height,
                Child = cell,
                Background = new SolidColorBrush(inMonth
                    ? (Theme.IsLight ? Color.FromArgb(255, 251, 250, 249) : Color.FromArgb(255, 27, 24, 27))
                    : (Theme.IsLight ? Color.FromArgb(255, 239, 238, 237) : Color.FromArgb(255, 36, 31, 35))),
                BorderBrush = isToday ? Theme.FocusRing : (Brush)Application.Current.Resources["PlayarrLine"],
                BorderThickness = new Thickness(isToday ? 2 : 0.5),
            };

            var row = 0;
            foreach (var entry in entries.Take(3))
            {
                var grouped = entry.Members != null && entry.Members.Count > 1;
                var title = grouped ? $"{entry.Title} \u00b7 {entry.Members!.Count}\u00d7" : entry.Title;
                var button = new Border { Width = 226, Height = 44, CornerRadius = new CornerRadius(4) };
                LayoutExport.Tag(button, "button", $"{title}, {(entry.HasFile ? "Available" : "Missing")}");
                Canvas.SetLeft(button, 5.8);
                Canvas.SetTop(button, 1.8 + row * 45);
                cell.Children.Add(button);
                var dot = new Border { Width = 8.8, Height = 8.8, CornerRadius = new CornerRadius(4.4), Background = new SolidColorBrush(entry.HasFile ? Available : Absent) };
                Canvas.SetLeft(dot, 11.4);
                Canvas.SetTop(dot, 19.4 + row * 45);
                cell.Children.Add(dot);
                var text = Ui.Text(title, 12.48, grouped ? FontWeights.Bold : FontWeights.Normal, "PlayarrInk");
                text.MaxWidth = width - 36;
                text.TextTrimming = TextTrimming.CharacterEllipsis;
                text.LineHeight = 17;
                text.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
                Canvas.SetLeft(text, 27.4);
                Canvas.SetTop(text, 14.3 + row * 45);
                cell.Children.Add(text);
                row++;
            }

            var number = Ui.Text(day.Day.ToString(CultureInfo.InvariantCulture), 12.8, new FontWeight { Weight = 640 }, inMonth ? "PlayarrInk" : "PlayarrInkMuted");
            number.LineHeight = 18;
            number.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
            Canvas.SetLeft(number, 8.8);
            Canvas.SetTop(number, 117.9);
            cell.Children.Add(number);
            if (entries.Count > 3)
            {
                var more = Ui.Text($"+{entries.Count - 3} more", 9, FontWeights.SemiBold, "PlayarrInkSoft");
                Canvas.SetLeft(more, 40);
                Canvas.SetTop(more, 120);
                cell.Children.Add(more);
            }

            return frame;
        }

        // ---- week --------------------------------------------------------------------------------------------------

        private UIElement Week(DateTime start, Dictionary<DateTime, List<CalendarEntry>> byDay)
        {
            // Web week: 440 px day columns 20 px apart; cards 106 px tall on a 121 px pitch; day heading 16.6 px.
            var columns = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 20, Margin = new Thickness(154, 170, 48, 0) };
            for (var d = 0; d < 7; d++)
            {
                var day = start.AddDays(d);
                var column = new StackPanel { Width = 440, Spacing = 15 };
                var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
                heading.Children.Add(Ui.Text(day.ToString("dddd d MMMM", Uk), 16.6, FontWeights.SemiBold, "PlayarrInk"));
                if (day == ParityClock.Today)
                {
                    heading.Children.Add(Ui.StatusPill("TODAY", ((SolidColorBrush)Theme.FocusRing).Color));
                }

                column.Children.Add(heading);
                if (byDay.TryGetValue(day, out var entries))
                {
                    foreach (var entry in entries)
                    {
                        column.Children.Add(EntryCard(entry, 440, null, web: true));
                    }
                }

                columns.Children.Add(column);
            }

            return new ScrollViewer
            {
                Content = columns,
                HorizontalScrollMode = ScrollMode.Enabled,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
                VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
            };
        }

        // ---- agenda ------------------------------------------------------------------------------------------------

        private UIElement Agenda(DateTime start, DateTime end, Dictionary<DateTime, List<CalendarEntry>> byDay)
        {
            var root = new Grid();
            // The web's shared details panel: same left column as a library page's focused title.
            var detail = new StackPanel { Width = 380, Margin = new Thickness(ShellChrome.ContentLeft, 263, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
            root.Children.Add(detail);

            var list = new StackPanel { Width = 1033, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(783, 168.5, 0, 48), Spacing = 10 };
            CalendarEntry? first = null;
            for (var day = start; day <= end; day = day.AddDays(1))
            {
                if (!byDay.TryGetValue(day, out var entries))
                {
                    continue;
                }

                var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, list.Children.Count == 0 ? 0 : 30.5, 0, 33.5) };
                heading.Children.Add(Ui.Text(day.ToString("dddd d MMMM", Uk), 18.4, new FontWeight { Weight = 640 }, day == ParityClock.Today ? "PlayarrInkSoft" : "PlayarrInk"));
                if (day == ParityClock.Today)
                {
                    var today = Ui.StatusPill("TODAY", ((SolidColorBrush)Theme.FocusRing).Color);
                    var todayText = (TextBlock)today.Child;
                    todayText.FontSize = 11.2;
                    WebFont.Apply(todayText, 640);
                    todayText.LineHeight = 15;
                    todayText.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
                    todayText.Foreground = Ui.Res("PlayarrInkSoft");
                    today.Padding = new Thickness(9, 3, 9, 4);
                    heading.Children.Add(today);
                }

                list.Children.Add(heading);
                foreach (var entry in entries)
                {
                    first ??= entry;
                    list.Children.Add(EntryCard(entry, 1033, () => ShowAgendaDetail(detail, entry), web: true, autoHeight: true));
                }
            }

            if (first != null)
            {
                ShowAgendaDetail(detail, first);
            }

            root.Children.Add(new ScrollViewer { Content = list, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden });
            // The web opens the agenda with the Today control focused.
            if (!_todayFocused)
            {
                _todayFocused = true;
                _todayButton.Loaded += (s, e) => _todayButton.Focus(FocusState.Keyboard);
                _todayButton.Focus(FocusState.Keyboard);
            }

            return root;
        }

        /// <summary>The agenda's left panel follows focus (owner rule: no SELECT needed).</summary>
        private void ShowAgendaDetail(StackPanel detail, CalendarEntry entry)
        {
            detail.Children.Clear();
            var eyebrow = Ui.Text($"{KindLabel(entry).ToUpperInvariant()} · {ReleaseLabel(entry).ToUpperInvariant()}", 12.29, new FontWeight { Weight = 860 }, "PlayarrBrandInk");
            eyebrow.LineHeight = 16;
            eyebrow.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
            eyebrow.CharacterSpacing = 120;
            detail.Children.Add(eyebrow);
            var title = Ui.Text(entry.Title, 69.12, new FontWeight { Weight = 560 }, "PlayarrInk");
            title.HorizontalAlignment = HorizontalAlignment.Left;
            title.LineHeight = 62;
            title.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
            title.CharacterSpacing = -72;
            title.MaxLines = 3;
            title.Margin = new Thickness(0, 36.4, 0, 0);
            title.TextWrapping = TextWrapping.WrapWholeWords;
            detail.Children.Add(title);
            var when = CalendarRules.LocalDay(entry).ToString("dddd, d MMMM yyyy", Uk) + (TimeLabel(entry) is var t && t != "All day" ? " at " + t : string.Empty);
            var metaRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 13, Margin = new Thickness(0, 16.6, 0, 19) };
            if (Join(Code(entry), entry.Subtitle ?? string.Empty) is { Length: > 0 } codeLine)
            {
                metaRow.Children.Add(Ui.Text(codeLine, 13.06, new FontWeight { Weight = 600 }, "PlayarrInkSoft"));
            }

            metaRow.Children.Add(Ui.Text(when, 13.06, new FontWeight { Weight = 600 }, "PlayarrInkSoft"));
            detail.Children.Add(metaRow);
            detail.Children.Add(TonePill(entry, true));
            if (!string.IsNullOrEmpty(entry.Overview))
            {
                var overview = Ui.Text(entry.Overview!, 13.82, new FontWeight { Weight = 600 }, "PlayarrInkSoft", new Thickness(0, 23, 0, 0));
                overview.TextWrapping = TextWrapping.WrapWholeWords;
                overview.LineHeight = 22;
                overview.MaxLines = 5;
                overview.TextTrimming = TextTrimming.WordEllipsis;
                detail.Children.Add(overview);
            }

            if (entry.WorkId is { } workId)
            {
                var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, 26, 0, 0) };
                var open = Ui.Pill(entry.MediaKind == "movie" ? "Open movie" : "Open series", () => App.Navigation.Navigate(typeof(WorkDetailPage), workId), 0);
                open.Height = 58;
                open.Background = Ui.Res("PlayarrInk");
                open.Content = Ui.Text(((TextBlock)open.Content).Text, 14.72, new FontWeight { Weight = 720 }, "PlayarrSurfaceStrong");
                actions.Children.Add(open);
                var watch = Ui.Pill("+  Add to watchlist", null, 0);
                watch.Height = 58;
                watch.Content = Ui.Text("+  Add to watchlist", 14.72, new FontWeight { Weight = 900 }, "PlayarrInkSoft");
                watch.Click += async (s, e) =>
                {
                    try
                    {
                        await App.Environment.ApiClient.AddToWatchlistAsync((await App.Environment.ApiClient.GetWorkAsync(workId)).Work);
                    }
                    catch (Exception)
                    {
                        // Left as it was: the pill only adds.
                    }
                };
                actions.Children.Add(watch);
                detail.Children.Add(actions);
            }
        }

        // ---- shared entry card -------------------------------------------------------------------------------------

        /// <param name="web">The week view's card at the web's sizes (19 px title and line, 12.7 px meta, 40x60 poster, 106 px tall).</param>
        private FrameworkElement EntryCard(CalendarEntry entry, double width, Action? onFocus, bool web = false, bool autoHeight = false)
        {
            var card = new Button
            {
                Width = width,
                Height = autoHeight ? double.NaN : web ? 106 : 100,
                Padding = web ? new Thickness(16, 8, 12, 8) : new Thickness(16, 10, 16, 10),
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                VerticalContentAlignment = VerticalAlignment.Center,
                CornerRadius = new CornerRadius(web ? 12 : 10),
                Background = (Brush)Application.Current.Resources["PlayarrSurfaceStrong"],
                BorderBrush = (Brush)Application.Current.Resources["PlayarrLine"],
                BorderThickness = new Thickness(1),
                FocusVisualPrimaryBrush = Theme.FocusRing,
                FocusVisualPrimaryThickness = new Thickness(2),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            if (entry.WorkId is { } workId)
            {
                card.Click += (s, e) => App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }

            if (onFocus != null)
            {
                card.GotFocus += (s, e) => onFocus();
            }

            var row = new Grid { ColumnSpacing = 14 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            // Availability is the entry's left accent (owner rule: have it versus not, never the library).
            var poster = new Border { Width = web ? 40 : 34, Height = web ? 60 : 52, CornerRadius = new CornerRadius(web ? 6 : 3), Background = (Brush)Application.Current.Resources["PlayarrSurfaceSoft"] };
            if (Uri.TryCreate(entry.PosterUrl, UriKind.Absolute, out var posterUri))
            {
                poster.Child = new Image { Source = new BitmapImage(posterUri) { DecodePixelWidth = web ? 80 : 68 }, Stretch = Stretch.UniformToFill };
            }

            row.Children.Add(poster);
            var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
            text.Children.Add(Ui.Text(entry.Title, web ? 19.2 : 15, web ? new FontWeight { Weight = 640 } : FontWeights.SemiBold, "PlayarrInk"));
            var line2Text = Join(Code(entry), entry.Subtitle ?? string.Empty);
            if (!autoHeight || line2Text.Length > 0)
            {
                var line2 = Ui.Text(line2Text, web ? 19.2 : 14, FontWeights.Normal, "PlayarrInkSoft");
                line2.TextTrimming = TextTrimming.CharacterEllipsis;
                text.Children.Add(line2);
            }
            var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, autoHeight ? 5 : 3, 0, 0) };
            foreach (var part in new[] { TimeLabel(entry), ReleaseLabel(entry), KindLabel(entry) })
            {
                meta.Children.Add(Ui.Text(part, web ? 12.8 : 9, web ? FontWeights.Normal : FontWeights.SemiBold, web ? "PlayarrInkMuted" : "PlayarrInkSoft"));
            }

            meta.Children.Add(TonePill(entry, web));
            text.Children.Add(meta);
            Grid.SetColumn(text, 1);
            row.Children.Add(text);
            card.Content = row;

            var accent = new Grid();
            accent.Children.Add(card);
            accent.Children.Add(new Border
            {
                Width = web ? 4 : 3,
                Margin = web ? new Thickness(0) : new Thickness(0, 12, 0, 12),
                HorizontalAlignment = HorizontalAlignment.Left,
                CornerRadius = web ? new CornerRadius(12, 0, 0, 12) : new CornerRadius(2),
                Background = new SolidColorBrush(entry.HasFile ? Available : Absent),
                IsHitTestVisible = false,
            });
            return accent;
        }

        private static FrameworkElement TonePill(CalendarEntry entry, bool web = false) => CalendarRules.Tone(entry, ParityClock.Today) switch
        {
            CalendarTone.Available => Ui.StatusPill("Available", Available, web),
            CalendarTone.Upcoming => Ui.StatusPill("Upcoming", Theme.BrandInk, web),
            CalendarTone.Missing => Ui.StatusPill("Missing", Theme.BrandInk, web),
            _ => Ui.StatusPill("Not tracked", Theme.InkMuted, web),
        };

        private static string Code(CalendarEntry entry)
        {
            if (entry.Members != null && entry.Members.Count > 1)
            {
                return $"{entry.Members.Count} episodes · " + string.Join(", ", entry.Members.Select(m => CalendarRules.EpisodeCode(m.SeasonNumber, m.EpisodeNumber)));
            }

            return CalendarRules.EpisodeCode(entry.SeasonNumber, entry.EpisodeNumber);
        }

        private static string Join(string a, string b) =>
            string.IsNullOrEmpty(a) ? b : string.IsNullOrEmpty(b) ? a : $"{a} · {b}";

        private static string TimeLabel(CalendarEntry entry) =>
            CalendarRules.ReleaseInstant(entry) is { } at
                ? at.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture)
                : "All day";

        private static string ReleaseLabel(CalendarEntry entry) => entry.ReleaseType switch
        {
            "air" => "Airs",
            "cinema" => "In cinemas",
            "digital" => "Digital release",
            "physical" => "Physical release",
            _ => "Release",
        };

        private static string KindLabel(CalendarEntry entry) => entry.MediaKind == "movie" ? "Movies" : "Episodes";
    }
}
