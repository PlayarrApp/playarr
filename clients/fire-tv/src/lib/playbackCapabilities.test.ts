import {negotiationErrorText, playbackCapabilities, VEGA_PLAYBACK_CAPABILITIES} from './playbackCapabilities';
import {DEFAULT_PLAYER_DEFAULTS, readPlayerDefaults, writePlayerDefaults} from './playerDefaults';

describe('playbackCapabilities', () => {
  it('declares the device caps: 10-bit HEVC up to 4K, HDR10 and HLG, 6 channels, no Dolby Vision', () => {
    expect(VEGA_PLAYBACK_CAPABILITIES).toMatchObject({hdr: 'hdr10,hlg', maxBitDepth: 10, maxWidth: 3840, maxHeight: 2160, maxChannels: 6, passthrough: 'eac3,ac3'});
    expect(VEGA_PLAYBACK_CAPABILITIES.dvProfiles).toBeUndefined();
  });
  it('sends the force flags only when they are on', () => {
    expect(playbackCapabilities(DEFAULT_PLAYER_DEFAULTS)).not.toHaveProperty('forceDirectVideo');
    expect(playbackCapabilities(DEFAULT_PLAYER_DEFAULTS)).not.toHaveProperty('forceDirectAudio');
    expect(playbackCapabilities({forceDirectVideo: true, forceDirectAudio: false})).toMatchObject({forceDirectVideo: true});
    expect(playbackCapabilities({forceDirectVideo: false, forceDirectAudio: true})).toMatchObject({forceDirectAudio: true});
  });
  it('keeps the quality profile of a chosen rendition', () => {
    expect(playbackCapabilities(DEFAULT_PLAYER_DEFAULTS, {profile: 'fhd-medium', forceTranscode: true})).toMatchObject({profile: 'fhd-medium', forceTranscode: true});
  });
});

describe('force switches', () => {
  it('are off by default and persist', () => {
    const store = new Map<string, string>();
    const storage = {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v)} as unknown as Storage;
    expect(readPlayerDefaults(storage)).toMatchObject({forceDirectVideo: false, forceDirectAudio: false});
    writePlayerDefaults({...DEFAULT_PLAYER_DEFAULTS, forceDirectAudio: true}, storage);
    expect(readPlayerDefaults(storage)).toMatchObject({forceDirectVideo: false, forceDirectAudio: true});
  });
});

describe('negotiationErrorText', () => {
  it('shows the colour format message for a 422 and the busy message for a 503', () => {
    expect(negotiationErrorText('API request failed: 422 Unprocessable Entity')).toBe("This title's colour format can't be converted for this device.");
    expect(negotiationErrorText('API request failed: 503 Service Unavailable')).toMatch(/busy/);
    expect(negotiationErrorText('boom')).toMatch(/could not prepare/);
  });
});

describe('VEGA_PLAYBACK_CAPABILITIES', () => {
  it('advertises the containers and video codecs the device decodes, so the server can pick direct play', () => {
    expect(VEGA_PLAYBACK_CAPABILITIES.containers?.split(',')).toEqual(expect.arrayContaining(['mp4', 'mkv']));
    expect(VEGA_PLAYBACK_CAPABILITIES.videoCodecs?.split(',')).toEqual(expect.arrayContaining(['h264', 'hevc']));
  });

  it('lists real audio codec support', () => {
    expect(VEGA_PLAYBACK_CAPABILITIES.audioCodecs).toContain('aac');
    expect(VEGA_PLAYBACK_CAPABILITIES.audioCodecs).toContain('eac3');
  });
});
