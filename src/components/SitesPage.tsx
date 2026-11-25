import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight, Globe2, Info, KeyRound, Link2, Loader2, Plus, Search, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import { api } from '../api';
import type { Site } from '../types';
import './integrations.css';

interface Props {
  sites: Site[];
  onRefresh: () => Promise<void>;
  onNotify: (message: string) => void;
}
interface DiscoveryResult {
  url: string;
  platform: 'wordpress' | 'unknown';
  reachable: boolean;
  wordpressDetected: boolean;
  credentialsRequired: boolean;
  message: string;
}
interface ConnectionResult { authenticated: boolean; canPublish: boolean | null; message: string; }
const platformNames: Record<Site['platform'], string> = { demo: 'Demo website', wordpress: 'WordPress', manual: 'Manual export' };

export function SitesPage({ sites, onRefresh, onNotify }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const [deleting, setDeleting] = useState<Site | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<Site['platform']>('wordpress');
  const [property, setProperty] = useState('');
  const [credentialKey, setCredentialKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [discoveryUrl, setDiscoveryUrl] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discoveryError, setDiscoveryError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [connectionResults, setConnectionResults] = useState<Record<string, ConnectionResult>>({});
  const modalRef = useRef<HTMLElement>(null);
  const modalOpen = showAdd || !!deleting;
  const visible = sites.filter(site => (platformFilter === 'all' || site.platform === platformFilter) && `${site.name} ${site.url}`.toLowerCase().includes(query.trim().toLowerCase()));
  const wordpress = sites.filter(site => site.platform === 'wordpress');

  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (modalRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? modalRef.current?.querySelector<HTMLElement>('input:not(:disabled), button'))?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, [modalOpen]);

  function openAdd() { setEditing(null); setError(''); setName(''); setUrl(''); setPlatform('wordpress'); setProperty(''); setCredentialKey(''); setShowAdd(true); }
  function openEdit(site: Site) { setEditing(site); setError(''); setName(site.name); setUrl(site.url); setPlatform(site.platform); setProperty(site.searchConsoleProperty); setCredentialKey(site.credentialKey); setShowAdd(true); }
  function prepareDiscoveredWebsite(result: DiscoveryResult, type: Site['platform']) {
    openAdd();
    const hostname = new URL(result.url).hostname.replace(/^www\./, '');
    const shortName = hostname.split('.')[0] || hostname;
    setName(shortName.charAt(0).toUpperCase() + shortName.slice(1));
    setUrl(result.url); setPlatform(type);
    setCredentialKey(shortName.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^[^A-Z]+/, '').slice(0, 60) || 'WEBSITE');
  }
  async function discoverWebsite(event: FormEvent) {
    event.preventDefault(); setDiscovering(true); setDiscovery(null); setDiscoveryError('');
    try { setDiscovery(await api<DiscoveryResult>('/connections/discover', { method: 'POST', body: JSON.stringify({ url: discoveryUrl.trim() }) })); }
    catch (cause) { setDiscoveryError(cause instanceof Error ? cause.message : 'Could not check this website. No connection has been saved.'); }
    finally { setDiscovering(false); }
  }
  async function testConnection(site: Site) {
    setTesting(site.id);
    setConnectionResults(previous => { const next = { ...previous }; delete next[site.id]; return next; });
    try {
      const result = await api<ConnectionResult>(`/sites/${site.id}/test-connection`, { method: 'POST' });
      setConnectionResults(previous => ({ ...previous, [site.id]: result }));
    } catch (cause) {
      setConnectionResults(previous => ({ ...previous, [site.id]: { authenticated: false, canPublish: null, message: cause instanceof Error ? cause.message : 'The connection could not be verified. Check website access and server credentials.' } }));
    } finally { setTesting(null); }
  }
  async function addSite(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const settings = { name: name.trim(), searchConsoleProperty: property.trim(), ...(credentialKey.trim() ? { credentialKey: credentialKey.trim() } : {}) };
      await api(editing ? `/sites/${editing.id}` : '/sites', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(editing ? settings : { ...settings, url: url.trim(), platform }) });
      setShowAdd(false);
      if (editing) setConnectionResults(previous => { const next = { ...previous }; delete next[editing.id]; return next; });
      onNotify(editing ? 'Website settings saved.' : platform === 'demo' ? 'Demo website added.' : platform === 'manual' ? 'Website added. Export posts from your library to publish manually.' : 'Website added. Configure and test its publishing credentials next.');
      await onRefresh().catch(() => setPageError('Your website was saved, but the list could not refresh. Reload the workspace to see the latest changes.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save website.'); }
    finally { setSaving(false); }
  }
  async function removeSite(site: Site) {
    setRemoving(site.id); setPageError('');
    try {
      await api(`/sites/${site.id}`, { method: 'DELETE' }); setDeleting(null);
      onNotify(`${site.name} removed. Your posts and remote website content are kept.`);
      await onRefresh().catch(() => setPageError('The website was removed, but the list could not refresh. Reload the workspace to see the latest changes.'));
    }
    catch (cause) { setPageError(cause instanceof Error ? cause.message : 'Could not remove website.'); }
    finally { setRemoving(null); }
  }
  function modalKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !saving && !removing) { setShowAdd(false); setDeleting(null); }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return <section className="sites-page integration-page">
    <div className="integration-heading"><div><span className="integration-eyebrow">YOUR PUBLISHING NETWORK</span><h1>Every story needs a home.</h1><p>Manage your websites, check connections, and choose where your writing lives.</p></div><button className="ig-button ig-button-dark" onClick={openAdd}><Plus size={17} /> Add website</button></div>
    <div className="connection-summary" aria-label="Website summary"><div><Globe2 size={19} /><span><strong>{sites.length}</strong> websites</span></div><div><ShieldCheck size={19} /><span><strong>{wordpress.filter(site => site.credentialsConfigured).length} of {wordpress.length}</strong> WordPress credentials set</span></div><div><Info size={19} /><span><strong>{sites.filter(site => site.platform === 'demo').length}</strong> local demo sites</span></div></div>
    {pageError && !deleting && <div className="ig-error" role="alert">{pageError}</div>}
    <details className="website-discovery">
      <summary><span className="discovery-icon"><Search size={22} /></span><span><strong>Check a website before connecting</strong><small>Look for WordPress using its public address. No sign-in or website changes.</small></span><ChevronDown size={18} /></summary>
      <div className="website-discovery-content"><form className="website-discovery-form" onSubmit={event => void discoverWebsite(event)}>
        <label htmlFor="discovery-url">Website URL</label><div className="website-discovery-input"><input id="discovery-url" type="url" required value={discoveryUrl} onChange={event => { setDiscoveryUrl(event.target.value); setDiscovery(null); setDiscoveryError(''); }} placeholder="https://yourwebsite.com" disabled={discovering} /><button className="ig-button ig-button-dark" disabled={discovering}>{discovering ? <Loader2 size={16} className="ig-spin" /> : <Search size={16} />}{discovering ? 'Checking…' : 'Check website'}</button></div>
      </form>
      {discovering && <p className="website-discovery-progress" role="status">Checking public website metadata. This may take a few seconds.</p>}
      {discoveryError && <div className="website-discovery-result discovery-result-unknown" role="alert"><Info size={20} /><div><strong>Website check unavailable</strong><p>{discoveryError}</p><small>No website was added and no credentials were sent.</small></div></div>}
      {discovery && <div className={`website-discovery-result ${discovery.wordpressDetected && discovery.reachable ? 'discovery-result-found' : 'discovery-result-unknown'}`} role="status">
        {discovery.wordpressDetected && discovery.reachable ? <CheckCircle2 size={20} /> : <Info size={20} />}<div><strong>{discovery.wordpressDetected && discovery.reachable ? 'WordPress detected' : discovery.reachable ? 'Platform not confirmed' : 'Website could not be reached'}</strong><span className="discovery-checked-url">{discovery.url}</span><p>{discovery.message}</p><small>A public check does not verify publishing access. Nothing has been saved yet.</small></div>
        {discovery.wordpressDetected && discovery.reachable ? <button className="ig-button ig-button-dark" onClick={() => prepareDiscoveredWebsite(discovery, 'wordpress')}><Plus size={15} />Add WordPress website</button> : <button className="ig-button" onClick={() => prepareDiscoveredWebsite(discovery, 'manual')}>Add manually <ChevronRight size={14} /></button>}
      </div>}</div>
    </details>
    <div className="sites-toolbar"><div><h2>Your websites <span>{sites.length}</span></h2><p>Publishing access is verified only after a successful connection test.</p></div><div className="sites-toolbar-controls"><label className="ig-search"><Search size={17} /><input aria-label="Search websites" placeholder="Find a website…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear website search" onClick={() => setQuery('')}><X size={14} /></button>}</label><select aria-label="Filter websites by platform" value={platformFilter} onChange={event => setPlatformFilter(event.target.value)}><option value="all">All platforms</option><option value="wordpress">WordPress</option><option value="manual">Manual export</option><option value="demo">Demo websites</option></select></div></div>
    {visible.length ? <div className="sites-grid">
      {visible.map((site, index) => <article className="website-card" key={site.id}>
        <div className="website-card-top"><span className={`website-avatar avatar-${index % 4}`}><Globe2 size={24} /></span><span className={`ig-tag ${site.platform === 'demo' || site.platform === 'manual' ? 'ig-tag-neutral' : site.credentialsConfigured ? 'ig-tag-green' : 'ig-tag-amber'}`}><span className="ig-dot" />{site.platform === 'demo' ? 'Demo' : site.platform === 'manual' ? 'Export only' : site.credentialsConfigured ? 'Credentials set' : 'Setup needed'}</span></div>
        <h3>{site.name}</h3>{site.platform === 'demo' ? <span className="website-url">{site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span> : <a className="website-url" href={site.url} target="_blank" rel="noreferrer">{site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}<ArrowUpRight size={14} /></a>}
        <div className="website-meta"><span><Link2 size={14} />{platformNames[site.platform]}</span><span><Search size={14} />{site.searchConsoleProperty ? 'Search property saved' : 'Search not configured'}</span></div>
        <div className="website-setup">
          {site.platform === 'demo' ? <p>Try your publishing workflow here. Posts stay local and nothing is sent to a website.</p> : site.platform === 'manual' ? <p>Write and export posts from your library, then publish them in your own website editor.</p> : <><p>{site.credentialsConfigured ? 'Credentials are available. Test the connection to verify your publishing access.' : 'Add your WordPress application password in the server settings, then test the connection.'}</p><details className="credential-help"><summary>Connection setup <ChevronDown size={14} /></summary><p>Set these server variables and restart Blog Machine. Use an application password from your WordPress profile.</p><code>{site.credentialKey}_URL={site.url.replace(/\/$/, '')}</code><code>{site.credentialKey}_USERNAME</code><code>{site.credentialKey}_APPLICATION_PASSWORD</code></details></>}
        </div>
        {site.platform === 'wordpress' && <div className="website-connection-test"><button className="ig-button ig-button-small" disabled={testing !== null || removing === site.id} onClick={() => void testConnection(site)}>{testing === site.id ? <Loader2 size={14} className="ig-spin" /> : <ShieldCheck size={14} />}{testing === site.id ? 'Testing connection…' : 'Test connection'}</button><span>Read-only · no posts are published</span>
          {connectionResults[site.id] && <div className={`website-test-result ${connectionResults[site.id].authenticated && connectionResults[site.id].canPublish === true ? 'website-test-success' : 'website-test-warning'}`} role="status"><strong>{connectionResults[site.id].authenticated ? connectionResults[site.id].canPublish === true ? 'Publishing access verified' : connectionResults[site.id].canPublish === false ? 'Signed in · publishing not permitted' : 'Signed in · publishing access unconfirmed' : 'Connection not verified'}</strong><p>{connectionResults[site.id].message}</p><small>Latest test in this session.</small></div>}
        </div>}
        <div className="website-card-bottom">{site.platform === 'demo' ? <span>Local demo workspace</span> : <a href={site.platform === 'wordpress' ? `${site.url.replace(/\/$/, '')}/wp-admin/profile.php` : site.url} target="_blank" rel="noreferrer">{site.platform === 'wordpress' ? 'WordPress settings' : 'Visit website'}<ArrowUpRight size={14} /></a>}<div className="website-card-actions"><button className="ig-icon-button" aria-label={`Edit ${site.name} settings`} title="Edit settings" disabled={testing === site.id || removing === site.id} onClick={() => openEdit(site)}><Settings2 size={17} /></button><button className="ig-icon-button ig-delete" aria-label={`Remove ${site.name}`} disabled={removing === site.id || testing === site.id} onClick={() => { setPageError(''); setDeleting(site); }}><Trash2 size={17} /></button></div></div>
      </article>)}
      {!query && platformFilter === 'all' && <button className="add-website-card" onClick={openAdd}><span><Plus size={27} /></span><strong>Your next destination</strong><p>Give another story a place to live.</p><small>Add website <ChevronRight size={14} /></small></button>}
    </div> : <div className="ig-empty sites-empty"><Globe2 size={32} /><h3>{sites.length ? 'No websites match your search' : 'Make room for your first website'}</h3><p>{sites.length ? 'Try another name, address, or platform.' : 'Connect WordPress, export to your own CMS, or try a local demo.'}</p><button className="ig-button" onClick={sites.length ? () => { setQuery(''); setPlatformFilter('all'); } : openAdd}>{sites.length ? 'Clear filters' : 'Add a website'}</button></div>}
    <div className="integration-footnote"><KeyRound size={18} /><p>Credentials stay on your server. WordPress passwords are never saved in your browser.</p></div>
    {showAdd && <div className="ig-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) setShowAdd(false); }}><section ref={modalRef} className="ig-modal" role="dialog" aria-modal="true" aria-labelledby="add-site-title" onKeyDown={modalKeys}>
      <div className="ig-modal-heading"><div><span className="integration-eyebrow">{editing ? 'YOUR WEBSITE SETTINGS' : 'GROW YOUR NETWORK'}</span><h2 id="add-site-title">{editing ? 'Edit website' : 'Add a website'}</h2><p>{editing ? 'Keep your publishing and search settings up to date.' : 'Choose a destination for your next story.'}</p></div><button className="ig-icon-button" aria-label="Close website settings" onClick={() => setShowAdd(false)} disabled={saving}><X size={20} /></button></div>
      <form onSubmit={event => void addSite(event)}>
        <label>Website name<input data-autofocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="My website" disabled={saving} /></label>
        <label>Website URL<input type="url" required disabled={!!editing || saving} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://yourwebsite.com" /></label>
        <label>Publishing platform<select disabled={!!editing || saving} value={platform} onChange={event => setPlatform(event.target.value as Site['platform'])}><option value="wordpress">WordPress — publish directly</option><option value="demo">Demo — try the workflow locally</option><option value="manual">Other platform — manual export</option></select></label>
        {editing && <p className="ig-form-help">The address and platform are fixed. Add a new website to use a different destination.</p>}
        {platform === 'wordpress' && <><label>Credential prefix <span>Optional</span><input value={credentialKey} disabled={saving} maxLength={60} onChange={event => setCredentialKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} placeholder="MY_WEBSITE" pattern="[A-Z][A-Z0-9_]{0,59}" /></label><p className="ig-form-help">{editing ? 'Changing this prefix selects another set of server credentials.' : 'Leave blank to generate a prefix from the website name.'} Add the matching URL, username, and application password in the server environment. Use your canonical HTTPS address.</p></>}
        <label>Search Console property <span>Optional</span><input value={property} disabled={saving} onChange={event => setProperty(event.target.value)} placeholder="sc-domain:yourwebsite.com" /></label>
        <p className="ig-form-help">Use your exact verified property, such as <code>sc-domain:yourwebsite.com</code> or <code>https://yourwebsite.com/</code>. A Google access token with property access is also required for inspections.</p>
        {error && <div className="ig-error" role="alert">{error}</div>}
        <div className="ig-modal-actions"><button type="button" className="ig-button ig-button-plain" disabled={saving} onClick={() => setShowAdd(false)}>Cancel</button><button className="ig-button ig-button-dark" disabled={saving}>{saving ? <Loader2 className="ig-spin" size={16} /> : editing ? <Check size={16} /> : <Plus size={16} />}{saving ? 'Saving…' : editing ? 'Save settings' : 'Add website'}</button></div>
      </form>
    </section></div>}
    {deleting && <div className="ig-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !removing) setDeleting(null); }}><section ref={modalRef} className="ig-modal ig-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="remove-site-title" aria-describedby="remove-site-description" onKeyDown={modalKeys}><span className="remove-site-icon"><Trash2 size={24} /></span><h2 id="remove-site-title">Remove {deleting.name}?</h2><p id="remove-site-description">This removes the website and its local publishing history. Your posts stay in your library, and content on the live website is kept.</p>{pageError && <div className="ig-error" role="alert">{pageError}</div>}<div className="ig-modal-actions"><button data-autofocus className="ig-button" disabled={!!removing} onClick={() => setDeleting(null)}>Keep website</button><button className="ig-button ig-button-danger" disabled={!!removing} onClick={() => void removeSite(deleting)}>{removing ? <Loader2 size={16} className="ig-spin" /> : <Trash2 size={16} />}{removing ? 'Removing…' : 'Remove website'}</button></div></section></div>}
  </section>;
}
