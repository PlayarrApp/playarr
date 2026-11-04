/**
 * The player's audio track label, in step with the web client's `trackLabels.ts` (and the Android `PlayarrTrackLabels.kt`):
 * the language name, the track's own title when it adds something, the codec label and the channel layout, joined with " · ".
 * The tracks come from the negotiation (`PlaybackInfo.audio_tracks`), as the web does for HLS, because the Vega engine
 * exposes the stream's tracks only once Shaka has parsed the manifest and not at all for a paused first frame.
 */
const SEPARATOR = ' · ';

const BIBLIOGRAPHIC: Record<string, string> = {fre: 'fra', ger: 'deu', dut: 'nld', chi: 'zho', cze: 'ces', gre: 'ell', ice: 'isl', mac: 'mkd', mao: 'mri', may: 'msa', per: 'fas', rum: 'ron', slo: 'slk', tib: 'bod', wel: 'cym', arm: 'hye', baq: 'eus', bur: 'mya', geo: 'kat', alb: 'sqi'};

/** Language names for the codes Hermes cannot name through `Intl.DisplayNames` (a build without ICU data returns the code). */
const LANGUAGE_NAMES: Record<string, string> = {eng: 'English', fra: 'French', deu: 'German', spa: 'Spanish', ita: 'Italian', por: 'Portuguese', nld: 'Dutch', rus: 'Russian', jpn: 'Japanese', kor: 'Korean', zho: 'Chinese', ara: 'Arabic', hin: 'Hindi', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', pol: 'Polish', tur: 'Turkish', ell: 'Greek', heb: 'Hebrew', ces: 'Czech', hun: 'Hungarian', ron: 'Romanian', ukr: 'Ukrainian', tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian'};

export interface AudioTrackLabelInput {
  label: string;
  language?: string | null;
  codec?: string | null;
  channels?: number | null;
}

function languageName(code: string | null | undefined): string | undefined {
  const trimmed = code?.trim().toLowerCase();
  if (!trimmed || trimmed === 'und') return undefined;
  const canonical = BIBLIOGRAPHIC[trimmed] ?? trimmed;
  try {
    const name = new Intl.DisplayNames(['en'], {type: 'language'}).of(canonical);
    if (name && name.toLowerCase() !== canonical) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    // No Intl.DisplayNames on this engine: use the table below.
  }
  return LANGUAGE_NAMES[canonical] ?? trimmed;
}

function trackTitle(label: string, code: string | null | undefined, name: string | undefined): string | undefined {
  const title = label.trim();
  if (!title) return undefined;
  const normalised = title.toLowerCase();
  if (normalised === code?.trim().toLowerCase()) return undefined;
  if (name && normalised.includes(name.toLowerCase())) return undefined;
  if (/^(audio|subtitles?)\s*\d+$/.test(normalised)) return undefined;
  return title;
}

function channelLayout(channels: number | null | undefined): string | undefined {
  switch (channels) {
    case null:
    case undefined:
    case 0:
      return undefined;
    case 1:
      return 'Mono';
    case 2:
      return 'Stereo';
    case 3:
      return '2.1';
    case 4:
      return '4.0';
    case 5:
      return '5.0';
    case 6:
      return '5.1';
    case 7:
      return '6.1';
    case 8:
      return '7.1';
    default:
      return `${channels} ch`;
  }
}

/** A readable codec name from the server's raw ffprobe codec (`ac3` is `AC3`, `truehd` is `TrueHD`). */
export function audioCodecName(codec: string | null | undefined): string | undefined {
  const value = codec?.trim().toLowerCase();
  if (!value) return undefined;
  if (value.startsWith('pcm')) return 'PCM';
  switch (value) {
    case 'ac3':
      return 'AC3';
    case 'eac3':
      return 'E-AC3';
    case 'truehd':
      return 'TrueHD';
    case 'opus':
      return 'Opus';
    case 'vorbis':
      return 'Vorbis';
    default:
      return value.toUpperCase();
  }
}

export function audioTrackLabel(track: AudioTrackLabelInput): string {
  const name = languageName(track.language);
  const parts = [name, trackTitle(track.label, track.language, name), track.codec?.trim() || undefined, channelLayout(track.channels)].filter((part): part is string => Boolean(part));
  return parts.join(SEPARATOR) || track.label;
}
