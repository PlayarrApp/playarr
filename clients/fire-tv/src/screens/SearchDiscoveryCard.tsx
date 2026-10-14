import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import type {DiscoverTitle, TitleSnapshot} from '@playarr-tv/api-client';
import {useApiClient} from '../api/ApiClientProvider';
import {ArtworkImage} from '../components/ArtworkImage';
import {useLanguage} from '../i18n/LanguageProvider';
import {useWatchlistToggle} from '../lib/watchlist';
import {useTheme} from '../theme/ThemeProvider';
import {MediaFocus} from '../tv/mediaFocus';
import {T, u} from '../tv/kit';

const ART_W = 327.2;
const ART_H = 184;

export function SearchDiscoveryCard({
  title,
  x,
  y,
  selected,
  onFocus,
  onOpen,
  snapshot,
  requestable,
}: {
  title: DiscoverTitle;
  x: number;
  y: number;
  selected: boolean;
  onFocus: () => void;
  onOpen?: () => void;
  snapshot: TitleSnapshot;
  requestable: boolean;
}): React.ReactElement {
  const client = useApiClient();
  const {t} = useLanguage();
  const {colour} = useTheme();
  const [requestState, setRequestState] = useState<'idle' | 'busy' | 'done'>('idle');

  const request = async (): Promise<void> => {
    if (!requestable || requestState !== 'idle') return;
    setRequestState('busy');
    try {
      await client.requestTitle(snapshot);
      setRequestState('done');
    } catch {
      setRequestState('idle');
    }
  };

  const watchlist = useWatchlistToggle(client, snapshot, title.in_watchlist);
  const kindLabel = title.kind === 'game' ? t('discovery.extras.gamesTitle') : t('pages.search.availableToPlay');
  const sourceLabel = (source: string): string => {
    switch (source) {
      case 'library': return t('discovery.source.library');
      case 'peer': return t('discovery.source.peer');
      case 'request': return t('discovery.source.request');
      case 'live_tv': return t('discovery.source.live_tv');
      case 'game': return t('discovery.source.game');
      default: return '';
    }
  };
  const poster = title.poster_url;
  const titlePressable = onOpen ? (
    <Pressable accessibilityRole="button" accessibilityLabel={title.title} onFocus={onFocus} onPress={onOpen}>
      <MediaFocus variant="search" focused={selected} width={ART_W} height={ART_H} radius={12.48}>
        <View style={{width: '100%', height: '100%', backgroundColor: colour.surfaceStrong, alignItems: 'center', justifyContent: 'center'}}>
          {poster ? <ArtworkImage uri={poster} accessToken={undefined} style={{width: '100%', height: '100%'}} resizeMode="cover" /> : <T size={11.904} weight={610} color={colour.inkMuted}>{kindLabel}</T>}
        </View>
      </MediaFocus>
      <View style={{marginTop: u(11.5), paddingHorizontal: u(1.9)}}>
        <T size={11.904} weight={610} ls={-0.179} lh={17.9} color={colour.ink} lines={1}>{title.title}</T>
      </View>
      <View style={{marginTop: u(4), paddingHorizontal: u(1.9)}}>
        <T size={9.6} weight={400} lh={14.4} color={colour.inkMuted} lines={1}>
          {[title.year, ...Array.from(new Set(title.sources.map((source) => sourceLabel(source.source))))].filter(Boolean).join(' · ')}
        </T>
        {title.editions.length > 0 ? <T size={9.6} weight={400} lh={14.4} color={colour.inkMuted} lines={1}>{title.editions.slice(0, 2).join(' · ')}</T> : null}
      </View>
    </Pressable>
  ) : (
    <View accessibilityLabel={`${kindLabel}: ${title.title}`}>
      <MediaFocus variant="search" focused={selected} width={ART_W} height={ART_H} radius={12.48}>
        <View style={{width: '100%', height: '100%', backgroundColor: colour.surfaceStrong, alignItems: 'center', justifyContent: 'center'}}>
          {poster ? <ArtworkImage uri={poster} accessToken={undefined} style={{width: '100%', height: '100%'}} resizeMode="cover" /> : <T size={11.904} weight={610} color={colour.inkMuted}>{kindLabel}</T>}
        </View>
      </MediaFocus>
      <View style={{marginTop: u(11.5), paddingHorizontal: u(1.9)}}>
        <T size={11.904} weight={610} ls={-0.179} lh={17.9} color={colour.ink} lines={1}>{title.title}</T>
      </View>
      <View style={{marginTop: u(4), paddingHorizontal: u(1.9)}}>
        <T size={9.6} weight={400} lh={14.4} color={colour.inkMuted} lines={1}>
          {[title.year, ...Array.from(new Set(title.sources.map((source) => sourceLabel(source.source))))].filter(Boolean).join(' · ')}
        </T>
        {title.editions.length > 0 ? <T size={9.6} weight={400} lh={14.4} color={colour.inkMuted} lines={1}>{title.editions.slice(0, 2).join(' · ')}</T> : null}
      </View>
    </View>
  );

  return (
    <View style={{position: 'absolute', left: u(x), top: u(y), width: u(ART_W)}}>
      {titlePressable}
      <View style={{flexDirection: 'row', alignItems: 'center', marginTop: u(7), columnGap: u(8)}}>
        {requestable ? (
          <Pressable accessibilityRole="button" accessibilityLabel={requestState === 'done' ? t('discovery.request.requested') : t('discovery.action.request')} disabled={requestState !== 'idle'} onFocus={onFocus} onPress={() => void request()}>
            <T size={9.6} weight={680} color={colour.inkMuted}>{requestState === 'done' ? t('discovery.request.requested') : t('discovery.action.request')}</T>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={watchlist.listed ? t('discovery.watchlist.remove') : t('discovery.watchlist.add')} disabled={watchlist.busy || watchlist.listed === null} onFocus={onFocus} onPress={watchlist.toggle}>
          <T size={9.6} weight={680} color={colour.inkMuted}>{watchlist.listed ? t('discovery.watchlist.remove') : t('discovery.watchlist.add')}</T>
        </Pressable>
      </View>
    </View>
  );
}
