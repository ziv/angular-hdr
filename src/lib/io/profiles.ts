import type { IccProfile } from '../png/color-chunks';
import type { ExportFormat } from './export';

/** The profiles live in `public/`, so they are served from the application's base URL. */
const SOURCES: Record<ExportFormat, { name: string; file: string }> = {
  hdr: { name: 'Rec2100 PQ', file: 'rec2100-pq.icc' },
  sdr: { name: 'sRGB', file: 'sRGB-v4.icc' },
};

export type ProfileLoader = (format: ExportFormat) => Promise<IccProfile>;

async function fetchProfile(name: string, url: URL): Promise<IccProfile> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Could not load the ${name} color profile (HTTP ${response.status})`);
  return { name, profile: new Uint8Array(await response.arrayBuffer()) };
}

/**
 * Creates a loader for the ICC profiles that are embedded into exported files; each one is fetched once.
 * `baseUrl` is the document's base URI. It has to be passed in because this also runs in a worker,
 * where a relative URL would resolve against the worker script instead.
 */
export function createProfileLoader(baseUrl: string): ProfileLoader {
  const cache = new Map<ExportFormat, Promise<IccProfile>>();
  return (format) => {
    let profile = cache.get(format);
    if (!profile) {
      const { name, file } = SOURCES[format];
      profile = fetchProfile(name, new URL(file, baseUrl));
      cache.set(format, profile);
    }
    return profile;
  };
}
