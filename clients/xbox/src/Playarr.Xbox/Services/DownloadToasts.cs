using System;
using Playarr.Core.Models;
using Windows.UI.Notifications;

namespace Playarr.Xbox.Services
{
    /// <summary>
    /// The system toast that tracks one download (owner rule: title, percent and size while it runs, then paused, completed
    /// and failed states, with Pause, Resume and Cancel buttons). The running toast is a progress toast that is updated in
    /// place through its notification data, so it never pops again on each update.
    /// </summary>
    internal static class DownloadToasts
    {
        private const string Group = "downloads";

        private static string Size(long bytes) => bytes >= 1L << 30 ? $"{bytes / (double)(1L << 30):0.0} GB" : $"{bytes / (double)(1L << 20):0} MB";

        private static string Escape(string text) => System.Security.SecurityElement.Escape(text) ?? string.Empty;

        private static string Label(DownloadRecord r) => string.IsNullOrEmpty(r.SeriesTitle) ? r.Title : r.SeriesTitle + " · " + r.Title;

        private static string Button(string text, string action, Guid id) =>
            $"<action content=\"{text}\" arguments=\"action={action}&amp;id={id:D}\" activationType=\"foreground\"/>";

        public static void Show(DownloadRecord record)
        {
            try
            {
                string visual;
                string actions;
                var id = record.Id;
                switch (record.State)
                {
                    case DownloadState.Ready:
                        visual = $"<text>Download complete</text><text>{Escape(Label(record))}</text>";
                        actions = string.Empty;
                        break;
                    case DownloadState.Failed:
                        visual = $"<text>Download failed</text><text>{Escape(Label(record))}</text><text>{Escape(record.Error ?? string.Empty)}</text>";
                        actions = Button("Retry", "resume", id) + Button("Cancel", "cancel", id);
                        break;
                    case DownloadState.Paused:
                        visual = $"<text>Download paused</text><text>{Escape(Label(record))}</text><progress value=\"{record.Percent / 100:0.###}\" status=\"{Escape(Status(record))}\"/>";
                        actions = Button("Resume", "resume", id) + Button("Cancel", "cancel", id);
                        break;
                    default:
                        visual = $"<text>{Escape(Label(record))}</text><progress title=\"{{progressTitle}}\" value=\"{{progressValue}}\" valueStringOverride=\"{{progressValueString}}\" status=\"{{progressStatus}}\"/>";
                        actions = Button("Pause", "pause", id) + Button("Cancel", "cancel", id);
                        break;
                }

                var xml = new Windows.Data.Xml.Dom.XmlDocument();
                xml.LoadXml($"<toast><visual><binding template=\"ToastGeneric\">{visual}</binding></visual><actions>{actions}</actions></toast>");
                var toast = new ToastNotification(xml) { Tag = id.ToString("N"), Group = Group };
                if (record.State == DownloadState.Downloading || record.State == DownloadState.Processing || record.State == DownloadState.Queued)
                {
                    toast.Data = Data(record);
                    toast.SuppressPopup = false;
                }

                ToastNotificationManager.CreateToastNotifier().Show(toast);
            }
            catch (Exception)
            {
                // A notification is a courtesy: the download goes on without it.
            }
        }

        public static void Update(DownloadRecord record)
        {
            try
            {
                ToastNotificationManager.CreateToastNotifier().Update(Data(record), record.Id.ToString("N"), Group);
            }
            catch (Exception)
            {
            }
        }

        public static void Dismiss(Guid id)
        {
            try
            {
                ToastNotificationManager.History.Remove(id.ToString("N"), Group);
            }
            catch (Exception)
            {
            }
        }

        private static string Status(DownloadRecord r) =>
            r.TotalBytes is { } total ? $"{Size(r.BytesDownloaded)} of {Size(total)}" : Size(r.BytesDownloaded);

        private static NotificationData Data(DownloadRecord r)
        {
            var data = new NotificationData { SequenceNumber = 0 };
            data.Values["progressTitle"] = r.State == DownloadState.Downloading ? r.QualityLabel : "Preparing";
            data.Values["progressValue"] = r.State == DownloadState.Downloading && r.TotalBytes > 0 ? (r.Percent / 100).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) : "indeterminate";
            data.Values["progressValueString"] = r.State == DownloadState.Downloading ? $"{r.Percent:0}%" : string.Empty;
            data.Values["progressStatus"] = r.State == DownloadState.Downloading ? Status(r) : "Waiting for the server";
            return data;
        }
    }
}
