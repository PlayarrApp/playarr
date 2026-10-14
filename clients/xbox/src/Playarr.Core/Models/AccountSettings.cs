using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Playarr.Core.Models
{
    // Wire models for the web's Settings > Invite a friend, Phone remote and Your data (packages/api-client in tv-web).

    /// <summary><c>/api/v1/users/me/user-invite-request</c>; <c>status</c> is pending, approved, denied or generated.</summary>
    public sealed class UserInviteRequest
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("status")] public string Status { get; set; } = string.Empty;

        [JsonProperty("message")] public string? Message { get; set; }
    }

    public sealed class UserInvite
    {
        [JsonProperty("invite_token")] public string InviteToken { get; set; } = string.Empty;

        [JsonProperty("expires_at")] public string ExpiresAt { get; set; } = string.Empty;
    }

    public sealed class RemoteTarget
    {
        [JsonProperty("device_id")] public Guid DeviceId { get; set; }

        [JsonProperty("name")] public string Name { get; set; } = string.Empty;

        [JsonProperty("online")] public bool Online { get; set; }

        [JsonProperty("is_self")] public bool IsSelf { get; set; }

        [JsonProperty("platform")] public string Platform { get; set; } = string.Empty;
    }

    /// <summary>A pairing between a controller and a target; <c>status</c> is pending, active, denied, revoked or expired.</summary>
    public sealed class RemotePairing
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("status")] public string Status { get; set; } = string.Empty;

        [JsonProperty("controller_name")] public string ControllerName { get; set; } = string.Empty;

        [JsonProperty("target_device_id")] public Guid TargetDeviceId { get; set; }

        [JsonProperty("is_controller")] public bool IsController { get; set; }

        [JsonProperty("is_target")] public bool IsTarget { get; set; }

        [JsonProperty("scopes")] public IList<string> Scopes { get; set; } = new List<string>();

        [JsonProperty("verification_code")] public string? VerificationCode { get; set; }

        [JsonProperty("created_ms")] public long CreatedMs { get; set; }

        [JsonProperty("expires_ms")] public long ExpiresMs { get; set; }
    }

    public sealed class RemoteInboxEvent
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("seq")] public long Seq { get; set; }

        /// <summary>pairing_request, pairing_revoked, command, handoff_offer or handoff_stop.</summary>
        [JsonProperty("kind")] public string Kind { get; set; } = string.Empty;

        [JsonProperty("pairing_id")] public Guid? PairingId { get; set; }

        [JsonProperty("payload")] public JObject? Payload { get; set; }
    }

    public sealed class RemoteInbox
    {
        [JsonProperty("events")] public IList<RemoteInboxEvent> Events { get; set; } = new List<RemoteInboxEvent>();

        [JsonProperty("next")] public long Next { get; set; }
    }

    public sealed class RemoteCommandAccepted
    {
        [JsonProperty("command_id")] public Guid CommandId { get; set; }
    }

    /// <summary>queued, delivered, ok, failed, unsupported, revoked or expired.</summary>
    public sealed class RemoteCommandStatus
    {
        [JsonProperty("status")] public string Status { get; set; } = string.Empty;

        [JsonProperty("detail")] public string? Detail { get; set; }
    }

    public sealed class UserDataExportProgress
    {
        [JsonProperty("stage")] public string Stage { get; set; } = string.Empty;
    }

    public sealed class UserDataExportCounts
    {
        [JsonProperty("watch_progress")] public int WatchProgress { get; set; }

        [JsonProperty("playlists")] public int Playlists { get; set; }
    }

    /// <summary>Own-account export; <c>status</c> is queued, running, ready, failed or expired.</summary>
    public sealed class UserDataExportJob
    {
        [JsonProperty("id")] public string Id { get; set; } = string.Empty;

        [JsonProperty("status")] public string Status { get; set; } = string.Empty;

        [JsonProperty("expires_at")] public string? ExpiresAt { get; set; }

        [JsonProperty("progress")] public UserDataExportProgress Progress { get; set; } = new UserDataExportProgress();

        [JsonProperty("counts")] public UserDataExportCounts Counts { get; set; } = new UserDataExportCounts();

        [JsonProperty("size_bytes")] public long? SizeBytes { get; set; }

        public bool IsRunning => Status == "queued" || Status == "running";
    }

    /// <summary>A one-time link for another device, shown as a QR code (the TV has no file picker).</summary>
    public sealed class UserDataTransferLink
    {
        [JsonProperty("path")] public string Path { get; set; } = string.Empty;

        [JsonProperty("url")] public string? Url { get; set; }

        [JsonProperty("expires_at")] public string ExpiresAt { get; set; } = string.Empty;
    }

    /// <summary>Import session; <c>status</c> is waiting, uploading or uploaded.</summary>
    public sealed class UserDataImportSession
    {
        [JsonProperty("id")] public string Id { get; set; } = string.Empty;

        [JsonProperty("status")] public string Status { get; set; } = string.Empty;

        [JsonProperty("upload_path")] public string? UploadPath { get; set; }

        [JsonProperty("upload_url")] public string? UploadUrl { get; set; }

        [JsonProperty("expires_at")] public string ExpiresAt { get; set; } = string.Empty;

        [JsonProperty("size_bytes")] public long? SizeBytes { get; set; }
    }

    public sealed class UserDataImportPreview
    {
        [JsonProperty("package_sha256")] public string PackageSha256 { get; set; } = string.Empty;

        [JsonProperty("summary")] public JObject Summary { get; set; } = new JObject();

        [JsonProperty("warnings")] public IList<string> Warnings { get; set; } = new List<string>();

        /// <summary>A count from the summary, for example <c>Count("watch_progress", "will_add")</c>; 0 when absent.</summary>
        public int Count(string section, string field) => (int?)Summary[section]?[field] ?? 0;

        public int UnmatchedTotal => (int?)Summary["unmatched_total"] ?? 0;

        public bool HasWatchlist => Summary["watchlist"] != null;
    }

    public sealed class UserDataImportResult
    {
        [JsonProperty("completed")] public bool Completed { get; set; }

        [JsonProperty("progress_added")] public int ProgressAdded { get; set; }

        [JsonProperty("progress_updated")] public int ProgressUpdated { get; set; }

        [JsonProperty("playlist_items_added")] public int PlaylistItemsAdded { get; set; }

        [JsonProperty("unmatched_total")] public int UnmatchedTotal { get; set; }

        [JsonProperty("failure")] public string? Failure { get; set; }
    }
}
