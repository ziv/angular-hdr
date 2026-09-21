import { readFileSync } from 'node:fs';
import type { IccProfile } from '../png/color-chunks';

/** Reads a color profile from `public/`; `ng test` runs with the workspace root as working directory. */
function readProfile(file: string, name: string): IccProfile {
  return { name, profile: new Uint8Array(readFileSync(`public/${file}`)) };
}

/** The two bundled ICC profiles, for specs. The app itself fetches them over HTTP. */
export const testProfiles = {
  hdr: readProfile('rec2100-pq.icc', 'Rec2100 PQ'),
  sdr: readProfile('sRGB-v4.icc', 'sRGB'),
};
