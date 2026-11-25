import type { Post, Publication, Site } from './types.js';

/** Demo records are identical across the local and production stores. */
export function demoContent(timestamp = Date.now()) {
  const now = new Date(timestamp).toISOString();
  const ago = (days: number) => new Date(timestamp - days * 86400_000).toISOString();
  const sites: Site[] = [
    { id: 'site-journal', name: 'The Sunday Edit', url: 'https://thesundayedit.example', platform: 'demo', searchConsoleProperty: '', credentialKey: 'SUNDAY_EDIT', createdAt: ago(12) },
    { id: 'site-studio', name: 'Studio Notes', url: 'https://studionotes.example', platform: 'demo', searchConsoleProperty: '', credentialKey: 'STUDIO_NOTES', createdAt: ago(8) },
    { id: 'site-field', name: 'Fieldwork Journal', url: 'https://fieldwork.example', platform: 'demo', searchConsoleProperty: '', credentialKey: 'FIELDWORK', createdAt: ago(4) },
  ];
  const posts: Post[] = [
    { id: 'post-slow', title: 'The art of slowing down in a busy world', slug: 'the-art-of-slowing-down', excerpt: 'Small rituals that make room for the things that matter.', content: 'A little space goes a long way. Some of our best ideas arrive when we give them room. A quiet morning, an unhurried walk, or a notebook left open can change the rhythm of a day.\n\nStart small. Choose one daily ritual that helps you pay attention, and protect a few minutes for it.\n\nThere is no perfect routine. Notice what leaves you feeling clearer, and let that be your starting point.', status: 'published', siteIds: ['site-journal', 'site-studio'], createdAt: ago(5), updatedAt: ago(2) },
    { id: 'post-story', title: 'Why every brand needs a better story', slug: 'why-every-brand-needs-a-better-story', excerpt: 'Finding the thread that connects your work to your audience.', content: 'A useful brand story begins with the people you want to help. What do they care about? What would make their day easier?\n\nWrite down one specific example of how your work makes a difference. Build the story around that moment.', status: 'draft', siteIds: ['site-studio'], createdAt: ago(2), updatedAt: ago(1) },
    { id: 'post-ideas', title: 'A practical guide to collecting good ideas', slug: 'a-practical-guide-to-collecting-good-ideas', excerpt: 'Build a simple system for noticing, saving, and developing inspiration.', content: 'Good ideas rarely arrive fully formed. Keep a running list of questions, observations, and small things that catch your attention.\n\nOnce a week, revisit your collection and choose one idea to explore in more detail.', status: 'draft', siteIds: [], createdAt: ago(1), updatedAt: now },
  ];
  const publications: Publication[] = posts[0]!.siteIds.map(siteId => {
    const site = sites.find(site => site.id === siteId)!;
    return { id: `publication-${siteId}`, postId: posts[0]!.id, siteId, url: `${site.url}/${posts[0]!.slug}/`, status: 'published', mode: 'demo', error: null, publishedAt: ago(2), indexingStatus: 'not_inspected', lastInspectedAt: null };
  });
  return { sites, posts, publications };
}
