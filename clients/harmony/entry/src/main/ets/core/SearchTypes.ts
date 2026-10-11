// core/SearchTypes.ts: the Search Type filter, as web pages/Search.tsx (SEARCH_TYPES, workMatchesType).
// Playlists and Games are not searchable on Harmony yet, so they are not offered.

export interface SearchTypeChoice {
  value: string;
  label: string;
}

const KIND_CHOICES: SearchTypeChoice[] = [
  { value: "movie", label: "Movies" },
  { value: "series", label: "Series" },
  { value: "site", label: "Sites" },
  { value: "artist", label: "Music" },
];

/** "All" plus a choice for each kind the server has, in web's order. */
export function searchTypeChoices(availableKinds: string[]): SearchTypeChoice[] {
  const choices: SearchTypeChoice[] = [{ value: "all", label: "All" }];
  for (const choice of KIND_CHOICES) {
    if (availableKinds.indexOf(choice.value) !== -1) {
      choices.push(choice);
    }
  }
  return choices;
}

export function workMatchesType(workKind: string, mediaType: string): boolean {
  return mediaType === "all" || workKind === mediaType;
}
