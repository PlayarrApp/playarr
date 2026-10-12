using System;
using System.Collections.Generic;
using System.Runtime.Serialization;
using Newtonsoft.Json;
using Playarr.Core.Networking;

namespace Playarr.Core.Models
{
    /// <summary>Server-side ticket status (<c>GET /api/v1/downloads</c>).</summary>
    [JsonConverter(typeof(TolerantEnumConverter))]
    public enum DownloadTicketStatus
    {
        Unknown = 0,

        [EnumMember(Value = "queued")] Queued,
        [EnumMember(Value = "processing")] Processing,
        [EnumMember(Value = "ready")] Ready,
        [EnumMember(Value = "failed")] Failed,
        [EnumMember(Value = "expired")] Expired,
        [EnumMember(Value = "canceled")] Canceled,
    }

    public sealed class DownloadOption
    {
        [JsonProperty("id")] public string Id { get; set; } = string.Empty;

        [JsonProperty("label")] public string Label { get; set; } = string.Empty;

        [JsonProperty("height")] public int? Height { get; set; }

        [JsonProperty("estimated_size_bytes")] public long? EstimatedSizeBytes { get; set; }

        [JsonProperty("size_is_estimate")] public bool SizeIsEstimate { get; set; }
    }

    public sealed class DownloadOptionsResponse
    {
        [JsonProperty("media_file_id")] public Guid MediaFileId { get; set; }

        [JsonProperty("container")] public string Container { get; set; } = string.Empty;

        [JsonProperty("options")] public IList<DownloadOption> Options { get; set; } = new List<DownloadOption>();
    }

    public sealed class DownloadTicket
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("media_file_id")] public Guid MediaFileId { get; set; }

        [JsonProperty("quality_id")] public string QualityId { get; set; } = "original";

        [JsonProperty("status")] public DownloadTicketStatus Status { get; set; }

        [JsonProperty("container")] public string Container { get; set; } = string.Empty;

        [JsonProperty("size_bytes")] public long? SizeBytes { get; set; }

        [JsonProperty("error_message")] public string? ErrorMessage { get; set; }
    }

    /// <summary>The device-side state of one download (the web's <c>DownloadRecord</c>).</summary>
    public enum DownloadState
    {
        Queued,
        Processing,
        Downloading,
        Paused,
        Ready,
        Failed,
    }

    /// <summary>The web's keep-until choices: forever, until a date, or some days or weeks after it is watched.</summary>
    public sealed class KeepUntilPolicy
    {
        [JsonProperty("type")] public string Type { get; set; } = "forever";

        [JsonProperty("date")] public DateTimeOffset? Date { get; set; }

        [JsonProperty("amount")] public int Amount { get; set; }

        [JsonProperty("unit")] public string Unit { get; set; } = "days";

        public static KeepUntilPolicy Forever => new KeepUntilPolicy();
    }

    public sealed class DownloadRecord
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("work_id")] public Guid WorkId { get; set; }

        [JsonProperty("media_file_id")] public Guid MediaFileId { get; set; }

        [JsonProperty("kind")] public string Kind { get; set; } = "movie";

        [JsonProperty("title")] public string Title { get; set; } = string.Empty;

        [JsonProperty("subtitle")] public string? Subtitle { get; set; }

        [JsonProperty("series_title")] public string? SeriesTitle { get; set; }

        [JsonProperty("season_number")] public int? SeasonNumber { get; set; }

        [JsonProperty("episode_number")] public int? EpisodeNumber { get; set; }

        [JsonProperty("quality_id")] public string QualityId { get; set; } = "original";

        [JsonProperty("quality_label")] public string QualityLabel { get; set; } = "Original";

        [JsonProperty("container")] public string Container { get; set; } = "mkv";

        [JsonProperty("total_bytes")] public long? TotalBytes { get; set; }

        [JsonProperty("bytes_downloaded")] public long BytesDownloaded { get; set; }

        [JsonProperty("state")] public DownloadState State { get; set; }

        [JsonProperty("keep_until")] public KeepUntilPolicy KeepUntil { get; set; } = KeepUntilPolicy.Forever;

        [JsonProperty("error")] public string? Error { get; set; }

        /// <summary>The download finished but the server was not told yet (the complete call failed): retried on the next launch.</summary>
        [JsonProperty("pending_ack")] public bool PendingAck { get; set; }

        [JsonProperty("requested_at")] public DateTimeOffset RequestedAt { get; set; } = DateTimeOffset.UtcNow;

        /// <summary>File name inside the app's downloads folder.</summary>
        [JsonProperty("file")] public string File { get; set; } = string.Empty;

        [JsonIgnore]
        public double Percent => TotalBytes is { } total && total > 0 ? Math.Min(100, BytesDownloaded * 100.0 / total) : 0;
    }
}
