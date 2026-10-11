#pragma once
#include <QObject>
#include "playbacklogic.h"

// QML face of PlaybackLogic.
class Playback : public QObject
{
    Q_OBJECT
public:
    using QObject::QObject;
    Q_INVOKABLE QString query(const QVariantMap &o) const { return PlaybackLogic::query(o); }
    Q_INVOKABLE QString negotiationMessage(int status, const QVariantMap &body) const { return PlaybackLogic::negotiationMessage(status, body); }
    Q_INVOKABLE int retryDelayMs(int attempt) const { return PlaybackLogic::retryDelayMs(attempt); }
    Q_INVOKABLE QVariantList parseVtt(const QString &t) const { return PlaybackLogic::parseVtt(t); }
    Q_INVOKABLE QString cueAt(const QVariantList &c, double ms) const { return PlaybackLogic::cueAt(c, qint64(ms)); }
    Q_INVOKABLE QString pickSubtitle(const QVariantList &t, const QString &m, const QString &l) const { return PlaybackLogic::pickSubtitle(t, m, l); }
};
