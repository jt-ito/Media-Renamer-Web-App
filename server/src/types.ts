export type MediaType = 'movie' | 'series';

export interface Library {
  id: string;
  name: string;
  type: MediaType;
  inputRoot?: string;
  outputRoot?: string;
  includeProviderTags?: boolean;
  linkMode?: 'hardlink' | 'rename';
  allowCopyFallback?: boolean;
}

export interface ParsedGuess {
  kind: 'movie' | 'series';
  title?: string;
  year?: number;
  season?: number;
  episodes?: number[];
  /** Primary episode number when available */
  episode_number?: number;
  /** Example parsed name using Jellyfin/Plex scheme for the primary episode */
  parsedName?: string;
  /** Example Jellyfin-style path (without extension) for the primary episode */
  jellyfinExample?: string;
  special?: boolean;
  absolute?: number[];
  confidence: number;
}

export interface ScanItem {
  id: string;
  path: string;
  size: number;
  ext: string;
  libraryId: string;
  inferred?: ParsedGuess;
}

export interface MatchCandidate {
  id: number;
  name: string;
  year?: number;
  type: MediaType;
  extra?: { imdb?: string; tmdb?: number };
}

export interface RenamePlan {
  from: string;
  to: string;
  action: 'hardlink' | 'rename';
  dryRun: boolean;
  meta: {
    tvdbId: number;
    type: MediaType;
    output: string;
  metadataTitle?: string;
  year?: number;
  };
}