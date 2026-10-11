#pragma once
#include <QJSValue>
#include <QNetworkAccessManager>
#include <QObject>
#include <QSettings>
#include <QTimer>
#include <QVariantList>
#include <memory>
#include "mediaproxy.h"

class QJSEngine;
class QNetworkReply;

// Playarr server client exposed to QML: authenticated JSON requests with single-flight token refresh,
// the hosted device-link sign-in (QR) and the stored profile sessions.
class Api : public QObject
{
    Q_OBJECT
    Q_PROPERTY(bool signedIn READ signedIn NOTIFY sessionChanged)
    Q_PROPERTY(QString serverUrl READ serverUrl NOTIFY sessionChanged)
    Q_PROPERTY(QString profileId READ profileId NOTIFY sessionChanged)
    Q_PROPERTY(QString profileName READ profileName NOTIFY sessionChanged)
    Q_PROPERTY(QString profileAvatar READ profileAvatar NOTIFY sessionChanged)
    Q_PROPERTY(QVariantList profiles READ profilesModel NOTIFY sessionChanged)
    Q_PROPERTY(QString themeMode READ themeMode WRITE setThemeMode NOTIFY themeModeChanged)
    Q_PROPERTY(QString linkState READ linkState NOTIFY linkChanged)
    Q_PROPERTY(QString linkCode READ linkCode NOTIFY linkChanged)
    Q_PROPERTY(QString linkQr READ linkQr NOTIFY linkChanged)
    Q_PROPERTY(QString linkUrl READ linkUrl NOTIFY linkChanged)
    Q_PROPERTY(QString assetBase READ assetBase WRITE setAssetBase NOTIFY assetBaseChanged)

public:
    explicit Api(QObject *parent = nullptr);
    void setEngine(QJSEngine *e) { m_engine = e; }

    bool signedIn() const { return m_active >= 0; }
    QString serverUrl() const;
    QString profileId() const;
    QString profileName() const;
    QString profileAvatar() const;
    QVariantList profilesModel() const;
    QString themeMode() const { return m_theme; }
    void setThemeMode(const QString &mode);
    QString linkState() const { return m_linkState; }
    QString linkCode() const { return m_linkCode; }
    QString linkQr() const { return m_linkQr; }
    QString linkUrl() const { return m_linkUrl; }
    QString assetBase() const { return m_assetBase; }
    void setAssetBase(const QString &b);

    // JSON request against the active server: cb(status, data); status 0 = network failure.
    Q_INVOKABLE void request(const QString &method, const QString &path, const QVariant &body, const QJSValue &cb);
    // Same, but the body is returned as text (WebVTT sidecars). `path` may be a server path or a URL on the server.
    Q_INVOKABLE void requestText(const QString &path, const QJSValue &cb);
    Q_INVOKABLE QVariant setting(const QString &key, const QVariant &fallback) const;
    Q_INVOKABLE void setSetting(const QString &key, const QVariant &value);
    Q_INVOKABLE QString url(const QString &path) const;
    // Server artwork URL for a Work/Episode image list (kinds tried in order); empty when none.
    Q_INVOKABLE QString artwork(const QString &workId, const QVariantList &images, const QStringList &kinds) const;
    // Playback URL with the session capability query the server accepts for header-less players.
    Q_INVOKABLE QString playbackUrl(const QString &infoUrl, const QString &sessionId) const;
    Q_INVOKABLE QString avatarSource(const QString &avatar) const;

    Q_INVOKABLE void startLink();
    Q_INVOKABLE void cancelLink();
    Q_INVOKABLE void selectProfile(const QString &userId);
    Q_INVOKABLE void removeProfile(const QString &userId);
    Q_INVOKABLE void signOut();
    // POST /api/v1/auth/unlock for a PIN-locked profile, then switch to it: cb(status, {retryAfter}).
    Q_INVOKABLE void unlockProfile(const QString &userId, const QString &pin, const QJSValue &cb);

    QNetworkAccessManager *network() { return &m_nam; }
    // For the QML image network manager: bearer for requests to the active server only.
    QByteArray bearerFor(const QUrl &url) const;

signals:
    void sessionChanged();
    void themeModeChanged();
    void linkChanged();
    void linkFinished();
    void assetBaseChanged();

private:
    struct Profile {
        QString userId, name, deviceId, access, refresh, server, avatar;
        bool pinLocked = false;
        qint64 expiresAt = 0; // epoch ms
    };
    struct Req {
        QString method, path;
        QByteArray body;
        QJSValue cb;
        bool retried = false;
        bool text = false;
    };

    void send(const Req &r);
    void finish(const Req &r, int status, const QVariant &data);
    void refresh();
    void load();
    void save();
    void learnProfile(const QString &userId);
    void refreshFlags();
    QNetworkReply *post(const QUrl &url, const QJsonObject &body, bool auth = false);
    // link flow
    void linkRequestCode();
    void linkStep();
    void linkPollHosted();
    void linkPollServer();
    void linkSetState(const QString &s);
    void linkAdopt(const QJsonObject &tokens, const QString &server);

    QJSEngine *m_engine = nullptr;
    QNetworkAccessManager m_nam;
    MediaProxy m_proxy;
    QSettings m_settings;
    QList<Profile> m_profiles;
    int m_active = -1;
    QString m_theme = QStringLiteral("system");
    QString m_assetBase;
    bool m_refreshing = false;
    QList<Req> m_waiting;

    QString m_linkState = QStringLiteral("idle"), m_linkCode, m_linkQr, m_linkUrl, m_linkDevice, m_linkError;
    QStringList m_linkServers;
    QString m_linkServerCode;
    int m_linkServerIdx = 0, m_linkInterval = 2, m_linkGen = 0;
    qint64 m_linkExpires = 0;
    QTimer m_linkTimer;
};
