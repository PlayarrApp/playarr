#include <cstdio>
#include <cstdlib>
#include <QByteArray>
#include "util.h"

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

    std::printf(failures ? "FAILED\n" : "ok\n");
    return failures ? 1 : 0;
}
