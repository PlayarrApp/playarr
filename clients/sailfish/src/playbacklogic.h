// Pure playback helpers (no QML, no network), unit-tested in tests/tst_util.cpp.
#pragma once
#include <QRegularExpression>
#include <QStringList>
#include <QVariantList>
#include <QVariantMap>

namespace PlaybackLogic {

// Query for GET /api/v1/playback/{id}. Keys of `o`: startMs, profile, forceTranscode, audioStreamIndex, ignoreSaved.
inline QString query(const QVariantMap &o)
{
    QStringList q;
    q << QStringLiteral("containers=mp4,mkv,m3u8,mp3,flac,m4a,ogg,wav")
      << QStringLiteral("video_codecs=h264")
      << QStringLiteral("audio_codecs=aac,mp3,flac,vorbis,opus")
      << QStringLiteral("max_bitrate_bps=20000000")
      // Real caps of the Sailfish media stack (docs/parity CLIENT-NOTES): 8-bit H.264 up to 1080p60, stereo, no HDR
      // or Dolby Vision and no passthrough. `hdr=` is sent empty with a bit depth so the server tone-maps.
      << QStringLiteral("hdr=")
      << QStringLiteral("max_bit_depth=8")
      << QStringLiteral("max_width=1920")
      << QStringLiteral("max_height=1080")
      << QStringLiteral("max_fps=60")
      << QStringLiteral("max_channels=2");
    if (o.value(QStringLiteral("forceDirectVideo")).toBool())
        q << QStringLiteral("force_direct_video=true");
    if (o.value(QStringLiteral("forceDirectAudio")).toBool())
        q << QStringLiteral("force_direct_audio=true");
    if (o.value(QStringLiteral("startMs")).toLongLong() > 0)
        q << QStringLiteral("start_position_ms=%1").arg(o.value(QStringLiteral("startMs")).toLongLong());
    if (!o.value(QStringLiteral("profile")).toString().isEmpty())
        q << QStringLiteral("profile=") + o.value(QStringLiteral("profile")).toString();
    if (o.value(QStringLiteral("forceTranscode")).toBool())
        q << QStringLiteral("force_transcode=true");
    if (o.contains(QStringLiteral("audioStreamIndex")) && o.value(QStringLiteral("audioStreamIndex")).toInt() >= 0)
        q << QStringLiteral("audio_stream_index=%1").arg(o.value(QStringLiteral("audioStreamIndex")).toInt());
    if (o.value(QStringLiteral("ignoreSaved")).toBool())
        q << QStringLiteral("ignore_saved_preferences=true");
    return q.join(QLatin1Char('&'));
}

// 503 means no transcode capacity right now: retry 3 times with 1 s, 2 s, 4 s; -1 = give up.
inline int retryDelayMs(int attempt) { return attempt >= 0 && attempt < 3 ? 1000 << attempt : -1; }

inline qint64 timestampMs(const QString &t) // "[hh:]mm:ss.mmm"
{
    const QStringList p = QString(t).replace(QLatin1Char(','), QLatin1Char('.')).split(QLatin1Char(':'));
    if (p.size() < 2 || p.size() > 3)
        return -1;
    const QStringList sec = p.last().split(QLatin1Char('.'));
    qint64 ms = sec.value(1).leftJustified(3, QLatin1Char('0')).left(3).toLongLong();
    ms += sec.value(0).toLongLong() * 1000 + p.at(p.size() - 2).toLongLong() * 60000;
    if (p.size() == 3)
        ms += p.at(0).toLongLong() * 3600000;
    return ms;
}

// WebVTT text -> sorted [{start, end, text}] (ms); tags stripped, malformed cues skipped.
inline QVariantList parseVtt(const QString &vtt)
{
    QVariantList cues;
    static const QRegularExpression tag(QStringLiteral("<[^>]*>"));
    const QStringList blocks = QString(vtt).replace(QStringLiteral("\r\n"), QStringLiteral("\n"))
                                   .split(QStringLiteral("\n\n"), QString::SkipEmptyParts);
    for (const QString &block : blocks) {
        const QStringList lines = block.split(QLatin1Char('\n'));
        int arrow = -1;
        for (int i = 0; i < lines.size() && i < 2; ++i)
            if (lines.at(i).contains(QStringLiteral("-->"))) { arrow = i; break; }
        if (arrow < 0)
            continue;
        const QStringList times = lines.at(arrow).split(QStringLiteral("-->"));
        const qint64 start = timestampMs(times.at(0).trimmed());
        const qint64 end = timestampMs(times.at(1).trimmed().split(QLatin1Char(' ')).value(0));
        if (start < 0 || end < start)
            continue;
        QString text = QStringList(lines.mid(arrow + 1)).join(QLatin1Char('\n'));
        text.remove(tag);
        text.replace(QStringLiteral("&amp;"), QStringLiteral("&")).replace(QStringLiteral("&lt;"), QStringLiteral("<"))
            .replace(QStringLiteral("&gt;"), QStringLiteral(">")).replace(QStringLiteral("&nbsp;"), QStringLiteral(" "));
        if (text.trimmed().isEmpty())
            continue;
        QVariantMap c;
        c[QStringLiteral("start")] = start;
        c[QStringLiteral("end")] = end;
        c[QStringLiteral("text")] = text.trimmed();
        cues.append(c);
    }
    std::sort(cues.begin(), cues.end(), [](const QVariant &a, const QVariant &b) {
        return a.toMap().value(QStringLiteral("start")).toLongLong() < b.toMap().value(QStringLiteral("start")).toLongLong();
    });
    return cues;
}

// Text of the cue showing at `ms` (the latest cue that started and has not ended), else empty.
inline QString cueAt(const QVariantList &cues, qint64 ms)
{
    int lo = 0, hi = cues.size() - 1, found = -1;
    while (lo <= hi) { // last cue with start <= ms
        const int mid = (lo + hi) / 2;
        if (cues.at(mid).toMap().value(QStringLiteral("start")).toLongLong() <= ms) { found = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    for (int i = found; i >= 0 && i > found - 4; --i) { // overlapping cues: look a few back
        const QVariantMap c = cues.at(i).toMap();
        if (c.value(QStringLiteral("end")).toLongLong() > ms)
            return c.value(QStringLiteral("text")).toString();
    }
    return QString();
}

inline QString normaliseLanguage(const QString &value)
{
    static const QHash<QString, QString> alias = {
        {"ara", "ar"}, {"chi", "zh"}, {"deu", "de"}, {"eng", "en"}, {"fra", "fr"}, {"fre", "fr"}, {"ger", "de"},
        {"hin", "hi"}, {"ita", "it"}, {"jpn", "ja"}, {"kor", "ko"}, {"por", "pt"}, {"spa", "es"}, {"tha", "th"}, {"zho", "zh"}};
    const QString l = value.trimmed().toLower().split(QRegularExpression(QStringLiteral("[-_]"))).value(0);
    return alias.value(l, l);
}

// Web rule (playerDefaults.ts): mode "off" -> none; "forced" -> only forced tracks; "always" -> any. Prefer the
// language, then the default flag, then the first. Returns the track id or "". Only tracks with a url qualify.
inline QString pickSubtitle(const QVariantList &tracks, const QString &mode, const QString &language)
{
    if (mode == QLatin1String("off") || (mode != QLatin1String("forced") && mode != QLatin1String("always")))
        return QString();
    QVariantList eligible;
    for (const QVariant &v : tracks) {
        const QVariantMap t = v.toMap();
        if (t.value(QStringLiteral("url")).toString().isEmpty())
            continue;
        if (mode == QLatin1String("forced") && !t.value(QStringLiteral("forced")).toBool())
            continue;
        eligible.append(t);
    }
    if (eligible.isEmpty())
        return QString();
    const QString want = normaliseLanguage(language);
    for (const QVariant &v : eligible)
        if (normaliseLanguage(v.toMap().value(QStringLiteral("language")).toString()) == want)
            return v.toMap().value(QStringLiteral("id")).toString();
    for (const QVariant &v : eligible)
        if (v.toMap().value(QStringLiteral("is_default")).toBool())
            return v.toMap().value(QStringLiteral("id")).toString();
    return eligible.first().toMap().value(QStringLiteral("id")).toString();
}

// Message to show for a failed negotiation, or "" for the generic one. 422 unsupported_colour_format carries the
// server's own text and is final: no retry (unlike 503, which is a capacity wait).
inline QString negotiationMessage(int status, const QVariantMap &body)
{
    if (status == 422 && body.value(QStringLiteral("error")).toString() == QLatin1String("unsupported_colour_format"))
        return body.value(QStringLiteral("message")).toString();
    return QString();
}

} // namespace PlaybackLogic
