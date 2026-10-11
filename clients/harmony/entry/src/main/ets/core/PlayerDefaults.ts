// core/PlayerDefaults.ts: the device-local playback defaults (Settings > Player), as web lib/playerDefaults.ts and
// lib/qualityMatrix.ts: a default quality (Original or one cell of the tier x level matrix) and default subtitles.

export interface QualityOption {
  id: string;
  mbps: number;
  level: string;
}

export interface QualityTier {
  id: string;
  label: string;
  resolution: string;
  options: QualityOption[];
}

export const QUALITY_LEVELS: string[] = ["Low", "Medium", "High"];

export const QUALITY_TIERS: QualityTier[] = [
  { id: "uhd", label: "UHD", resolution: "2160p", options: [
    { id: "h264-2160p-12mbps", mbps: 12, level: "Low" },
    { id: "h264-2160p-20mbps", mbps: 20, level: "Medium" },
    { id: "h264-2160p-35mbps", mbps: 35, level: "High" } ] },
  { id: "fhd", label: "FHD", resolution: "1080p", options: [
    { id: "h264-1080p-4mbps", mbps: 4, level: "Low" },
    { id: "h264-1080p-8mbps", mbps: 8, level: "Medium" },
    { id: "h264-1080p-12mbps", mbps: 12, level: "High" } ] },
  { id: "hd", label: "HD", resolution: "720p", options: [
    { id: "h264-720p-2mbps", mbps: 2, level: "Low" },
    { id: "h264-720p-4mbps", mbps: 4, level: "Medium" },
    { id: "h264-720p-6mbps", mbps: 6, level: "High" } ] },
  { id: "sd", label: "SD", resolution: "480p", options: [
    { id: "h264-480p-1mbps", mbps: 1, level: "Low" },
    { id: "h264-480p-2mbps", mbps: 2, level: "Medium" },
    { id: "h264-480p-3mbps", mbps: 3, level: "High" } ] },
];

export const ORIGINAL_QUALITY: string = "original";

/** A stored quality id, or Original when it is unknown (web `isQualityDefault`). */
export function normaliseQuality(raw: string): string {
  if (raw === ORIGINAL_QUALITY) {
    return raw;
  }
  for (const tier of QUALITY_TIERS) {
    for (const option of tier.options) {
      if (option.id === raw) {
        return raw;
      }
    }
  }
  return ORIGINAL_QUALITY;
}

/** off, forced or always; anything else is off. */
export function normaliseSubtitleMode(raw: string): string {
  return raw === "forced" || raw === "always" ? raw : "off";
}

/** A lower-cased, trimmed language code; English when empty. */
export function normaliseSubtitleLanguage(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "en";
}
