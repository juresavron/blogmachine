import { useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpRight, CalendarDays, Download, FileText, Globe2, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react';
import type { Post, Site } from '../types';
import './editor.css';

type Props = { posts: Post[]; sites: Site[]; onEdit: (post: Post) => void; onCreate: () => void; onDelete: (post: Post) => Promise<void> };
type StatusFilter = 'all' | 'draft' | 'published';
type Sort = 'recent' | 'oldest' | 'title';

export function PostsPage({ posts, sites, onEdit, onCreate, onDelete }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [destination, setDestination] = useState('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const activeDestination = sites.some(site => site.id === destination) ? destination : 'all';
  const query = search.trim().toLowerCase();
  const hasFilters = Boolean(query || filter !== 'all' || activeDestination !== 'all');
  const filtered = posts.filter(post =>
    (filter === 'all' || post.status === filter) &&
    (activeDestination === 'all' || post.siteIds.includes(activeDestination)) &&
    `${post.title} ${post.excerpt} ${post.content} ${post.slug}`.toLowerCase().includes(query)
  ).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  const draftCount = posts.filter(post => post.status === 'draft').length;

  function clearFilters() { setSearch(''); setFilter('all'); setDestination('all'); }

  async function remove(post: Post) {
    setDeleting(post.id); setError('');
    try { await onDelete(post); setConfirmId(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this post. Please try again.'); }
    finally { setDeleting(null); }
  }

  function exportPost(post: Post) {
    const text = [post.title, post.excerpt, post.content].filter(Boolean).join('\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${post.slug || 'blog-post'}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="posts-page" aria-labelledby="posts-title">
    <div className="pp-intro"><div><span className="pp-eyebrow">YOUR CONTENT LIBRARY</span><h1 id="posts-title">A home for every story<span>.</span></h1><p>Keep your ideas moving, from the first draft to the next publication.</p></div><button className="pp-primary" type="button" onClick={onCreate}><Plus size={17} />Create a post</button></div>
    <div className="pp-library-summary"><span><FileText size={16} /><strong>{posts.length}</strong> {posts.length === 1 ? 'story' : 'stories'} in your library</span><span><i />{draftCount} {draftCount === 1 ? 'draft' : 'drafts'} in progress</span><span>Saved in your workspace</span></div>
    <div className="pp-toolbar">
      <div className="pp-filters" role="group" aria-label="Filter posts by status">{(['all', 'draft', 'published'] as const).map(value => <button type="button" key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All posts' : value === 'draft' ? 'Drafts' : 'Published'}<span>{posts.filter(post => value === 'all' || post.status === value).length}</span></button>)}</div>
      <label className="pp-search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search titles, content, or slugs…" aria-label="Search your posts" />{search && <button type="button" aria-label="Clear post search" onClick={() => setSearch('')}><X size={15} /></button>}</label>
    </div>
    <div className="pp-list-controls"><div className="pp-destination-filter"><Globe2 size={15} /><select aria-label="Filter posts by destination" value={activeDestination} onChange={event => setDestination(event.target.value)}><option value="all">All destinations</option>{sites.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}</select></div><div className="pp-sort"><ArrowDownWideNarrow size={15} /><select aria-label="Sort posts" value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="recent">Recently updated</option><option value="oldest">Oldest updated</option><option value="title">Title: A–Z</option></select></div></div>
    {error && <p className="pp-error" role="alert">{error}</p>}
    <div className="pp-list">
      {filtered.length ? filtered.map(post => {
        const words = post.content.trim().split(/\s+/).filter(Boolean).length;
        const destinations = post.siteIds.map(id => sites.find(site => site.id === id)?.name).filter(Boolean);
        return <article className="pp-post" key={post.id}>
          <div className={`pp-post-icon ${post.status}`}><FileText size={23} strokeWidth={1.5} /></div>
          <div className="pp-post-body"><div className="pp-post-title"><button type="button" onClick={() => onEdit(post)}>{post.title}</button><span className={`pp-status ${post.status}`}><span />{post.status === 'published' ? 'Published' : 'Draft'}</span></div><p>{post.excerpt || post.content.replace(/\s+/g, ' ').slice(0, 150) || 'Your story is waiting to be written.'}</p><div className="pp-post-meta"><span><CalendarDays size={13} /><time dateTime={post.updatedAt}>{new Date(post.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Ljubljana' })}</time></span><span className="pp-post-destinations" title={destinations.join(', ')}><Globe2 size={13} />{destinations.length ? destinations.join(', ') : 'No destination selected'}</span><span>{words ? `${Math.ceil(words / 200)} min read` : 'No content yet'}</span></div></div>
          <div className="pp-post-actions">{confirmId === post.id ? <div className="pp-confirm" role="group" aria-label={`Confirm deletion of ${post.title}`}><strong>Delete this local post?</strong><small>Articles on live websites are kept.</small><div><button type="button" onClick={() => setConfirmId(null)} disabled={deleting === post.id}>Keep post</button><button className="pp-danger" type="button" onClick={() => remove(post)} disabled={deleting === post.id}>{deleting === post.id ? <><LoaderCircle size={14} className="pe-spinning" />Deleting…</> : 'Delete'}</button></div></div> : <><button type="button" className="pp-export" aria-label={`Export ${post.title} as text`} title="Export as text" onClick={() => exportPost(post)}><Download size={17} /></button><button type="button" className="pp-delete" aria-label={`Delete ${post.title}`} title="Delete local post" onClick={() => setConfirmId(post.id)}><Trash2 size={17} /></button><button type="button" className="pp-open" aria-label={`Edit ${post.title}`} title="Open editor" onClick={() => onEdit(post)}><ArrowUpRight size={19} /></button></>}</div>
        </article>;
      }) : <div className="pp-empty"><div><FileText size={30} strokeWidth={1.5} /></div><h3>{hasFilters ? 'No stories match this view.' : 'Your next story starts here.'}</h3><p>{hasFilters ? 'Try another search or clear your filters to see your full library.' : 'A first draft does not need to be perfect. Save an idea and make it yours.'}</p>{hasFilters ? <button type="button" className="pp-secondary" onClick={clearFilters}>Clear filters <X size={15} /></button> : <button type="button" className="pp-primary" onClick={onCreate}><Plus size={16} />Write your first post</button>}</div>}
    </div>
    <div className="pp-list-footer"><span aria-live="polite">Showing {filtered.length} of {posts.length} {posts.length === 1 ? 'post' : 'posts'}</span>{hasFilters && <button type="button" onClick={clearFilters}>Clear filters</button>}<span>Every good story begins with a draft.</span></div>
  </section>;
}
