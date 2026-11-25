import { useState } from 'react';
import { ArrowRight, Check, Download, FolderGit2, Globe2, Radio, Send, Settings2, ShieldCheck } from 'lucide-react';
import type { AppState } from '../types';

interface Props {
  data: AppState;
  name: string;
  onSaveName: (name: string) => void;
  onNavigate: (page: 'websites' | 'indexing' | 'repositories') => void;
  onNotify: (message: string) => void;
}

export function WorkspaceSettings({ data, name, onSaveName, onNavigate, onNotify }: Props) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState('');
  function exportData() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), posts: data.posts, sites: data.sites, publications: data.publications }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `blogmachine-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotify('Workspace data exported. Keep this file somewhere safe.');
  }
  return <div className="settings-page">
    <div className="page-heading"><div><div className="eyebrow">MAKE IT YOURS</div><h1>Workspace settings<span className="title-dot">.</span></h1><p>A little organization behind every good story.</p></div></div>
    <div className="settings-layout">
      <div className="settings-main">
        <section className="settings-card">
          <div className="settings-section-title"><span className="settings-icon"><Settings2 size={20} /></span><div><h2>Workspace details</h2><p>Your own corner of Blog Machine.</p></div></div>
          <form className="workspace-name-form" onSubmit={event => {
            event.preventDefault();
            try { onSaveName(draft.trim()); setError(''); onNotify('Workspace name saved in this browser.'); }
            catch { setError('This browser could not save your preference. Check that browser storage is available.'); }
          }}>
            <label htmlFor="workspace-name">Workspace name</label>
            <div className="workspace-name-control"><input id="workspace-name" value={draft} onChange={e => setDraft(e.target.value)} maxLength={60} required placeholder="My workspace" /><button className="button primary" disabled={!draft.trim() || draft.trim() === name}><Check size={16} />Save name</button></div>
            <p className="field-hint">Saved in this browser. Your posts and website connections are unchanged.</p>
            {error && <p className="settings-error" role="alert">{error}</p>}
          </form>
        </section>
        <section className="settings-card">
          <div className="settings-section-title"><span className="settings-icon"><Download size={20} /></span><div><h2>Your data, with you</h2><p>Take a copy of the work in this workspace.</p></div></div>
          <div className="settings-facts"><span><strong>{data.posts.length}</strong> posts</span><span><strong>{data.sites.length}</strong> websites</span><span><strong>{data.publications.length}</strong> publications</span></div>
          <p>Download your posts, website settings, and publication records as JSON. Account sessions and prepared repository artifacts are not included. This export does not replace a full database backup.</p>
          <button className="button secondary" onClick={exportData}><Download size={16} />Export workspace data</button>
        </section>
        <section className="settings-card">
          <div className="settings-section-title"><span className="settings-icon"><Send size={20} /></span><div><h2>Publishing connections</h2><p>Configure a destination, then verify its access.</p></div></div>
          <div className="connection-setting"><Globe2 size={20} /><div><h3>WordPress</h3><p>{data.sites.filter(s => s.platform === 'wordpress').length} websites · {data.sites.filter(s => s.platform === 'wordpress' && s.credentialsConfigured).length} with credentials present</p></div><button className="text-button" onClick={() => onNavigate('websites')}>Manage <ArrowRight size={15} /></button></div>
          <div className="connection-setting"><Radio size={20} /><div><h3>Google Search Console</h3><p>{data.capabilities?.googleConfigured ? 'Token present · property access still needs verification' : 'Not configured · a Google token is needed'}</p></div><button className="text-button" onClick={() => onNavigate('indexing')}>Set up <ArrowRight size={15} /></button></div>
          <div className="connection-setting"><FolderGit2 size={20} /><div><h3>Repository connections</h3><p>Prepare content changes for a separate review and deployment.</p></div><button className="text-button" onClick={() => onNavigate('repositories')}>Manage <ArrowRight size={15} /></button></div>
          <details className="settings-advanced"><summary>Server configuration reference</summary><p>For a WordPress website, set its matching <code>PREFIX_URL</code>, <code>PREFIX_USERNAME</code>, and <code>PREFIX_APPLICATION_PASSWORD</code> on the server. Use the exact saved HTTPS website URL and a WordPress application password.</p><p>Search Console uses <code>GOOGLE_ACCESS_TOKEN</code> with property access and the <code>webmasters</code> scope. Tokens expire and must be refreshed externally. Restart the server after changing its environment.</p></details>
        </section>
      </div>
      <aside className="settings-aside">
        <div className="privacy-card"><ShieldCheck size={27} /><div className="eyebrow">A LOCAL WORKSPACE</div><h2>Yours to keep.<br /> Yours to publish.</h2><p>Posts and website settings stay on this machine. Credentials stay on the server.</p><p>Live content changes happen only through explicit publishing or remote draft actions. Demo publishing stays local.</p><span><span className="online-dot" />No background publishing</span></div>
        <div className="settings-note"><h3>Good to know</h3><p>Deleting a local post does not remove an article already published on a live website. Administrator connections need to reconnect after a server restart.</p></div>
      </aside>
    </div>
  </div>;
}
