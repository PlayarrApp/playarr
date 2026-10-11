#include <cstdio>
#include <cstdlib>
#include <QByteArray>
#include "util.h"
#include "playbacklogic.h"
#include "calendarlogic.h"
#include "mediaproxy.h"
#include "downloadlogic.h"
#include <QVariantMap>

static int failures = 0;
#define CHECK(a, b) do { if (!((a) == (b))) { std::printf("FAIL line %d: %s != %s\n", __LINE__, #a, #b); ++failures; } } while (0)

int main()
{
    // JWT claims (unpadded base64url payload).
    const QString payload = QString::fromLatin1(QByteArray("{\"sub\":\"u-1\",\"device_id\":\"d-9\"}")
        .toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals));
    const QString jwt = "aGVhZGVy." + payload + ".c2ln";
    CHECK(Util::jwtClaim(jwt, "sub"), QString("u-1"));
    CHECK(Util::jwtClaim(jwt, "device_id"), QString("d-9"));
    CHECK(Util::jwtClaim("not-a-token", "sub"), QString());

    // Same hash as defaultProfileAvatarPreset in clients/tv-web: h = (h * 31 + code) >>> 0, index h % 6.
    CHECK(Util::defaultAvatarPreset(""), QString("astronaut"));
    CHECK(Util::defaultAvatarPreset("a"), QString("cat"));      // 97 % 6 = 1
    CHECK(Util::defaultAvatarPreset("ab"), QString("robot"));   // 3105 % 6 = 3
    CHECK(Util::defaultAvatarPreset("9f8d7a6b-1234-4567-89ab-cdef01234567"), QString("cat"));

    CHECK(Util::joinUrl("https://h:8484/", "/api/x"), QString("https://h:8484/api/x"));
    CHECK(Util::joinUrl("ftp://h", "/x"), QString());
    CHECK(Util::originOf(QUrl("https://h:8484/a?b=1")), QString("https://h:8484"));

    // Playback negotiation query
    QVariantMap o;
    CHECK(PlaybackLogic::query(o).contains("start_position_ms"), false);
    o["startMs"] = 90000; o["profile"] = "h264-720p-4mbps"; o["forceTranscode"] = true; o["audioStreamIndex"] = 2; o["ignoreSaved"] = true;
    const QString q = PlaybackLogic::query(o);
    CHECK(q.contains("start_position_ms=90000"), true);
    CHECK(q.contains("profile=h264-720p-4mbps"), true);
    CHECK(q.contains("force_transcode=true"), true);
    CHECK(q.contains("audio_stream_index=2"), true);
    CHECK(q.contains("ignore_saved_preferences=true"), true);
    CHECK(PlaybackLogic::retryDelayMs(0), 1000);
    CHECK(PlaybackLogic::retryDelayMs(2), 4000);
    CHECK(PlaybackLogic::retryDelayMs(3), -1);

    // WebVTT
    const QString vtt = "WEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:03.500 align:start\r\n<i>Hello</i> &amp; bye\r\n\r\n00:01:00.250 --> 01:00:02.000\r\nSecond\r\nline\r\n\r\nbroken --> x\r\nnope\r\n";
    const QVariantList cues = PlaybackLogic::parseVtt(vtt);
    CHECK(cues.size(), 2);
    CHECK(cues.at(0).toMap().value("start").toLongLong(), qint64(1000));
    CHECK(cues.at(0).toMap().value("end").toLongLong(), qint64(3500));
    CHECK(cues.at(0).toMap().value("text").toString(), QString("Hello & bye"));
    CHECK(cues.at(1).toMap().value("start").toLongLong(), qint64(60250));
    CHECK(cues.at(1).toMap().value("end").toLongLong(), qint64(3602000));
    CHECK(cues.at(1).toMap().value("text").toString(), QString("Second\nline"));
    CHECK(PlaybackLogic::cueAt(cues, 500), QString());
    CHECK(PlaybackLogic::cueAt(cues, 1000), QString("Hello & bye"));
    CHECK(PlaybackLogic::cueAt(cues, 3500), QString());
    CHECK(PlaybackLogic::cueAt(cues, 61000), QString("Second\nline"));

    // Subtitle default selection (web rule)
    auto tr = [](const char *id, const char *lang, bool forced, bool def, const char *url = "/s") {
        QVariantMap m; m["id"] = id; m["language"] = lang; m["forced"] = forced; m["is_default"] = def; m["url"] = url; return QVariant(m); };
    const QVariantList tracks = QVariantList() << tr("a", "fra", false, true) << tr("b", "eng", true, false) << tr("c", "eng", false, false) << tr("d", "tha", false, false, "");
    CHECK(PlaybackLogic::pickSubtitle(tracks, "off", "en"), QString());
    CHECK(PlaybackLogic::pickSubtitle(tracks, "forced", "en"), QString("b"));
    CHECK(PlaybackLogic::pickSubtitle(tracks, "always", "en"), QString("b"));      // first language match
    CHECK(PlaybackLogic::pickSubtitle(tracks, "always", "de"), QString("a"));      // no language: the default flag
    CHECK(PlaybackLogic::pickSubtitle(tracks, "always", "th"), QString("a"));      // th track has no url: not eligible
    CHECK(PlaybackLogic::pickSubtitle(tracks, "forced", "fr"), QString("b"));      // only forced tracks are eligible

    // Calendar agenda
    CHECK(CalendarLogic::pageStart(QDate(2026, 10, 7), 0, 30), QString("2026-10-07"));
    CHECK(CalendarLogic::pageEnd(QDate(2026, 10, 7), 0, 30), QString("2026-11-05"));
    CHECK(CalendarLogic::pageStart(QDate(2026, 10, 7), -1, 30), QString("2026-09-07"));
    CHECK(CalendarLogic::dayHeading("2026-10-10", QLocale::c()), QString("Saturday 10 October"));
    CHECK(CalendarLogic::dayHeading("nope", QLocale::c()), QString("nope"));
    auto en = [](const char *date, const char *at, const char *title) {
        QVariantMap m; m["date"] = date; m["release_at"] = at; m["title"] = title; return QVariant(m); };
    const QVariantList days = CalendarLogic::groupByDate(QVariantList() << en("2026-10-11", "", "B") << en("2026-10-10", "2026-10-10T20:00:00Z", "Z")
                                                                      << en("2026-10-10", "2026-10-10T01:00:00Z", "Y") << en("2026-10-11", "", "A"));
    CHECK(days.size(), 2);
    CHECK(days.at(0).toMap().value("date").toString(), QString("2026-10-10"));
    CHECK(days.at(0).toMap().value("entries").toList().at(0).toMap().value("title").toString(), QString("Y"));
    CHECK(days.at(1).toMap().value("entries").toList().at(0).toMap().value("title").toString(), QString("A"));
    const QDate t(2026, 10, 11); // a Sunday
    QVariantMap w0 = CalendarLogic::rangeFor("week", 0, t, QLocale::c());
    CHECK(w0.value("start").toString(), QString("2026-10-05"));
    CHECK(w0.value("end").toString(), QString("2026-10-11"));
    CHECK(w0.value("label").toString(), QString("5 \u2013 11 Oct"));
    QVariantMap m0 = CalendarLogic::rangeFor("month", 0, t, QLocale::c());
    CHECK(m0.value("start").toString(), QString("2026-09-28"));
    CHECK(m0.value("end").toString(), QString("2026-11-01"));
    CHECK(m0.value("label").toString(), QString("Oct 2026"));
    CHECK(CalendarLogic::weeks(m0.value("start").toString(), m0.value("end").toString()).size(), 5);
    CHECK(CalendarLogic::rangeFor("month", 1, t, QLocale::c()).value("start").toString(), QString("2026-10-26"));
    CHECK(CalendarLogic::rangeFor("agenda", 0, t, QLocale::c()).value("end").toString(), QString("2026-11-09"));
    QVariantMap ep; ep["season_number"] = 3; ep["episode_number"] = 3;
    CHECK(CalendarLogic::episodeCode(ep), QString("S03E03"));
    CHECK(CalendarLogic::episodeCode(QVariantMap()), QString());

    // Media proxy request handling
    const MediaProxy::Request pr = MediaProxy::parse("GET /tok/api/v1/media/x/stream?a=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=100-\r\nAccept: */*");
    CHECK(pr.ok, true);
    CHECK(pr.method, QByteArray("GET"));
    CHECK(pr.range, QByteArray("bytes=100-"));
    CHECK(MediaProxy::upstreamPath(pr.target, "tok"), QString("/api/v1/media/x/stream?a=1"));
    CHECK(MediaProxy::upstreamPath("/other/api/x", "tok"), QString());
    CHECK(MediaProxy::upstreamPath("/tok/../etc", "tok"), QString());
    CHECK(MediaProxy::upstreamPath("/tok//evil.example/x", "tok"), QString());
    CHECK(MediaProxy::parse("garbage").ok, false);

    // Downloads
    CHECK(DownloadLogic::safeName("A/B: C?", "6a5e2c3e-2b9a", "mkv"), QString("A_B_ C_ [6a5e2c3e].mkv"));
    CHECK(DownloadLogic::safeName("", "abcdefghij", ""), QString("download [abcdefgh].bin"));
    CHECK(DownloadLogic::safeName("x", "id", "../mp4"), QString("x [id].mp4"));
    CHECK(DownloadLogic::resumeRange(0), QByteArray());
    CHECK(DownloadLogic::resumeRange(1048576), QByteArray("bytes=1048576-"));

    std::printf(failures ? "FAILED\n" : "ok\n");
    return failures ? 1 : 0;
}
