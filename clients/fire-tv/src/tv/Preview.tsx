/** The web's `tv-library-preview`: kicker, 69px title, meta runs and overview on the left of a stage page. */
import React from 'react';
import {View} from 'react-native';
import {blend} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {BalancedT, Box, T, u} from './kit';

export interface PreviewProps {
  kicker?: string;
  title: string;
  /** Meta runs: the first in the soft ink, the rest muted. */
  meta?: readonly string[];
  /** Additional content rendered in the metadata row after the text runs. */
  metaContent?: React.ReactNode;
  overview?: string | null;
  /** Content drawn between the overview and the page (actions). */
  children?: React.ReactNode;
}

export function Preview({kicker, title, meta, metaContent, overview, children}: PreviewProps): React.ReactElement {
  const {colour} = useTheme();
  // Web `.details-panel`: meta and overview are --dp-soft (ink 88% over the surface) at weight 600.
  const soft = blend(colour.ink, colour.surface, 0.88);
  return (
    <Box x={153.6} y={259.2} w={455} pointerEvents="box-none">
      {kicker ? (
        <T size={12.288} weight={820} ls={0.983} color="#cf3157" upper lh={18.4} lines={1}>
          {kicker}
        </T>
      ) : null}
      <View style={{marginTop: u(25.9), width: u(373.2)}}>
        <BalancedT key={title} width={373.2} size={69.12} weight={560} ls={-4.9766} lh={62.2} color={colour.ink}>
          {title}
        </BalancedT>
      </View>
      {(meta && meta.length > 0) || metaContent ? (
        <View style={{marginTop: u(27), flexDirection: 'row', flexWrap: 'wrap'}}>
          {meta?.map((run, index) => (
            <View key={`${index}:${run}`} style={{marginRight: u(12.8)}}>
              <T size={13.056} weight={600} lh={19.6} color={soft}>
                {run}
              </T>
            </View>
          ))}
          {metaContent}
        </View>
      ) : null}
      {overview ? (
        <View style={{marginTop: u(meta && meta.length > 0 ? 21.6 : 21.6), width: u(324)}}>
          <T size={13.824} weight={600} lh={21.8} color={soft} lines={5}>
            {overview}
          </T>
        </View>
      ) : null}
      {children}
    </Box>
  );
}
