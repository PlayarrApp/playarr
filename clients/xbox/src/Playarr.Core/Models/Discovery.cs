using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;

namespace Playarr.Core.Models
{
    /// <summary>One language in the Library filter facets: its code, display name and how many works have it.</summary>
    public sealed class LanguageFacet
    {
        [JsonProperty("code")] public string Code { get; set; } = string.Empty;

        [JsonProperty("name")] public string? Name { get; set; }

        [JsonProperty("count")] public int Count { get; set; }
    }

    public sealed class LanguageFacets
    {
        [JsonProperty("audio")] public IList<LanguageFacet> Audio { get; set; } = new List<LanguageFacet>();

        [JsonProperty("subtitle")] public IList<LanguageFacet> Subtitle { get; set; } = new List<LanguageFacet>();
    }

    /// <summary>One source's claim on a title (the library, a peer, a provider).</summary>
    public sealed class TitleSource
    {
        [JsonProperty("source")] public string Source { get; set; } = string.Empty;

        [JsonProperty("label")] public string Label { get; set; } = string.Empty;

        [JsonProperty("availability")] public string Availability { get; set; } = string.Empty;

        [JsonProperty("work_id")] public Guid? WorkId { get; set; }
    }

    /// <summary>A title the watchlist or a request refers to; it may or may not be in the library.</summary>
    public sealed class DiscoveryTitle
    {
        [JsonProperty("title_key")] public string TitleKey { get; set; } = string.Empty;

        [JsonProperty("kind")] public string Kind { get; set; } = string.Empty;

        [JsonProperty("title")] public string Title { get; set; } = string.Empty;

        [JsonProperty("year")] public int? Year { get; set; }

        [JsonProperty("poster_url")] public string? PosterUrl { get; set; }

        [JsonProperty("overview")] public string? Overview { get; set; }

        [JsonProperty("sources")] public IList<TitleSource> Sources { get; set; } = new List<TitleSource>();

        [JsonProperty("in_watchlist")] public bool InWatchlist { get; set; }

        [JsonProperty("editions")] public IList<string> Editions { get; set; } = new List<string>();

        [JsonProperty("external_refs")] public Newtonsoft.Json.Linq.JToken? ExternalRefs { get; set; }
    }

    /// <summary>What the viewer can do with a title right now: <c>play</c>, <c>resume</c>, <c>request</c>, ...</summary>
    public sealed class TitleAction
    {
        [JsonProperty("action")] public string Action { get; set; } = string.Empty;

        [JsonProperty("enabled")] public bool Enabled { get; set; }

        [JsonProperty("work_id")] public Guid? WorkId { get; set; }

        [JsonProperty("media_file_id")] public Guid? MediaFileId { get; set; }

        [JsonProperty("position_ms")] public long? PositionMs { get; set; }
    }

    public sealed class WatchlistEntry
    {
        [JsonProperty("title")] public DiscoveryTitle Title { get; set; } = new DiscoveryTitle();

        [JsonProperty("actions")] public IList<TitleAction> Actions { get; set; } = new List<TitleAction>();

        /// <summary>The first enabled Resume or Play action, as the web's primary action; null when the title cannot be played here.</summary>
        public TitleAction? PrimaryPlayAction()
        {
            TitleAction? play = null;
            foreach (var action in Actions)
            {
                if (!action.Enabled || action.MediaFileId == null)
                {
                    continue;
                }

                if (action.Action == "resume")
                {
                    return action;
                }

                if (action.Action == "play" && play == null)
                {
                    play = action;
                }
            }

            return play;
        }

        /// <summary>"2026  Library": the year then the label of each source that has the title.</summary>
        public string Caption()
        {
            var parts = new List<string>();
            if (Title.Year is { } year)
            {
                parts.Add(year.ToString(System.Globalization.CultureInfo.InvariantCulture));
            }

            foreach (var source in Title.Sources)
            {
                if (source.Label.Length > 0 && !parts.Contains(source.Label))
                {
                    parts.Add(source.Label);
                }
            }

            return string.Join("  ", parts);
        }
    }

    public sealed class WatchlistResponse
    {
        [JsonProperty("items")] public IList<WatchlistEntry> Items { get; set; } = new List<WatchlistEntry>();
    }

    /// <summary>A request for a title the library does not have yet, as shown to the signed-in viewer.</summary>
    public sealed class RequestView
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("kind")] public string Kind { get; set; } = string.Empty;

        [JsonProperty("title")] public string Title { get; set; } = string.Empty;

        [JsonProperty("year")] public int? Year { get; set; }

        [JsonProperty("status")] public string Status { get; set; } = string.Empty;

        [JsonProperty("status_note")] public string? StatusNote { get; set; }

        [JsonProperty("requested_by")] public string? RequestedBy { get; set; }
    }

    public sealed class PlaylistInfo
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("name")] public string Name { get; set; } = string.Empty;

        [JsonProperty("is_system")] public bool IsSystem { get; set; }

        [JsonProperty("media_type")] public string MediaType { get; set; } = string.Empty;
    }

    public sealed class PlaylistItem
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("work_id")] public Guid WorkId { get; set; }

        [JsonProperty("position")] public int Position { get; set; }
    }
}

namespace Playarr.Core.Models
{
    /// <summary>The title snapshot the watchlist endpoint takes (web's <c>snapshotFromWork</c>).</summary>
    public static class WatchlistSnapshot
    {
        /// <summary>Web <c>snapshotFromTitle</c>: the body of <c>POST /api/v1/watchlist</c> for a discovery title.</summary>
        public static string Json(DiscoveryTitle title)
        {
            var library = title.Sources.FirstOrDefault(source => source.Source == "library" && source.WorkId is not null);
            return new Newtonsoft.Json.Linq.JObject
            {
                ["kind"] = title.Kind,
                ["title"] = title.Title,
                ["year"] = title.Year,
                ["work_id"] = library?.WorkId,
                ["external_refs"] = title.ExternalRefs ?? new Newtonsoft.Json.Linq.JArray(),
                ["poster_url"] = title.PosterUrl,
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        public static string Json(Work work)
        {
            var refs = new Newtonsoft.Json.Linq.JArray();
            foreach (var reference in work.ExternalRefs)
            {
                refs.Add(new Newtonsoft.Json.Linq.JObject { ["provider"] = reference.Provider, ["external_id"] = reference.ExternalId });
            }

            int? year = work.ReleaseDate is { Length: >= 4 } date && int.TryParse(date.Substring(0, 4), out var y) ? y : (int?)null;
            var poster = work.Image(ImageKind.Poster)?.Url;
            var json = new Newtonsoft.Json.Linq.JObject
            {
                ["kind"] = work.Kind.ToString().ToLowerInvariant(),
                ["title"] = work.Title,
                ["year"] = year,
                ["work_id"] = work.Id,
                ["external_refs"] = refs,
                ["poster_url"] = poster,
            };
            return json.ToString(Newtonsoft.Json.Formatting.None);
        }
    }
}
