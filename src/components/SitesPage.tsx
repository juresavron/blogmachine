import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, CheckCircle2, ChevronRight, Globe2, Info, KeyRound, Link2, Loader2, Plus, Search, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
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
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<Site['platform']>('wordpress');
  const [property, setProperty] = useState('');
  const [credentialKey, setCredentialKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');
  const [discoveryUrl, setDiscoveryUrl] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discoveryError, setDiscoveryError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [connectionResults, setConnectionResults] = useState<Record<string, ConnectionResult>>({});

  function openAdd() { setEditing(null); setError(''); setName(''); setUrl(''); setPlatform('wordpress'); setProperty(''); setCredentialKey(''); setShowAdd(true); }
  function openEdit(site: Site) { setEditing(site); setError(''); setName(site.name); setUrl(site.url); setPlatform(site.platform); setProperty(site.searchConsoleProperty); setCredentialKey(site.credentialKey); setShowAdd(true); }
  function prepareDiscoveredWebsite(result: DiscoveryResult) {
    openAdd();
    const hostname = new URL(result.url).hostname.replace(/^www\./, '');
    const shortName = hostname.split('.')[0] || hostname;
    setName(shortName.charAt(0).toUpperCase() + shortName.slice(1));
    setUrl(result.url);
    setPlatform('wordpress');
    setCredentialKey(shortName.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^[^A-Z]+/, '') || 'WEBSITE');
  }
  function prepareManualWebsite(result: DiscoveryResult) {
    openAdd();
    const hostname = new URL(result.url).hostname.replace(/^www\./, '');
    const shortName = hostname.split('.')[0] || hostname;
    setName(shortName.charAt(0).toUpperCase() + shortName.slice(1));
    setUrl(result.url);
    setPlatform('manual');
  }
  async function discoverWebsite(event: FormEvent) {
    event.preventDefault();
    setDiscovering(true); setDiscovery(null); setDiscoveryError('');
    try { setDiscovery(await api<DiscoveryResult>('/connections/discover', { method: 'POST', body: JSON.stringify({ url: discoveryUrl.trim() }) })); }
    catch (cause) { setDiscoveryError(cause instanceof Error ? cause.message : 'Could not check this website. No connection has been saved.'); }
    finally { setDiscovering(false); }
  }
  function selectDiscoveryUrl(websiteUrl: string) {
    setDiscoveryUrl(websiteUrl); setDiscovery(null); setDiscoveryError('');
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
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const settings = { name: name.trim(), searchConsoleProperty: property.trim(), ...(credentialKey.trim() ? { credentialKey: credentialKey.trim() } : {}) };
      await api(editing ? `/sites/${editing.id}` : '/sites', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(editing ? settings : { ...settings, url: url.trim(), platform }) });
      await onRefresh(); setShowAdd(false);
      if (editing) setConnectionResults(previous => { const next = { ...previous }; delete next[editing.id]; return next; });
      onNotify(editing ? 'Website settings saved.' : platform === 'demo' ? 'Demo website added.' : 'Website added. Complete its connection setup to publish.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save website.'); }
    finally { setSaving(false); }
  }
  async function removeSite(site: Site) {
    if (!window.confirm(`Remove ${site.name}? Its publishing history will be removed. Your drafts and website content will stay intact.`)) return;
    setRemoving(site.id); setPageError('');
    try { await api(`/sites/${site.id}`, { method: 'DELETE' }); await onRefresh(); onNotify(`${site.name} removed.`); }
    catch (cause) { setPageError(cause instanceof Error ? cause.message : 'Could not remove website.'); }
    finally { setRemoving(null); }
  }

  return <section className="sites-page integration-page">
    <div className="integration-heading"><div><span className="integration-eyebrow">YOUR PUBLISHING NETWORK</span><h1>One home. Every website.</h1><p>Connect your corners of the internet and keep them growing.</p></div><button className="ig-button ig-button-dark" onClick={openAdd}><Plus size={17} /> Add website</button></div>
    {pageError && <div className="ig-error" role="alert">{pageError}</div>}
    <div className="website-discovery">
      <div className="website-discovery-intro"><span className="discovery-icon"><Globe2 size={24} /></span><div><h2>Connect your websites</h2><p>Start with a public website check. We’ll look for WordPress without signing in or changing your website.</p></div></div>
      <form className="website-discovery-form" onSubmit={event => void discoverWebsite(event)}>
        <label htmlFor="discovery-url">Website URL</label>
        <div className="website-discovery-input"><input id="discovery-url" type="url" required value={discoveryUrl} onChange={event => { setDiscoveryUrl(event.target.value); setDiscovery(null); setDiscoveryError(''); }} placeholder="https://yourwebsite.com" disabled={discovering} /><button className="ig-button ig-button-dark" disabled={discovering}>{discovering ? <Loader2 size={16} className="ig-spin" /> : <Search size={16} />}{discovering ? 'Checking website…' : 'Check website'}</button></div>
      </form>
      <div className="website-discovery-shortcuts"><span>Your websites:</span><button type="button" disabled={discovering} onClick={() => selectDiscoveryUrl('https://mediasped.com')}>mediasped.com <ArrowUpRight size={12} /></button><button type="button" disabled={discovering} onClick={() => selectDiscoveryUrl('https://ocenagor.si')}>ocenagor.si <ArrowUpRight size={12} /></button><small>Choose a URL, then check it. Nothing is saved yet.</small></div>
      {discovering && <p className="website-discovery-progress" role="status">Checking public website metadata. This may take a few seconds.</p>}
      {discoveryError && <div className="website-discovery-result discovery-result-unknown" role="alert"><Info size={20} /><div><strong>Website check unavailable</strong><p>{discoveryError}</p><small>No website was added and no credentials were sent.</small></div></div>}
      {discovery && <div className={`website-discovery-result ${discovery.wordpressDetected && discovery.reachable ? 'discovery-result-found' : 'discovery-result-unknown'}`} role="status">
        {discovery.wordpressDetected && discovery.reachable ? <CheckCircle2 size={20} /> : <Info size={20} />}
        <div><strong>{discovery.wordpressDetected && discovery.reachable ? 'WordPress detected' : discovery.reachable ? 'Website reached · platform not confirmed' : 'Website could not be reached'}</strong><span className="discovery-checked-url">{discovery.url}</span><p>{discovery.message}</p><small>{discovery.wordpressDetected ? 'A public check does not verify publishing access. Add the website and configure credentials next.' : 'This check does not confirm the website’s platform. You can add it manually once you know its publishing platform. Custom-built site? Its repository can help us add a publishing connector.'}</small></div>
        {discovery.wordpressDetected && discovery.reachable ? <button className="ig-button ig-button-dark" onClick={() => prepareDiscoveredWebsite(discovery)}><Plus size={15} />Add WordPress website</button> : <button className="ig-button" onClick={() => prepareManualWebsite(discovery)}>Choose platform manually <ChevronRight size={14} /></button>}
      </div>}
    </div>
    <div className="sites-grid">
      {sites.map((site, index) => <article className="website-card" key={site.id}>
        <div className="website-card-top"><span className={`website-avatar avatar-${index % 4}`}><Globe2 size={24} /></span><span className={`ig-tag ${site.platform === 'demo' ? 'ig-tag-neutral' : site.credentialsConfigured ? 'ig-tag-green' : 'ig-tag-amber'}`}><span className="ig-dot" />{site.platform === 'demo' ? 'Demo' : site.platform === 'manual' ? 'Export only' : site.credentialsConfigured ? 'Credentials set' : 'Setup needed'}</span></div>
        <h3>{site.name}</h3>{site.platform === 'demo' ? <span className="website-url">{site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span> : <a className="website-url" href={site.url} target="_blank" rel="noreferrer">{site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}<ArrowUpRight size={14} /></a>}
        <div className="website-meta"><span><Link2 size={14} />{platformNames[site.platform]}</span><span><Check size={14} />{site.searchConsoleProperty ? 'Search property saved' : 'No search property'}</span></div>
        <div className="website-setup">
          {site.platform === 'demo' ? <p>A safe place to try publishing. Nothing is sent to a real website.</p> : site.platform === 'manual' ? <p>Create your post here, then copy or export it to your website.</p> : <><div><KeyRound size={15} /><strong>{site.credentialsConfigured ? 'Publishing credentials available' : 'Set credentials on the server'}</strong></div><p>Set the exact website URL, your WordPress username, and an application password:</p><code>{site.credentialKey}_URL={site.url.replace(/\/$/, '')}</code><code>{site.credentialKey}_USERNAME</code><code>{site.credentialKey}_APPLICATION_PASSWORD</code></>}
        </div>
        {site.platform === 'wordpress' && <div className="website-connection-test"><button className="ig-button ig-button-small" disabled={testing !== null || removing === site.id} onClick={() => void testConnection(site)}>{testing === site.id ? <Loader2 size={14} className="ig-spin" /> : <ShieldCheck size={14} />}{testing === site.id ? 'Testing connection…' : 'Test connection'}</button><span>Read-only · no posts are published</span>
          {connectionResults[site.id] && <div className={`website-test-result ${connectionResults[site.id].authenticated && connectionResults[site.id].canPublish === true ? 'website-test-success' : 'website-test-warning'}`} role="status"><strong>{connectionResults[site.id].authenticated ? connectionResults[site.id].canPublish === true ? 'Publishing access verified' : connectionResults[site.id].canPublish === false ? 'Signed in · publishing not permitted' : 'Signed in · publishing access unconfirmed' : 'Connection not verified'}</strong><p>{connectionResults[site.id].message}</p><small>Result of your latest test in this session.</small></div>}
        </div>}
        <div className="website-card-bottom">{site.platform === 'demo' ? <span>Local demo workspace</span> : <a href={site.platform === 'wordpress' ? `${site.url.replace(/\/$/, '')}/wp-admin/profile.php` : site.url} target="_blank" rel="noreferrer">{site.platform === 'wordpress' ? 'WordPress settings' : 'Visit website'}<ArrowUpRight size={14} /></a>}<div className="website-card-actions"><button className="ig-icon-button" aria-label={`Edit ${site.name} settings`} title="Edit settings" disabled={testing === site.id || removing === site.id} onClick={() => openEdit(site)}><Settings2 size={16} /></button><button className="ig-icon-button ig-delete" aria-label={`Remove ${site.name}`} disabled={removing === site.id || testing === site.id} onClick={() => void removeSite(site)}>{removing === site.id ? <Loader2 size={16} className="ig-spin" /> : <Trash2 size={16} />}</button></div></div>
      </article>)}
      <button className="add-website-card" onClick={openAdd}><span><Plus size={27} /></span><strong>Make room for your next idea</strong><p>Add another website to your network.</p><small>Add website <ChevronRight size={14} /></small></button>
    </div>
    <div className="integration-footnote"><KeyRound size={18} /><p>Credentials stay on your server. Blog Machine never saves WordPress passwords in your browser.</p></div>
    {showAdd && <div className="ig-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) setShowAdd(false); }}><section className="ig-modal" role="dialog" aria-modal="true" aria-labelledby="add-site-title" onKeyDown={event => { if (event.key === 'Escape' && !saving) setShowAdd(false); if (event.key === 'Tab') { const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')); const first = controls[0]; const last = controls[controls.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}>
      <div className="ig-modal-heading"><div><span className="integration-eyebrow">{editing ? 'YOUR WEBSITE SETTINGS' : 'GROW YOUR NETWORK'}</span><h2 id="add-site-title">{editing ? 'Edit website' : 'Add a website'}</h2></div><button className="ig-icon-button" aria-label="Close website settings" onClick={() => setShowAdd(false)} disabled={saving}><X size={20} /></button></div>
      <form onSubmit={event => void addSite(event)}>
        <label>Website name<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="My lovely website" /></label>
        <label>Website URL<input type="url" required disabled={!!editing} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://yourwebsite.com" /></label>
        <label>Publishing platform<select disabled={!!editing} value={platform} onChange={event => setPlatform(event.target.value as Site['platform'])}><option value="wordpress">WordPress — publish directly</option><option value="demo">Demo — try the workflow locally</option><option value="manual">Other platform — manual export</option></select></label>
        {platform === 'wordpress' && <><label>Credential prefix <span>Optional</span><input value={credentialKey} onChange={event => setCredentialKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} placeholder="MY_WEBSITE" pattern="[A-Z][A-Z0-9_]*" /></label><p className="ig-form-help">{editing ? 'Changing the prefix selects a different set of server credentials.' : 'We generate a prefix from the website name if you leave this blank.'} Set its _URL to the exact saved website URL without a trailing slash, plus _USERNAME and _APPLICATION_PASSWORD, as server environment variables. This binds credentials to your website. Use HTTPS for WordPress.</p></>}
        <label>Search Console property <span>Optional</span><input value={property} onChange={event => setProperty(event.target.value)} placeholder="https://yourwebsite.com/ or sc-domain:yourwebsite.com" /></label>
        <p className="ig-form-help">Use the exact property verified in Google Search Console. Inspection and sitemap submission require a server Google access token with permission for this property.</p>
        {error && <div className="ig-error" role="alert">{error}</div>}
        <div className="ig-modal-actions"><button type="button" className="ig-button ig-button-plain" disabled={saving} onClick={() => setShowAdd(false)}>Cancel</button><button className="ig-button ig-button-dark" disabled={saving}>{saving ? <Loader2 className="ig-spin" size={16} /> : editing ? <Check size={16} /> : <Plus size={16} />}{saving ? 'Saving…' : editing ? 'Save settings' : 'Add website'}</button></div>
      </form>
    </section></div>}
  </section>;
}
