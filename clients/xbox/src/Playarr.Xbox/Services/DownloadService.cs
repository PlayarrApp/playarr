using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Windows.Storage;

namespace Playarr.Xbox.Services
{
    /// <summary>
    /// Offline downloads, as the web's engine does them: a ticket from the server (original, or a converted quality that is
    /// prepared first), the file streamed in range requests into the app's local storage with a resume point, a
    /// <c>complete</c> call once the device holds every byte (the server then deletes its staged copy), and a toast that tracks
    /// the state. State lives in <c>downloads.json</c> beside the files so it survives a restart.
    /// </summary>
    internal sealed class DownloadService
    {
        public static DownloadService Instance { get; } = new DownloadService();

        private const string IndexName = "downloads.json";
        private readonly List<DownloadRecord> _records = new List<DownloadRecord>();
        private readonly Dictionary<Guid, CancellationTokenSource> _running = new Dictionary<Guid, CancellationTokenSource>();
        private bool _loaded;

        public event Action? Changed;

        public IReadOnlyList<DownloadRecord> Records => _records.OrderByDescending(r => r.RequestedAt).ToList();

        public DownloadRecord? Find(Guid id) => _records.FirstOrDefault(r => r.Id == id);

        public DownloadRecord? ForMediaFile(Guid mediaFileId) => _records.FirstOrDefault(r => r.MediaFileId == mediaFileId);

        private static async Task<StorageFolder> FolderAsync() =>
            await ApplicationData.Current.LocalFolder.CreateFolderAsync("downloads", CreationCollisionOption.OpenIfExists);

        /// <summary>Reads the saved list; a download that was running when the app closed comes back paused.</summary>
        public async Task LoadAsync()
        {
            if (_loaded)
            {
                return;
            }

            _loaded = true;
            try
            {
                var item = await ApplicationData.Current.LocalFolder.TryGetItemAsync(IndexName);
                if (item is StorageFile file)
                {
                    var saved = JsonConvert.DeserializeObject<List<DownloadRecord>>(await FileIO.ReadTextAsync(file));
                    foreach (var record in saved ?? new List<DownloadRecord>())
                    {
                        if (record.State == DownloadState.Downloading || record.State == DownloadState.Processing || record.State == DownloadState.Queued)
                        {
                            record.State = DownloadState.Paused;
                        }

                        _records.Add(record);
                    }
                }
            }
            catch (Exception)
            {
                // An unreadable index starts empty; the files stay on disk.
            }

            Changed?.Invoke();
            _ = RetryPendingAcksAsync();
        }

        private async Task SaveAsync()
        {
            try
            {
                var file = await ApplicationData.Current.LocalFolder.CreateFileAsync(IndexName, CreationCollisionOption.ReplaceExisting);
                await FileIO.WriteTextAsync(file, JsonConvert.SerializeObject(_records));
            }
            catch (Exception)
            {
            }
        }

        private void Touch()
        {
            _ = SaveAsync();
            Changed?.Invoke();
        }

        /// <summary>Asks the server for a ticket and starts fetching the file. Returns the new record.</summary>
        public async Task<DownloadRecord> StartAsync(DownloadRecord template, string qualityId = "original", string qualityLabel = "Original")
        {
            await LoadAsync();
            var ticket = await App.Environment.ApiClient.CreateDownloadAsync(template.MediaFileId, qualityId);
            var existing = Find(ticket.Id);
            if (existing != null)
            {
                return existing;
            }

            template.Id = ticket.Id;
            template.QualityId = qualityId;
            template.QualityLabel = qualityLabel;
            template.Container = string.IsNullOrEmpty(ticket.Container) ? "mkv" : ticket.Container;
            template.TotalBytes = ticket.SizeBytes;
            template.File = ticket.Id.ToString("N") + "." + template.Container;
            template.State = DownloadState.Queued;
            template.RequestedAt = DateTimeOffset.UtcNow;
            _records.Add(template);
            Touch();
            Launch(template);
            return template;
        }

        public void Resume(Guid id)
        {
            if (Find(id) is { } record && record.State != DownloadState.Ready && !_running.ContainsKey(id))
            {
                record.Error = null;
                Launch(record);
            }
        }

        public void Pause(Guid id)
        {
            if (_running.TryGetValue(id, out var source))
            {
                source.Cancel();
            }
        }

        /// <summary>Cancel a download in progress, or delete a finished one: the file, the record and the server ticket all go.</summary>
        public async Task RemoveAsync(Guid id)
        {
            Pause(id);
            if (Find(id) is not { } record)
            {
                return;
            }

            _records.Remove(record);
            DownloadToasts.Dismiss(id);
            Touch();
            try
            {
                var item = await (await FolderAsync()).TryGetItemAsync(record.File);
                if (item != null)
                {
                    await item.DeleteAsync();
                }
            }
            catch (Exception)
            {
            }

            try
            {
                await App.Environment.ApiClient.CancelDownloadAsync(id);
            }
            catch (Exception)
            {
                // The ticket may already be gone (completed or expired): nothing left to cancel.
            }
        }

        public void SetKeepUntil(Guid id, KeepUntilPolicy policy)
        {
            if (Find(id) is { } record)
            {
                record.KeepUntil = policy;
                Touch();
            }
        }

        /// <summary>The local file of a finished download, for offline playback.</summary>
        public async Task<StorageFile?> FileAsync(DownloadRecord record) =>
            await (await FolderAsync()).TryGetItemAsync(record.File) as StorageFile;

        private void Launch(DownloadRecord record)
        {
            var source = new CancellationTokenSource();
            _running[record.Id] = source;
            _ = Task.Run(() => RunAsync(record, source.Token));
        }

