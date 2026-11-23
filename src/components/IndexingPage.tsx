import { useState, type FormEvent } from 'react';
import { ArrowUpRight, CheckCircle2, CircleDashed, ExternalLink, FileSearch, Info, Loader2, Search, Send } from 'lucide-react';
import { api } from '../api';
import type { Post, Publication, Site } from '../types';
import './integrations.css';

interface Props {
  sites: Site[];
  posts: Post[];
  publications: Publication[];
  googleConfigured: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (message: string) => void;
}
const labels: Record<Publication['indexingStatus'], string> = { indexed: 'Indexed', not_indexed: 'Not indexed', not_inspected: 'Not inspected', inspection_failed: 'Inspection failed' };
export function IndexingPage({ sites, posts, publications, googleConfigured, onRefresh, onNotify }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [sitemap, setSitemap] = useState('');
  const [error, setError] = useState('');
  const eligibleSites = sites.filter(site => site.platform !== 'demo' && site.searchConsoleProperty);
  const selectedSite = eligibleSites.find(site => site.id === siteId) || eligibleSites[0];
  const published = publications.filter(publication => publication.status === 'published');
  const live = published.filter(publication => publication.mode === 'live');
  const indexed = live.filter(publication => publication.indexingStatus === 'indexed').length;
  const visible = published.filter(publication => {
    const post = posts.find(item => item.id === publication.postId);
    const site = sites.find(item => item.id === publication.siteId);
    return (filter === 'all' || (filter === 'live' ? publication.mode === 'live' : publication.mode === 'demo')) && `${post?.title || ''} ${site?.name || ''} ${publication.url}`.toLowerCase().includes(query.toLowerCase());
  });
  async function inspect(publication: Publication) {
    setInspecting(publication.id); setError('');
    try { await api(`/publications/${publication.id}/inspect`, { method: 'POST' }); await onRefresh(); onNotify('Latest indexing status received from Google.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not inspect URL.'); await onRefresh().catch(() => {}); }
    finally { setInspecting(null); }
  }
  async function submitSitemap(event: FormEvent) {
    event.preventDefault(); if (!selectedSite) return;
    setSubmitting(true); setError('');
    try { await api(`/sites/${selectedSite.id}/sitemap`, { method: 'POST', body: JSON.stringify({ url: sitemap.trim() || `${selectedSite.url.replace(/\/$/, '')}/sitemap.xml` }) }); onNotify('Sitemap submitted to Search Console. Google decides when to crawl and index.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not submit sitemap.'); }
    finally { setSubmitting(false); }
  }
  return <section className="indexing-page integration-page">
    <div className="integration-heading"><div><span className="integration-eyebrow">HELP YOUR WORDS GET FOUND</span><h1>A clearer view of search.</h1><p>Check your published URLs and give Google a map to your content.</p></div><a className="ig-button ig-button-outline" href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Search Console <ArrowUpRight size={16} /></a></div>
    <div className="indexing-notice"><Info size={20} /><div><strong>Discovery starts here. Indexing is up to Google.</strong><p>Submit sitemaps and inspect URLs through Search Console. Ordinary blog posts cannot use Google’s Indexing API to force indexing.</p></div></div>
    <div className="indexing-stats"><article><span>Live published URLs</span><strong>{live.length}</strong><small>Across your connected websites</small></article><article><span>Confirmed indexed</span><strong>{indexed}<CheckCircle2 size={20} /></strong><small>Based on your latest inspections</small></article><article><span>Awaiting inspection</span><strong>{live.filter(item => item.indexingStatus === 'not_inspected' || item.indexingStatus === 'inspection_failed').length}</strong><small>Demo publications are excluded</small></article></div>
    {!googleConfigured && <div className="google-setup"><FileSearch size={22} /><div><strong>Connect Google to inspect URLs</strong><p>Set <code>GOOGLE_ACCESS_TOKEN</code> on the server with Search Console access. You can also inspect URLs directly in Search Console.</p></div><span className="ig-tag ig-tag-amber">Setup needed</span></div>}
    {error && <div className="ig-error" role="alert">{error}</div>}
    <div className="indexing-table-wrap"><div className="indexing-table-toolbar"><h3>Published URLs <span>{published.length}</span></h3><div><label className="ig-search"><Search size={16} /><input aria-label="Search published URLs" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search URLs…" /></label><select aria-label="Filter publication type" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All publications</option><option value="live">Live only</option><option value="demo">Demo only</option></select></div></div>
      {visible.length ? <div className="ig-table-scroll" tabIndex={0} role="region" aria-label="Published URLs, scroll horizontally for details"><table className="indexing-table"><thead><tr><th>POST & WEBSITE</th><th>GOOGLE INDEXING</th><th>LAST INSPECTED</th><th><span className="ig-sr-only">Actions</span></th></tr></thead><tbody>{visible.map(publication => {
        const post = posts.find(item => item.id === publication.postId);
        const site = sites.find(item => item.id === publication.siteId);
        const canInspect = publication.mode === 'live' && googleConfigured && !!site?.searchConsoleProperty;
        return <tr key={publication.id}><td><strong>{post?.title || 'Deleted post'}</strong><span>{site?.name || 'Website'} <span className="ig-table-bullet">·</span> {publication.mode === 'demo' ? <span className="ig-demo-text">Demo publication</span> : <a href={publication.url} target="_blank" rel="noreferrer">View post <ArrowUpRight size={12} /></a>}</span></td><td><span className={`ig-tag ${publication.indexingStatus === 'indexed' && publication.mode === 'live' ? 'ig-tag-green' : 'ig-tag-neutral'}`}><CircleDashed size={13} />{publication.mode === 'demo' ? 'Demo · not inspected' : labels[publication.indexingStatus]}</span></td><td className="ig-date">{publication.lastInspectedAt ? new Date(publication.lastInspectedAt).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Ljubljana' }) : '—'}</td><td><button className="ig-button ig-button-small" disabled={!canInspect || inspecting !== null} title={publication.mode === 'demo' ? 'Demo URLs cannot be inspected by Google' : !site?.searchConsoleProperty ? 'Add this website’s Search Console property first' : !googleConfigured ? 'Configure Google access on the server first' : 'Read the latest status from Google'} onClick={() => void inspect(publication)}>{inspecting === publication.id ? <Loader2 size={14} className="ig-spin" /> : <Search size={14} />}Inspect</button></td></tr>;
      })}</tbody></table></div> : <div className="ig-empty"><FileSearch size={30} /><h3>{query || filter !== 'all' ? 'No matching URLs' : 'Your published words will appear here'}</h3><p>{query || filter !== 'all' ? 'Try another search or publication filter.' : 'Publish your first post to start tracking its search visibility.'}</p></div>}
    </div>
    <p className="ig-scroll-hint">Swipe the table to see more details →</p>
    <div className="sitemap-card"><div><span className="integration-eyebrow">GIVE GOOGLE THE BIG PICTURE</span><h3>Submit your sitemap</h3><p>A sitemap helps Google discover your pages. Your website must generate and serve it first.</p><a href="https://support.google.com/webmasters/answer/7451001" target="_blank" rel="noreferrer">How sitemaps work <ExternalLink size={13} /></a></div><form onSubmit={event => void submitSitemap(event)}><label>Website<select value={selectedSite?.id || ''} onChange={event => { setSiteId(event.target.value); setSitemap(''); }} disabled={!eligibleSites.length}><option value="" disabled>Select a verified website</option>{eligibleSites.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label><label>Sitemap URL<input type="url" value={sitemap} onChange={event => setSitemap(event.target.value)} placeholder={selectedSite ? `${selectedSite.url.replace(/\/$/, '')}/sitemap.xml` : 'https://yourwebsite.com/sitemap.xml'} disabled={!eligibleSites.length} /></label><button className="ig-button ig-button-dark" disabled={!googleConfigured || !selectedSite || submitting}>{submitting ? <Loader2 size={15} className="ig-spin" /> : <Send size={15} />}{submitting ? 'Submitting…' : 'Submit sitemap'}</button>{!eligibleSites.length && <p className="ig-form-help">Add a live website with its Search Console property to get started.</p>}</form></div>
  </section>;
}
