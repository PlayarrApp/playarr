import {audioCodecName, audioTrackLabel} from './trackLabels';

describe('trackLabels', () => {
  it('joins language, title, codec and channels like the web', () => {
    expect(audioTrackLabel({label: 'eng · TrueHD Atmos 7.1', language: 'eng', codec: 'TrueHD Atmos', channels: 8})).toBe('English · eng · TrueHD Atmos 7.1 · TrueHD Atmos · 7.1');
  });
  it('drops a title that only repeats the language and a generic Audio n', () => {
    expect(audioTrackLabel({label: 'English', language: 'eng', codec: 'AAC', channels: 2})).toBe('English · AAC · Stereo');
    expect(audioTrackLabel({label: 'Audio 2', language: 'deu', channels: 6})).toBe('German · 5.1');
  });
  it('names raw codecs', () => {
    expect(audioCodecName('eac3')).toBe('E-AC3');
    expect(audioCodecName('pcm_s16le')).toBe('PCM');
  });
});
