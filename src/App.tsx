import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, FileText, Globe2, FolderGit2, LayoutDashboard, LoaderCircle, Menu, Plus, Radio, Search, Settings2, Sparkles, Sprout, X, Send, RefreshCw } from 'lucide-react';
import type { AppState, Post, PostInput, Site } from './types';
import { api } from './api';
import { PostEditor } from './components/PostEditor';
import { PostsPage } from './components/PostsPage';
import { SitesPage } from './components/SitesPage';
import { IndexingPage } from './components/IndexingPage';
import { RepositoriesPage } from './components/RepositoriesPage';

type Page = 'overview' | 'posts' | 'websites' | 'repositories' | 'indexing' | 'settings';
const nav = [
  { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
  { id: 'posts' as const, label: 'Posts', icon: FileText },
  { id: 'websites' as const, label: 'Websites', icon: Globe2 },
  { id: 'repositories' as const, label: 'Repositories', icon: FolderGit2 },
  { id: 'indexing' as const, label: 'Search & indexing', icon: Radio },
];
const empty: AppState = { sites: [], posts: [], publications: [] };
const formatDate = (value: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'Europe/Ljubljana' }).format(new Date(value));
function SiteMark({ site, index = 0 }: { site: Site; index?: number }) {
  return <span className={`site-mark mark-${index % 4}`} aria-hidden="true">{index % 3 === 0 ? <Sprout size={21} /> : index % 3 === 1 ? <span className="mark-letter">s.</span> : <span className="mark-sun">✳</span>}</span>;
}
function WebsiteArt({ index }: { index: number }) {
  return <div className={`website-art art-${index % 3}`} aria-hidden="true">{index % 3 === 0 ? <><div className="art-circle" /><div className="art-stem" /><span className="art-caption">a slower kind of Sunday.</span></> : index % 3 === 1 ? <><div className="art-outline" /><div className="art-block" /><span className="art-caption">IDEAS TAKE SHAPE.</span></> : <><div className="art-mountain mountain-one" /><div className="art-mountain mountain-two" /><div className="art-sun" /><span className="art-caption">GO FIND YOUR NEXT STORY.</span></>}</div>;
}

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const p = window.location.hash.slice(1);
    return ['overview', 'posts', 'websites', 'repositories', 'indexing', 'settings'].includes(p) ? p as Page : 'overview';
  });
  const [data, setData] = useState<AppState>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Post | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 6500);
  }, []);
  const refresh = useCallback(async () => {
    const next = await api<AppState>('/state');
    setData(next);
    setError('');
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    window.location.hash = page;
    setMobileOpen(false);
  }, [page]);
  useEffect(() => {
    const hash = () => { const p = window.location.hash.slice(1); if (['overview', 'posts', 'websites', 'repositories', 'indexing', 'settings'].includes(p)) setPage(p as Page); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSearchOpen(false); setGuideOpen(false); setMobileOpen(false); }
      if ((e.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"]') || document.querySelector('[aria-modal="true"]')) return;
      if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault(); setSearchOpen(true);
      }
    };
    window.addEventListener('hashchange', hash); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('hashchange', hash); window.removeEventListener('keydown', key); if (noticeTimer.current) clearTimeout(noticeTimer.current); };
  }, []);

  useEffect(() => {
    if (!searchOpen && !guideOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = document.querySelector<HTMLElement>(searchOpen ? '.search-dialog' : '.guide-dialog');
    dialog?.querySelector<HTMLElement>('input, button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog?.addEventListener('keydown', trap);
    return () => { dialog?.removeEventListener('keydown', trap); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [searchOpen, guideOpen]);

  useEffect(() => { if (filter !== 'all' && !data.sites.some(s => s.id === filter)) setFilter('all'); }, [data.sites, filter]);

  const savePost = async (input: PostInput, publish: boolean) => {
    const post = await api<Post>(editing?.id ? `/posts/${editing.id}` : '/posts', { method: editing?.id ? 'PATCH' : 'POST', body: JSON.stringify(input) });
    setEditing(post);
    if (publish) {
      try {
        const result = await api<{ publications: AppState['publications'] }>(`/posts/${post.id}/publish`, { method: 'POST', body: JSON.stringify({ siteIds: input.siteIds }) });
        const succeeded = result.publications.filter(p => p.status === 'published');
        const failed = result.publications.filter(p => p.status === 'failed');
        const demo = succeeded.filter(p => p.mode === 'demo').length;
        notify(failed.length ? `${succeeded.length} published, ${failed.length} failed. See publishing issues on this page.` : `Published to ${succeeded.length} website${succeeded.length !== 1 ? 's' : ''}${demo ? ` (${demo} demo)` : ''}.`);
      } catch (e) { await refresh(); setEditing(post); throw e; }
    } else notify(editing?.status === 'published' ? 'Changes saved locally. Publish again to update your websites.' : 'Draft saved. Good ideas take their time.');
    await refresh(); setEditing(undefined);
  };
  const deletePost = async (post: Post) => { await api(`/posts/${post.id}`, { method: 'DELETE' }); await refresh(); notify('Post removed from your library. Published articles on live websites are kept.'); };
  const sites = filter === 'all' ? data.sites : data.sites.filter(s => s.id === filter);
  const posts = filter === 'all' ? data.posts : data.posts.filter(p => p.siteIds.includes(filter));
  const publications = data.publications.filter(p => filter === 'all' || p.siteId === filter);
  const published = publications.filter(p => p.status === 'published');
  const indexed = published.filter(p => p.indexingStatus === 'indexed');
  const drafts = posts.filter(p => p.status === 'draft');
  const recent = [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const searchPosts = data.posts.filter(p => `${p.title} ${p.excerpt}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  const searchSites = data.sites.filter(s => `${s.name} ${s.url}`.toLowerCase().includes(query.toLowerCase())).slice(0, 3);
  const pageTitle = page === 'indexing' ? 'Search & indexing' : page[0].toUpperCase() + page.slice(1);

  return <div className="app-shell">
    {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <a className="brand" href="#overview" onClick={() => setPage('overview')} aria-label="Blog Machine home"><span className="brand-mark"><span /><span /><span /></span><span>blog<span className="brand-second">machine</span><span className="brand-dot">®</span></span></a>
      <button className="workspace-switch" onClick={() => setPage('settings')}><span className="workspace-avatar">J</span><span><strong>My workspace</strong><small>Personal workspace</small></span><Settings2 size={15} /></button>
      <div className="nav-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">{nav.map(item => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={19} strokeWidth={1.65} /><span>{item.label}</span>{item.id === 'posts' && <span className="nav-count">{data.posts.length}</span>}{page === item.id && <span className="active-dot" />}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-note"><div className="note-illustration"><Sprout size={36} strokeWidth={1.25} /><span>✦</span><span>✧</span></div><strong>Good stories deserve<br />to be found.</strong><p>A little help to grow your<br />corner of the internet.</p><button onClick={() => setGuideOpen(true)}>Your publishing guide <ArrowUpRight size={14} /></button></div>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><Settings2 size={19} strokeWidth={1.6} />Settings</button><button className="nav-item" onClick={() => setGuideOpen(true)}><CircleHelp size={19} strokeWidth={1.6} />Help & getting started <ArrowUpRight size={14} /></button></div>
      <div className="sidebar-footer"><span className="online-dot" /> Local workspace <span>v0.1</span></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{pageTitle}</strong></div><div className="topbar-actions"><button className="search-trigger" aria-label="Search workspace" onClick={() => setSearchOpen(true)}><Search size={16} /><span>Search anything...</span><kbd>⌘ K</kbd></button><span className="topbar-separator" /><span className="demo-pill"><span />{data.sites.some(s => s.platform === 'demo') ? 'Demo workspace' : 'Your workspace'}</span><button className="user-avatar" onClick={() => setPage('settings')} aria-label="Workspace settings">J</button></div></header>
      <main id="main-content" className="main-content">
        {loading ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><h2>Opening your workspace…</h2><p>Making room for your next good idea.</p></div> : error ? <div className="error-state"><Radio size={32} /><h2>We couldn’t load your workspace</h2><p>{error}</p><button className="button primary" onClick={() => { setLoading(true); refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }}><RefreshCw size={16} />Try again</button></div> : <>
          {page === 'overview' && <>
            <div className="page-heading"><div><div className="eyebrow">YOUR CORNER OF THE INTERNET</div><h1>Your publishing home<span className="title-dot">.</span></h1><p>Big ideas. More websites. One place to bring it all together.</p></div><button className="button primary" onClick={() => setEditing(null)}><Plus size={17} />Create a post</button></div>
            <div className="overview-toolbar"><span><span className="online-dot" />Let’s make something worth reading.</span><label className="select-wrap"><Globe2 size={14} /><select aria-label="Filter overview by website" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All websites</option>{data.sites.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select><ChevronDown size={13} /></label></div>
            <section className="stats-grid" aria-label="Publishing statistics"><Metric icon={FileText} label="Published articles" value={published.length} detail={`${published.filter(p => p.mode === 'demo').length} demo · ${published.filter(p => p.mode === 'live').length} live`} /><Metric icon={BookOpen} label="Drafts in the works" value={drafts.length} detail="Your next good ideas" /><Metric icon={Globe2} label="Your websites" value={sites.length} detail={`${sites.filter(s => s.platform === 'demo').length} demo sites in this view`} /><Metric icon={Radio} label="Indexed by Google" value={indexed.length} detail={indexed.length ? 'Confirmed by URL inspection' : 'No live URLs inspected yet'} /></section>
            <section className="websites-section"><div className="section-heading"><div><h2>Your websites <span className="count-bubble">{sites.length}</span></h2><p>Different destinations. Same creative energy.</p></div><button className="text-button" onClick={() => setPage('websites')}>Manage websites <ArrowRight size={15} /></button></div>
              {sites.length ? <div className="website-grid">{sites.slice(0, 3).map((site, index) => { const count = data.publications.filter(p => p.siteId === site.id && p.status === 'published').length; return <button key={site.id} className="overview-website-card" onClick={() => setPage('websites')}><WebsiteArt index={index} /><div className="overview-website-card-body"><div className="overview-website-card-title"><SiteMark site={site} index={index} /><span><strong>{site.name}</strong><small>{new URL(site.url).hostname}</small></span><ArrowUpRight size={17} /></div><div className="overview-website-card-footer"><span className={`platform-label ${site.platform === 'demo' ? 'demo' : ''}`}><span />{site.platform === 'demo' ? 'Demo website' : site.platform === 'wordpress' ? (site.credentialsConfigured ? 'WordPress configured' : 'Needs credentials') : 'Manual publishing'}</span><span>{count} article{count !== 1 ? 's' : ''}</span></div></div></button>; })}</div> : <div className="empty-inline"><Globe2 /><p>Your next story needs a home.</p><button className="text-button" onClick={() => setPage('websites')}>Add your first website <ArrowRight size={15} /></button></div>}
            </section>
            <div className="lower-grid"><section className="recent-section panel"><div className="section-heading"><div><h2>On your desk</h2><p>A fresh look at what you’ve been working on.</p></div><button className="text-button" onClick={() => setPage('posts')}>All posts <ArrowRight size={15} /></button></div><div className="recent-table"><div className="table-head"><span>POST</span><span>STATUS</span><span>UPDATED</span><span /></div>{recent.length ? recent.map(post => <button className="post-row" key={post.id} onClick={() => setEditing(post)}><span className="post-row-title"><span className={`post-icon ${post.status}`}><FileText size={18} strokeWidth={1.5} /></span><span><strong>{post.title}</strong><small>{post.siteIds.length ? post.siteIds.map(id => data.sites.find(s => s.id === id)?.name).filter(Boolean).join(' · ') : 'No website selected'}</small></span></span><span className={`status-badge ${post.status}`}><span />{post.status === 'published' ? 'Published' : 'Draft'}</span><span className="date-text">{formatDate(post.updatedAt)}</span><ChevronRight size={16} /></button>) : <div className="empty-inline"><p>A blank page is a good place to begin.</p><button className="text-button" onClick={() => setEditing(null)}>Write your first post <ArrowRight size={15} /></button></div>}</div></section>
              <section className="growth-card"><div className="growth-top"><span className="eyebrow">A LITTLE MOMENTUM</span><Sparkles size={17} /></div><div className="growth-art" aria-hidden="true"><div className="growth-path" /><div className="growth-leaf leaf-one" /><div className="growth-leaf leaf-two" /><div className="growth-leaf leaf-three" /><span className="growth-star">✳</span></div><h2>Write it.<br />Share it. Grow it.</h2><p>Connect your websites, publish your story, and help search engines discover it.</p><button onClick={() => setGuideOpen(true)}>Let’s get you started <ArrowUpRight size={16} /></button></section>
            </div>
            <footer className="content-footer"><span>Made for your ideas, wherever they live.</span><span><span className="online-dot" /> All changes saved locally</span></footer>
          </>}
          {page === 'posts' && <PostsPage posts={data.posts} sites={data.sites} onEdit={setEditing} onCreate={() => setEditing(null)} onDelete={deletePost} />}
          {page === 'websites' && <SitesPage sites={data.sites} onRefresh={refresh} onNotify={notify} />}
          {page === 'indexing' && <IndexingPage sites={data.sites} posts={data.posts} publications={data.publications} googleConfigured={data.capabilities?.googleConfigured ?? false} onRefresh={refresh} onNotify={notify} />}
          {page === 'repositories' && <RepositoriesPage posts={data.posts} onNotify={notify} />}
          {page === 'settings' && <div className="settings-page"><div className="page-heading"><div><div className="eyebrow">THE DETAILS BEHIND THE IDEAS</div><h1>Workspace settings<span className="title-dot">.</span></h1><p>Your data, connections, and a little peace of mind.</p></div></div><section className="settings-card"><div className="settings-icon"><Globe2 /></div><div><h2>Your workspace</h2><p>Blog Machine runs locally with a persistent SQLite database. Posts and website settings stay on this machine. Live publishing happens only when you explicitly publish to a configured WordPress site.</p><div className="settings-facts"><span><strong>{data.sites.length}</strong> websites</span><span><strong>{data.posts.length}</strong> posts</span><span><strong>{data.publications.filter(p => p.mode === 'live' && p.status === 'published').length}</strong> live articles</span></div></div></section><section className="settings-card"><div className="settings-icon"><Send /></div><div><h2>WordPress publishing</h2><p>Add a WordPress website, choose a credential prefix, then set <code>PREFIX_URL</code> to the exact website address, plus <code>PREFIX_USERNAME</code> and <code>PREFIX_APPLICATION_PASSWORD</code> on the server. Use a WordPress application password. Restart the server after changing its environment.</p><p className="muted">Credentials stay on the server and are never sent to your browser.</p><button className="button secondary" onClick={() => setPage('websites')}>Manage websites <ArrowRight size={15} /></button></div></section><section className="settings-card"><div className="settings-icon"><Radio /></div><div><h2>Google Search Console <span className={`status-badge ${data.capabilities?.googleConfigured ? 'published' : 'draft'}`}>{data.capabilities?.googleConfigured ? 'Token present' : 'Not configured'}</span></h2><p>Set <code>GOOGLE_ACCESS_TOKEN</code> on the server with Search Console access to your properties. Use the <code>webmasters</code> OAuth scope for sitemap submission. Tokens expire and must be refreshed externally. Add your exact property to each website (for example, <code>sc-domain:example.com</code>).</p><p className="muted">URL inspection reports Google’s current index status; sitemap submission does not guarantee indexing.</p><button className="button secondary" onClick={() => setPage('indexing')}>Search & indexing <ArrowRight size={15} /></button></div></section><section className="settings-card"><div className="settings-icon"><BookOpen /></div><div><h2>About this first version</h2><p>WordPress publishing, manual text exports, sitemap submission, and URL inspection are supported. Repository connections can prepare source patches and database draft payloads for review. Applying, merging, and deploying those changes remain separate steps. Background scheduling and AI writing are future additions. Demo publications never send content to a real website.</p></div></section></div>}
          {data.publications.some(p => p.status === 'failed' || p.error) && <section className="failure-panel" role="status"><strong>Some publications need your attention</strong>{data.publications.filter(p => p.status === 'failed' || p.error).map(p => <p key={p.id}><button className="text-button" onClick={() => { const post = data.posts.find(post => post.id === p.postId); if (post) setEditing(post); }}>{data.posts.find(post => post.id === p.postId)?.title}</button> · {data.sites.find(s => s.id === p.siteId)?.name}: {p.error}</p>)}</section>}
        </>}
      </main>
    </div>
    {editing !== undefined && <PostEditor post={editing} sites={data.sites} onClose={() => setEditing(undefined)} onSave={savePost} />}
    {notice && <div className="toast" role="status"><span className="toast-icon"><Check size={16} /></span><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={16} /></button></div>}
    {searchOpen && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setSearchOpen(false); }}><section className="search-dialog" role="dialog" aria-modal="true" aria-label="Search workspace"><div className="search-input-row"><Search size={21} /><input autoFocus placeholder="Find a post or website…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search posts and websites" /><button className="icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={19} /></button></div><div className="search-results"><div className="eyebrow">POSTS</div>{searchPosts.map(p => <button key={p.id} onClick={() => { setSearchOpen(false); setEditing(p); }}><FileText size={17} /><span>{p.title}</span><ArrowUpRight size={15} /></button>)}{!searchPosts.length && <p>No matching posts.</p>}<div className="eyebrow">WEBSITES</div>{searchSites.map(s => <button key={s.id} onClick={() => { setSearchOpen(false); setPage('websites'); }}><Globe2 size={17} /><span>{s.name}</span><ArrowUpRight size={15} /></button>)}{!searchSites.length && <p>No matching websites.</p>}</div><div className="search-footer">A little less searching. A little more creating. <kbd>esc</kbd></div></section></div>}
    {guideOpen && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setGuideOpen(false); }}><section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title"><button className="icon-button close-guide" onClick={() => setGuideOpen(false)} aria-label="Close guide"><X size={20} /></button><span className="guide-emblem"><Sprout size={32} /></span><div className="eyebrow">FROM IDEA TO OUT THERE</div><h2 id="guide-title">Make yourself at home.</h2><p>Three small steps to a more connected publishing routine.</p>{[{n:'01',title:'Give your stories a home',text:'Try a demo site, or connect a live WordPress website with a server-side application password.',action:'Manage websites',page:'websites'},{n:'02',title:'Put a good idea into words',text:'Write your post, pick its destinations, and save a draft or publish when it’s ready.',action:'Create a post',page:'new'},{n:'03',title:'Help your stories get discovered',text:'Submit a sitemap and inspect live URLs with Search Console. Google decides what gets indexed.',action:'Search & indexing',page:'indexing'}].map(step => <div className="guide-step" key={step.n}><span>{step.n}</span><div><h3>{step.title}</h3><p>{step.text}</p><button className="text-button" onClick={() => { setGuideOpen(false); if(step.page === 'new') setEditing(null); else setPage(step.page as Page); }}>{step.action}<ArrowRight size={14} /></button></div></div>)}</section></div>}
  </div>;
}
function Metric({ icon: Icon, label, value, detail }: { icon: typeof FileText; label: string; value: number; detail: string }) {
  return <div className="metric-card"><div className="metric-label"><span>{label}</span><Icon size={17} strokeWidth={1.5} /></div><strong className="metric-value">{String(value).padStart(2, '0')}</strong><div className="metric-detail">{detail}</div></div>;
}
