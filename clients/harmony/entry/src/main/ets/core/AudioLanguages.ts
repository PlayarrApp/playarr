// core/AudioLanguages.ts: the default audio language choices, as web pages/settings/Player.tsx.
export interface AudioLanguage {
  value: string;
  label: string;
}

export const AUDIO_LANGUAGES: AudioLanguage[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
  { value: "ar", label: "Arabic" },
  { value: "th", label: "Thai" },
];

/** A server value that is not one of the choices reads as English, as web does. */
export function normaliseAudioLanguage(value: string): string {
  return AUDIO_LANGUAGES.some((choice) => choice.value === value) ? value : "en";
}

export function audioLanguageLabel(value: string): string {
  const found = AUDIO_LANGUAGES.find((choice) => choice.value === value);
  return found !== undefined ? found.label : "English";
}