        private async Task RunAsync(DownloadRecord record, CancellationToken cancel)
        {
            var api = App.Environment.ApiClient;
            try
            {
                // 1. A converted quality is prepared on the server first: wait for the ticket to be ready.
                record.State = DownloadState.Processing;
                Touch();
                DownloadToasts.Show(record);
                DownloadTicket ticket;
                while (true)
                {
                    ticket = await api.GetDownloadAsync(record.Id, cancel);
                    if (ticket.Status == DownloadTicketStatus.Ready)
                    {
                        break;
                    }

                    if (ticket.Status == DownloadTicketStatus.Failed || ticket.Status == DownloadTicketStatus.Canceled || ticket.Status == DownloadTicketStatus.Expired)
                    {
                        throw new InvalidOperationException(ticket.ErrorMessage ?? "The server could not prepare this download.");
                    }

                    await Task.Delay(2000, cancel);
                }

                record.TotalBytes = ticket.SizeBytes ?? record.TotalBytes;

                // 2. Stream the file in, resuming from what is on disk.
                var folder = await FolderAsync();
                var file = await folder.CreateFileAsync(record.File, CreationCollisionOption.OpenIfExists);
                var have = (long)(await file.GetBasicPropertiesAsync()).Size;
                using (var response = await api.OpenDownloadFileAsync(record.Id, have, cancel))
                {
                    if (have > 0 && response.StatusCode != HttpStatusCode.PartialContent)
                    {
                        have = 0; // the server sent the whole file again
                    }

                    var length = response.Content.Headers.ContentLength;
                    if (length != null && record.TotalBytes == null)
                    {
                        record.TotalBytes = have + length;
                    }

                    record.State = DownloadState.Downloading;
                    record.BytesDownloaded = have;
                    Touch();
                    using (var network = await response.Content.ReadAsStreamAsync())
                    using (var disk = await file.OpenAsync(FileAccessMode.ReadWrite))
                    {
                        disk.Seek((ulong)have);
                        if (have == 0)
                        {
                            disk.Size = 0;
                        }

                        var stream = disk.AsStream();
                        var buffer = new byte[256 * 1024];
                        var lastReport = DateTime.UtcNow;
                        int read;
                        while ((read = await network.ReadAsync(buffer, 0, buffer.Length, cancel)) > 0)
                        {
                            await stream.WriteAsync(buffer, 0, read, cancel);
                            record.BytesDownloaded += read;
                            if ((DateTime.UtcNow - lastReport).TotalMilliseconds >= 1000)
                            {
                                lastReport = DateTime.UtcNow;
                                DownloadToasts.Update(record);
                                Changed?.Invoke();
                            }
                        }

                        await stream.FlushAsync(cancel);
                    }
                }

                // 3. The device holds every byte: tell the server so it can delete its staged copy. A failure is logged and
                // retried (now with backoff, then on the next launch) so staged copies are not left behind.
                record.State = DownloadState.Ready;
                record.PendingAck = !await AcknowledgeAsync(record);
                DownloadToasts.Show(record);
            }
            catch (OperationCanceledException)
            {
                if (Find(record.Id) != null)
                {
                    record.State = DownloadState.Paused;
                    DownloadToasts.Show(record);
                }
            }
            catch (Exception error)
            {
                record.State = DownloadState.Failed;
                record.Error = error.Message;
                DownloadToasts.Show(record);
            }
            finally
            {
                _running.Remove(record.Id);
                Touch();
            }
        }

        private static readonly int[] AckBackoffSeconds = { 0, 2, 6, 15 };

        /// <summary>The complete call, retried with backoff. True when the server acknowledged; failures go to downloads.log.</summary>
        private async Task<bool> AcknowledgeAsync(DownloadRecord record)
        {
            foreach (var wait in AckBackoffSeconds)
            {
                if (wait > 0)
                {
                    await Task.Delay(wait * 1000);
                }

                try
                {
                    await App.Environment.ApiClient.CompleteDownloadAsync(record.Id);
                    return true;
                }
                catch (Exception error)
                {
                    await LogAsync($"complete {record.Id:D} failed: {error.Message}");
                }
            }

            return false;
        }

        /// <summary>Downloads that finished while the server could not be told are acknowledged on the next launch.</summary>
        private async Task RetryPendingAcksAsync()
        {
            foreach (var record in _records.Where(r => r.State == DownloadState.Ready && r.PendingAck).ToList())
            {
                if (await AcknowledgeAsync(record))
                {
                    record.PendingAck = false;
                    Touch();
                }
            }
        }

        private static async Task LogAsync(string line)
        {
            try
            {
                var file = await ApplicationData.Current.LocalFolder.CreateFileAsync("downloads.log", CreationCollisionOption.OpenIfExists);
                await FileIO.AppendTextAsync(file, DateTimeOffset.Now.ToString("s") + " " + line + "\n");
            }
            catch (Exception)
            {
            }
        }

        /// <summary>Remote actions from a toast button.</summary>
        public async Task HandleToastActionAsync(string arguments)
        {
            var parts = arguments.Split('&').Select(p => p.Split('=')).Where(p => p.Length == 2).ToDictionary(p => p[0], p => p[1]);
            if (!parts.TryGetValue("id", out var text) || !Guid.TryParse(text, out var id) || !parts.TryGetValue("action", out var action))
            {
                return;
            }

            await LoadAsync();
            switch (action)
            {
                case "pause": Pause(id); break;
                case "resume": Resume(id); break;
                case "cancel": await RemoveAsync(id); break;
            }
        }
    }
}
