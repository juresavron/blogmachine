import { useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, CheckCircle2, CircleDashed, ExternalLink, FileSearch, Info, Loader2, Search, Send, X } from 'lucide-react';
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
const statusFilters = [{ id: 'all', label: 'All URLs' }, { id: 'awaiting', label: 'Needs inspection' }, { id: 'indexed', label: 'Indexed' }, { id: 'not_indexed', label: 'Not indexed' }];

export function IndexingPage({ sites, posts, publications, googleConfigured, onRefresh, onNotify }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [sitemap, setSitemap] = useState('');
  const [error, setError] = useState('');
  const [sitemapError, setSitemapError] = useState('');
  const [submittedSitemap, setSubmittedSitemap] = useState('');
  const eligibleSites = sites.filter(site => site.platform !== 'demo' && site.searchConsoleProperty);
  const selectedSite = eligibleSites.find(site => site.id === siteId) || eligibleSites[0];
  const published = publications.filter(publication => publication.status === 'published');
  const live = published.filter(publication => publication.mode === 'live');
  const indexed = live.filter(publication => publication.indexingStatus === 'indexed').length;
  const awaiting = live.filter(publication => ['not_inspected', 'inspection_failed'].includes(publication.indexingStatus)).length;
  const visible = published.filter(publication => {
    const post = posts.find(item => item.id === publication.postId);
    const site = sites.find(item => item.id === publication.siteId);
    const matchesStatus = statusFilter === 'all' || (publication.mode === 'live' && (statusFilter === 'awaiting' ? ['not_inspected', 'inspection_failed'].includes(publication.indexingStatus) : publication.indexingStatus === statusFilter));
    return matchesStatus && (filter === 'all' || publication.mode === filter) && `${post?.title || ''} ${site?.name || ''} ${publication.url}`.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  async function inspect(publication: Publication) {
    setInspecting(publication.id); setError('');
    try { await api(`/publications/${publication.id}/inspect`, { method: 'POST' }); await onRefresh(); onNotify('Latest indexing status received from Google.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not inspect URL.'); await onRefresh().catch(() => {}); }
    finally { setInspecting(null); }
  }
  async function submitSitemap(event: FormEvent) {
    event.preventDefault(); if (!selectedSite) return;
    const submittedUrl = sitemap.trim() || `${selectedSite.url.replace(/\/$/, '')}/sitemap.xml`;
    setSubmitting(true); setSitemapError(''); setSubmittedSitemap('');
    try {
      await api(`/sites/${selectedSite.id}/sitemap`, { method: 'POST', body: JSON.stringify({ url: submittedUrl }) });
      setSubmittedSitemap(submittedUrl); onNotify('Sitemap submitted to Search Console. Google decides when to crawl and index.');
    } catch (cause) { setSitemapError(cause instanceof Error ? cause.message : 'Could not submit sitemap.'); }
    finally { setSubmitting(false); }
  }
  function clearFilters() { setQuery(''); setFilter('all'); setStatusFilter('all'); }
  const filtered = query.trim() || filter !== 'all' || statusFilter !== 'all';

  return <section className="indexing-page integration-page">
    <div className="integration-heading"><div><span className="integration-eyebrow">SEARCH & DISCOVERY</span><h1>Give your stories a little reach.</h1><p>Inspect published URLs and keep track of what Google can find.</p></div><a className="ig-button" href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Open Search Console <ArrowUpRight size={16} /></a></div>
    <div className="indexing-stats"><article><span>Live published URLs</span><strong>{live.length}</strong><small>Demo publications are excluded</small></article><article><span>Confirmed indexed</span><strong>{indexed}<CheckCircle2 size={22} /></strong><small>Based on the latest URL inspections</small></article><article><span>Needs inspection</span><strong>{awaiting}</strong><small>New URLs and unsuccessful inspections</small></article></div>
    {(!googleConfigured || !eligibleSites.length) && <div className="google-setup-guide"><div className="google-setup-guide-heading"><span className="discovery-icon"><FileSearch size={23} /></span><div><h2>Set up your search connection</h2><p>Your writing is ready. Connect a verified property to inspect live URLs.</p></div><span className="ig-tag ig-tag-amber">Setup needed</span></div><ol><li><span className={eligibleSites.length ? 'setup-step complete' : 'setup-step'}>{eligibleSites.length ? <CheckCircle2 size={17} /> : '1'}</span><div><strong>Add a verified website property</strong><p>Save your exact Search Console property in the website’s settings.</p><a href="#websites">Manage websites <ArrowRight size={14} /></a></div></li><li><span className={googleConfigured ? 'setup-step complete' : 'setup-step'}>{googleConfigured ? <CheckCircle2 size={17} /> : '2'}</span><div><strong>Connect Google on the server</strong><p>Add <code>GOOGLE_ACCESS_TOKEN</code> with access to your property and restart Blog Machine. Tokens expire and need refreshing.</p></div></li><li><span className={live.length ? 'setup-step complete' : 'setup-step'}>{live.length ? <CheckCircle2 size={17} /> : '3'}</span><div><strong>Publish to a live website</strong><p>Live publication URLs can be inspected here. Demo URLs stay local.</p></div></li></ol></div>}
    {googleConfigured && !!eligibleSites.length && <div className="google-ready"><CheckCircle2 size={18} /><span>Google token configured · {eligibleSites.length} website propert{eligibleSites.length === 1 ? 'y' : 'ies'} saved</span><small>Access is checked when you inspect a URL.</small></div>}
    {error && <div className="ig-error" role="alert">{error}</div>}
    <div className="indexing-table-wrap"><div className="indexing-table-toolbar"><h2>Published URLs <span>{published.length}</span></h2><div><label className="ig-search"><Search size={17} /><input aria-label="Search published URLs" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a post or URL…" />{query && <button aria-label="Clear URL search" onClick={() => setQuery('')}><X size={14} /></button>}</label><select aria-label="Filter publication type" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All publications</option><option value="live">Live only</option><option value="demo">Demo only</option></select></div></div>
      <div className="indexing-status-filters" aria-label="Filter by indexing status">{statusFilters.map(item => <button key={item.id} aria-pressed={statusFilter === item.id} onClick={() => setStatusFilter(item.id)}>{item.label}{item.id === 'awaiting' && <span>{awaiting}</span>}</button>)}<span className="indexing-result-count" role="status">{visible.length} result{visible.length === 1 ? '' : 's'}</span></div>
      {visible.length ? <div className="ig-table-scroll" tabIndex={0} role="region" aria-label="Published URLs, scroll horizontally for details"><table className="indexing-table"><thead><tr><th scope="col">POST & WEBSITE</th><th scope="col">GOOGLE INDEXING</th><th scope="col">LAST INSPECTED</th><th scope="col"><span className="ig-sr-only">Actions</span></th></tr></thead><tbody>{visible.map(publication => {
        const post = posts.find(item => item.id === publication.postId);
        const site = sites.find(item => item.id === publication.siteId);
        const disabledReason = publication.mode === 'demo' ? 'Demo URL · local only' : !site?.searchConsoleProperty ? 'Add a search property first' : !googleConfigured ? 'Connect Google first' : '';
        return <tr key={publication.id}><td><strong>{post?.title || 'Deleted post'}</strong><span>{site?.name || 'Website'} <span className="ig-table-bullet">·</span> {publication.mode === 'demo' ? <span className="ig-demo-text">Demo publication</span> : <a href={publication.url} target="_blank" rel="noreferrer">View article <ArrowUpRight size={12} /></a>}</span></td><td><span className={`ig-tag ${publication.indexingStatus === 'indexed' && publication.mode === 'live' ? 'ig-tag-green' : publication.indexingStatus === 'inspection_failed' && publication.mode === 'live' ? 'ig-tag-amber' : 'ig-tag-neutral'}`}>{publication.indexingStatus === 'indexed' && publication.mode === 'live' ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}{publication.mode === 'demo' ? 'Demo · not inspected' : labels[publication.indexingStatus]}</span></td><td className="ig-date">{publication.lastInspectedAt ? new Date(publication.lastInspectedAt).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Ljubljana' }) : 'Not yet'}</td><td><button className="ig-button ig-button-small" disabled={!!disabledReason || inspecting !== null} title={disabledReason || 'Read the latest status from Google'} onClick={() => void inspect(publication)}>{inspecting === publication.id ? <Loader2 size={14} className="ig-spin" /> : <Search size={14} />}{inspecting === publication.id ? 'Inspecting…' : 'Inspect URL'}</button>{disabledReason && <span className="inspection-unavailable">{disabledReason}</span>}</td></tr>;
      })}</tbody></table></div> : <div className="ig-empty"><FileSearch size={32} /><h3>{filtered ? 'No URLs in this view' : 'Your published stories will appear here'}</h3><p>{filtered ? 'Try a different search, publication type, or indexing status.' : 'Publish a post to a live website to start tracking its search visibility.'}</p>{filtered ? <button className="ig-button" onClick={clearFilters}>Clear filters</button> : <a className="ig-button" href="#posts">Go to posts <ArrowRight size={15} /></a>}</div>}
    </div>
    <p className="ig-scroll-hint">Swipe the table to see more details →</p>
    <div className="sitemap-card"><div><span className="integration-eyebrow">A MAP TO YOUR CONTENT</span><h2>Help Google find the way.</h2><p>Submit an existing sitemap for a verified website. Your website needs to generate and serve it first.</p><div className="sitemap-note"><Info size={17} /><p>Google decides when to crawl and index. Ordinary blog posts cannot use the Google Indexing API to force indexing.</p></div><a href="https://support.google.com/webmasters/answer/7451001" target="_blank" rel="noreferrer">How sitemaps work <ExternalLink size={13} /></a></div><form onSubmit={event => void submitSitemap(event)}><label>Website<select value={selectedSite?.id || ''} onChange={event => { setSiteId(event.target.value); setSitemap(''); setSubmittedSitemap(''); setSitemapError(''); }} disabled={!eligibleSites.length || submitting}><option value="" disabled>Select a verified website</option>{eligibleSites.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label><label>Sitemap URL<input type="url" value={sitemap} onChange={event => { setSitemap(event.target.value); setSubmittedSitemap(''); setSitemapError(''); }} placeholder={selectedSite ? `${selectedSite.url.replace(/\/$/, '')}/sitemap.xml` : 'https://yourwebsite.com/sitemap.xml'} disabled={!eligibleSites.length || submitting} /></label>{selectedSite && <p className="ig-form-help">Leave blank to use <code>{selectedSite.url.replace(/\/$/, '')}/sitemap.xml</code>.</p>}<button className="ig-button ig-button-dark" disabled={!googleConfigured || !selectedSite || submitting}>{submitting ? <Loader2 size={15} className="ig-spin" /> : <Send size={15} />}{submitting ? 'Submitting…' : 'Submit sitemap'}</button>{!eligibleSites.length ? <p className="ig-form-help">Add a live website and its Search Console property in <a href="#websites">website settings</a>.</p> : !googleConfigured && <p className="ig-form-help">Connect Google on the server to enable submission.</p>}{sitemapError && <div className="ig-error sitemap-feedback" role="alert">{sitemapError}</div>}{submittedSitemap && <div className="sitemap-success" role="status"><CheckCircle2 size={18} /><div><strong>Sitemap submitted</strong><p>{submittedSitemap}</p><small>Submission does not guarantee crawling or indexing.</small></div></div>}</form></div>
  </section>;
}
