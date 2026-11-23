import { readFile, realpath } from './files.js';
import { resolve } from 'node:path';
import { z } from 'zod';
import { readLiteralExport } from './source.js';

/** Re-read both route catalogs before preparing or saving a database draft. */
export async function assertMediaspedSourceSlugAvailable(root: string, slug: string) {
  const catalogs = [
    ['src/data/logisticsGuides.ts', 'logisticsGuides'],
    ['src/data/logisticsGuideSummaries.ts', 'guideSummaries'],
  ];
  for (const [path, variable] of catalogs) {
    const file = await realpath(resolve(root, path));
    if (file !== resolve(root, path)) throw new Error('The static guide catalog must be a regular source file.');
    const source = await readFile(file, 'utf8');
    const guides = z.array(z.object({ slug: z.string().min(1) })).parse(readLiteralExport(source, variable));
    if (guides.some(guide => guide.slug === slug)) throw new Error('This slug is reserved by a current Mediašped source guide. Choose a new slug so the database article will not be hidden.');
  }
}
