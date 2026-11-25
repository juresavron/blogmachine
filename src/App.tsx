import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, FileText, Globe2, FolderGit2, LayoutDashboard, LoaderCircle, Menu, Plus, Radio, Search, Settings2, Sprout, X, RefreshCw } from 'lucide-react';
import type { AppState, Post, PostInput, Site } from './types';
import { api } from './api';
import { PostEditor } from './components/PostEditor';
import { PostsPage } from './components/PostsPage';
import { SitesPage } from './components/SitesPage';
import { IndexingPage } from './components/IndexingPage';
import { RepositoriesPage } from './components/RepositoriesPage';
import { WorkspaceSettings } from './components/WorkspaceSettings';

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
  const [workspaceName, setWorkspaceName] = useState(() => { try { return localStorage.getItem('blogmachine.workspaceName')?.trim() || 'My workspace'; } catch { return 'My workspace'; } });
  const workspaceInitials = workspaceName.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();
  const [data, setData] = useState<AppState>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Post | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileView, setMobileView] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [filter, setFilter] = useState('all');
  const navigate = (next: Page) => { setPage(next); setMobileOpen(false); };
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const overlayTrigger = useRef<HTMLElement | null>(null);
  const restoreFocus = (element: HTMLElement | null) => {
    if (document.querySelector('[aria-modal="true"]')) return;
    if (element?.isConnected && element !== document.body && !element.closest('[inert]')) element.focus();
    else if (window.matchMedia('(max-width: 760px)').matches) document.querySelector<HTMLElement>('.mobile-menu')?.focus();
    else document.getElementById('main-content')?.focus();
  };
  const openEditor = (post: Post | null) => { editorTrigger.current = document.activeElement as HTMLElement | null; setEditing(post); };
  const closeEditor = () => { setEditing(undefined); requestAnimationFrame(() => restoreFocus(editorTrigger.current)); };
  const openSearch = () => { overlayTrigger.current = document.activeElement as HTMLElement | null; setQuery(''); setSearchOpen(true); };
  const openGuide = () => { overlayTrigger.current = document.activeElement as HTMLElement | null; setMobileOpen(false); setGuideOpen(true); };
  const openNavigation = () => { overlayTrigger.current = document.activeElement as HTMLElement | null; setMobileOpen(true); };

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
    document.title = `${page === 'indexing' ? 'Search & indexing' : page[0].toUpperCase() + page.slice(1)} · Blog Machine`;
    setMobileOpen(false);
  }, [page]);
  useEffect(() => {
    const hash = () => { const p = window.location.hash.slice(1); if (['overview', 'posts', 'websites', 'repositories', 'indexing', 'settings'].includes(p)) setPage(p as Page); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSearchOpen(false); setGuideOpen(false); setMobileOpen(false); }
      if ((e.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"]') || document.querySelector('[aria-modal="true"]')) return;
      if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault(); openSearch();
      }
    };
    window.addEventListener('hashchange', hash); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('hashchange', hash); window.removeEventListener('keydown', key); if (noticeTimer.current) clearTimeout(noticeTimer.current); };
  }, []);

  useEffect(() => {
    if (!searchOpen && !guideOpen && !mobileOpen) return;
    const previous = overlayTrigger.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = document.querySelector<HTMLElement>(searchOpen ? '.search-dialog' : guideOpen ? '.guide-dialog' : '.sidebar');
    dialog?.querySelector<HTMLElement>('input, button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog?.addEventListener('keydown', trap);
    return () => { dialog?.removeEventListener('keydown', trap); document.body.style.overflow = oldOverflow; restoreFocus(previous); };
  }, [searchOpen, guideOpen, mobileOpen]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 761px)');
    const closeOnDesktop = () => { setMobileView(!desktop.matches); if (desktop.matches) setMobileOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

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
    await refresh(); closeEditor();
  };
  const deletePost = async (post: Post) => { await api(`/posts/${post.id}`, { method: 'DELETE' }); await refresh(); notify('Post removed from your library. Published articles on live websites are kept.'); };
  const sites = filter === 'all' ? data.sites : data.sites.filter(s => s.id === filter);
  const posts = filter === 'all' ? data.posts : data.posts.filter(p => p.siteIds.includes(filter));
  const publications = data.publications.filter(p => filter === 'all' || p.siteId === filter);
  const published = publications.filter(p => p.status === 'published');
  const indexed = published.filter(p => p.indexingStatus === 'indexed');
  const drafts = posts.filter(p => p.status === 'draft');
  const recent = [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const searchPosts = data.posts.filter(p => `${p.title} ${p.excerpt} ${p.content} ${p.slug}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6);
  const searchSites = data.sites.filter(s => `${s.name} ${s.url}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 3);
  const pageTitle = page === 'indexing' ? 'Search & indexing' : page[0].toUpperCase() + page.slice(1);

  const setupSteps = [
    { title: 'Put an idea into words', detail: `${data.posts.length} posts in your library`, done: data.posts.length > 0, action: () => openEditor(null) },
    { title: 'Connect a real website', detail: 'Bring your stories to their next home', done: data.sites.some(site => site.platform !== 'demo'), action: () => setPage('websites') },
    { title: 'Check your search presence', detail: 'Inspect a live URL with Google', done: data.publications.some(p => p.lastInspectedAt), action: () => setPage('indexing') },
  ];
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}
    <aside id="workspace-navigation" className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} aria-label="Workspace navigation" inert={(mobileView && !mobileOpen) || searchOpen || guideOpen || editing !== undefined || undefined}>
      <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={20} /></button>
      <a className="brand" href="#overview" onClick={() => navigate('overview')} aria-label="Blog Machine home"><span className="brand-mark"><span /><span /><span /></span><span>blog<span className="brand-second">machine</span><span className="brand-dot">®</span></span></a>
      <button className="workspace-switch" onClick={() => navigate('settings')}><span className="workspace-avatar">{workspaceInitials}</span><span><strong>{workspaceName}</strong><small>Personal workspace</small></span><Settings2 size={15} /></button>
      <div className="nav-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">{nav.map(item => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={19} strokeWidth={1.65} /><span>{item.label}</span>{item.id === 'posts' && <span className="nav-count">{data.posts.length}</span>}{page === item.id && <span className="active-dot" />}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-note"><div className="note-illustration"><Sprout size={36} strokeWidth={1.25} /><span>✦</span><span>✧</span></div><strong>Good stories deserve<br />to be found.</strong><p>A little help to grow your<br />corner of the internet.</p><button onClick={openGuide}>Your publishing guide <ArrowUpRight size={14} /></button></div>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={19} strokeWidth={1.6} />Settings</button><button className="nav-item" onClick={openGuide}><CircleHelp size={19} strokeWidth={1.6} />Help & getting started <ArrowUpRight size={14} /></button></div>
      <div className="sidebar-footer"><span className="online-dot" /> Local workspace <span>v0.1</span></div>
    </aside>
    <div className="main-shell" inert={mobileOpen || searchOpen || guideOpen || editing !== undefined || undefined}>
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="workspace-navigation" onClick={openNavigation}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{pageTitle}</strong></div><div className="topbar-actions"><button className="search-trigger" aria-label="Search workspace" onClick={openSearch}><Search size={16} /><span>Search anything...</span><kbd>Ctrl / ⌘ K</kbd></button><span className="topbar-separator" /><span className="demo-pill"><span />Local workspace</span><button className="user-avatar" onClick={() => navigate('settings')} aria-label="Workspace settings">{workspaceInitials}</button></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {loading ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><h2>Opening your workspace…</h2><p>Making room for your next good idea.</p></div> : error ? <div className="error-state"><Radio size={32} /><h2>We couldn’t load your workspace</h2><p>{error}</p><button className="button primary" onClick={() => { setLoading(true); refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }}><RefreshCw size={16} />Try again</button></div> : <>
          {page === 'overview' && <>
            <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE, AT A GLANCE</div><h1>Your publishing home<span className="title-dot">.</span></h1><p>A space for good ideas. A home for everything you publish.</p></div><button className="button primary" onClick={() => openEditor(null)}><Plus size={17} />Create a post</button></div>
            <div className="overview-toolbar"><span>{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Europe/Ljubljana' }).format(new Date())}</span><label className="select-wrap"><Globe2 size={14} /><select aria-label="Filter overview by website" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All websites</option>{data.sites.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select><ChevronDown size={13} /></label></div>
            <section className="stats-grid" aria-label="Publishing statistics"><Metric icon={FileText} label="Publications" value={published.length} detail={`${published.filter(p => p.mode === 'demo').length} demo · ${published.filter(p => p.mode === 'live').length} live`} /><Metric icon={BookOpen} label="Drafts in the works" value={drafts.length} detail="Ready when inspiration is" /><Metric icon={Globe2} label="Your websites" value={sites.length} detail={`${sites.filter(s => s.platform !== 'demo').length} real · ${sites.filter(s => s.platform === 'demo').length} demo`} /><Metric icon={Radio} label="Indexed by Google" value={indexed.length} detail={published.some(p => p.lastInspectedAt) ? 'Confirmed by URL inspection' : 'No live URLs inspected yet'} /></section>
            {data.sites.length > 0 && data.sites.every(site => site.platform === 'demo') && <div className="demo-workspace-note"><span className="demo-note-icon"><Sprout size={22} /></span><div><strong>A little room to experiment.</strong><p>Your demo sites let you try the full writing flow. Nothing is sent to a live website.</p></div><button className="text-button" onClick={() => navigate('websites')}>Connect a website <ArrowRight size={16} /></button></div>}
            <section className="websites-section"><div className="section-heading"><div><h2>Your websites <span className="count-bubble">{sites.length}</span></h2><p>A home for each side of your story.</p></div><button className="text-button" onClick={() => navigate('websites')}>Manage websites <ArrowRight size={15} /></button></div>
              {sites.length ? <div className="website-grid">{sites.slice(0, 3).map((site, index) => { const count = data.publications.filter(p => p.siteId === site.id && p.status === 'published').length; return <button key={site.id} className="overview-website-card" onClick={() => navigate('websites')}><div className="website-preview-label"><span>{site.platform === 'demo' ? 'DEMO COLLECTION' : site.platform === 'wordpress' ? 'WORDPRESS' : 'MANUAL PUBLISHING'}</span><ArrowUpRight size={16} /></div>{site.platform === 'demo' ? <WebsiteArt index={index} /> : <div className="website-art live-website-art"><Globe2 size={48} strokeWidth={1} /><span>{new URL(site.url).hostname}</span></div>}<div className="overview-website-card-body"><div className="overview-website-card-title"><SiteMark site={site} index={index} /><span><strong>{site.name}</strong><small>{new URL(site.url).hostname}</small></span><ArrowUpRight size={17} /></div><div className="overview-website-card-footer"><span className={`platform-label ${site.platform === 'demo' ? 'demo' : ''}`}><span />{site.platform === 'demo' ? 'Demo website' : site.platform === 'wordpress' ? (site.credentialsConfigured ? 'WordPress configured' : 'Needs credentials') : 'Manual publishing'}</span><span>{count} article{count !== 1 ? 's' : ''}</span></div></div></button>; })}</div> : <div className="empty-inline"><Globe2 /><p>Your next story needs a home.</p><button className="text-button" onClick={() => navigate('websites')}>Add your first website <ArrowRight size={15} /></button></div>}
            </section>
            <div className="lower-grid"><section className="recent-section panel"><div className="section-heading"><div><h2>On your desk</h2><p>A fresh look at what you’ve been working on.</p></div><button className="text-button" onClick={() => navigate('posts')}>All posts <ArrowRight size={15} /></button></div><div className="recent-table"><div className="table-head"><span>POST</span><span>STATUS</span><span>UPDATED</span><span /></div>{recent.length ? recent.map(post => <button className="post-row" key={post.id} onClick={() => openEditor(post)}><span className="post-row-title"><span className={`post-icon ${post.status}`}><FileText size={18} strokeWidth={1.5} /></span><span><strong>{post.title}</strong><small>{post.siteIds.length ? post.siteIds.map(id => data.sites.find(s => s.id === id)?.name).filter(Boolean).join(' · ') : 'No website selected'}</small></span></span><span className={`status-badge ${post.status}`}><span />{post.status === 'published' ? 'Published' : 'Draft'}</span><span className="date-text">{formatDate(post.updatedAt)}</span><ChevronRight size={16} /></button>) : <div className="empty-inline"><p>A blank page is a good place to begin.</p><button className="text-button" onClick={() => openEditor(null)}>Write your first post <ArrowRight size={15} /></button></div>}</div></section>
              <section className="setup-card"><div className="setup-card-top"><span className="eyebrow">GROW AT YOUR OWN PACE</span><Sprout size={24} strokeWidth={1.4} /></div><h2>One story.<br /> New possibilities.</h2><p>Your next steps to a connected publishing routine.</p><div className="setup-steps">{setupSteps.map((step, index) => <button key={step.title} onClick={step.action}><span className={step.done ? 'step-number complete' : 'step-number'}>{step.done ? <Check size={14} /> : String(index + 1).padStart(2, '0')}</span><span><strong>{step.title}</strong><small>{step.detail}</small></span><ChevronRight size={15} /></button>)}</div><button className="text-button" onClick={openGuide}>Open publishing guide <ArrowUpRight size={15} /></button></section>
            </div>
            <footer className="content-footer"><span>Made for your ideas, wherever they live.</span><span><span className="online-dot" /> Saved in your workspace</span></footer>
          </>}
          {page === 'posts' && <PostsPage posts={data.posts} sites={data.sites} onEdit={openEditor} onCreate={() => openEditor(null)} onDelete={deletePost} />}
          {page === 'websites' && <SitesPage sites={data.sites} onRefresh={refresh} onNotify={notify} />}
          {page === 'indexing' && <IndexingPage sites={data.sites} posts={data.posts} publications={data.publications} googleConfigured={data.capabilities?.googleConfigured ?? false} onRefresh={refresh} onNotify={notify} />}
          {page === 'repositories' && <RepositoriesPage posts={data.posts} onNotify={notify} />}
          {page === 'settings' && <WorkspaceSettings data={data} name={workspaceName} onSaveName={name => { localStorage.setItem('blogmachine.workspaceName', name); setWorkspaceName(name); }} onNavigate={navigate} onNotify={notify} />}
          {data.publications.some(p => p.status === 'failed' || p.error) && <section className="failure-panel" role="status"><strong>Some publications need your attention</strong>{data.publications.filter(p => p.status === 'failed' || p.error).map(p => <p key={p.id}><button className="text-button" onClick={() => { const post = data.posts.find(post => post.id === p.postId); if (post) openEditor(post); }}>{data.posts.find(post => post.id === p.postId)?.title}</button> · {data.sites.find(s => s.id === p.siteId)?.name}: {p.error}</p>)}</section>}
        </>}
      </main>
    </div>
    {editing !== undefined && <PostEditor post={editing} sites={data.sites} onClose={closeEditor} onSave={savePost} />}
    {notice && <div className="toast" role="status"><span className="toast-icon"><Check size={16} /></span><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={16} /></button></div>}
    {searchOpen && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setSearchOpen(false); }}><section className="search-dialog" role="dialog" aria-modal="true" aria-label="Search workspace"><div className="search-input-row"><Search size={21} /><input autoFocus placeholder="Find a post or website…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search posts and websites" /><button className="icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={19} /></button></div><div className="search-results"><div className="eyebrow">POSTS</div>{searchPosts.map(p => <button key={p.id} onClick={() => { setSearchOpen(false); openEditor(p); }}><FileText size={17} /><span>{p.title}</span><ArrowUpRight size={15} /></button>)}{!searchPosts.length && <p>No matching posts.</p>}<div className="eyebrow">WEBSITES</div>{searchSites.map(s => <button key={s.id} onClick={() => { setSearchOpen(false); setPage('websites'); }}><Globe2 size={17} /><span>{s.name}</span><ArrowUpRight size={15} /></button>)}{!searchSites.length && <p>No matching websites.</p>}</div><div className="search-footer"><span>Search titles, body text, and websites</span><span><kbd>esc</kbd> to close</span></div></section></div>}
    {guideOpen && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setGuideOpen(false); }}><section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title"><button className="icon-button close-guide" onClick={() => setGuideOpen(false)} aria-label="Close guide"><X size={20} /></button><span className="guide-emblem"><Sprout size={32} /></span><div className="eyebrow">FROM IDEA TO OUT THERE</div><h2 id="guide-title">Make yourself at home.</h2><p>Three small steps to a more connected publishing routine.</p>{[{n:'01',title:'Give your stories a home',text:'Try a demo site, or connect a live WordPress website with a server-side application password.',action:'Manage websites',page:'websites'},{n:'02',title:'Put a good idea into words',text:'Write your post, pick its destinations, and save a draft or publish when it’s ready.',action:'Create a post',page:'new'},{n:'03',title:'Help your stories get discovered',text:'Submit a sitemap and inspect live URLs with Search Console. Google decides what gets indexed.',action:'Search & indexing',page:'indexing'}].map(step => <div className="guide-step" key={step.n}><span>{step.n}</span><div><h3>{step.title}</h3><p>{step.text}</p><button className="text-button" onClick={() => { setGuideOpen(false); if(step.page === 'new') openEditor(null); else setPage(step.page as Page); }}>{step.action}<ArrowRight size={14} /></button></div></div>)}</section></div>}
  </div>;
}
function Metric({ icon: Icon, label, value, detail }: { icon: typeof FileText; label: string; value: number; detail: string }) {
  return <div className="metric-card"><div className="metric-label"><span>{label}</span><Icon size={17} strokeWidth={1.5} /></div><strong className="metric-value">{String(value).padStart(2, '0')}</strong><div className="metric-detail">{detail}</div></div>;
}
