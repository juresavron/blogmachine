import { useState } from 'react';
import { ArrowUpRight, CalendarDays, Download, FileText, Globe2, LoaderCircle, Plus, Search, Trash2 } from 'lucide-react';
import type { Post, Site } from '../types';
import './editor.css';

type Props = { posts: Post[]; sites: Site[]; onEdit: (post: Post) => void; onCreate: () => void; onDelete: (post: Post) => Promise<void> };

export function PostsPage({ posts, sites, onEdit, onCreate, onDelete }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const filtered = [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(post => (filter === 'all' || post.status === filter) && `${post.title} ${post.excerpt}`.toLowerCase().includes(search.toLowerCase()));

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

  return <section className="posts-page">
    <div className="pp-intro"><div><span className="pp-eyebrow">YOUR CONTENT LIBRARY</span><h1>Good words. Great reach.</h1><p>All your stories, from the first idea to the final publish.</p></div><button className="pp-primary" type="button" onClick={onCreate}><Plus size={17} />Create a post</button></div>
    <div className="pp-toolbar"><div className="pp-filters" role="group" aria-label="Filter posts by status">{(['all', 'draft', 'published'] as const).map(value => <button type="button" key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All posts' : value === 'draft' ? 'Drafts' : 'Published'}<span>{posts.filter(post => value === 'all' || post.status === value).length}</span></button>)}</div><label className="pp-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search your posts…" aria-label="Search your posts" /></label></div>
    {error && <p className="pp-error" role="alert">{error}</p>}
    <div className="pp-list">
      {filtered.length ? filtered.map(post => <article className="pp-post" key={post.id}>
        <div className={`pp-post-icon ${post.status}`}><FileText size={22} strokeWidth={1.5} /></div>
        <div className="pp-post-body"><div className="pp-post-title"><button type="button" onClick={() => onEdit(post)}>{post.title}</button><span className={`pp-status ${post.status}`}><span />{post.status === 'published' ? 'Published' : 'Draft'}</span></div><p>{post.excerpt || post.content.replace(/\s+/g, ' ').slice(0, 150) || 'Your story is waiting to be written.'}</p><div className="pp-post-meta"><span><CalendarDays size={13} />{new Date(post.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Ljubljana' })}</span><span><Globe2 size={13} />{post.siteIds.length ? post.siteIds.map(id => sites.find(site => site.id === id)?.name).filter(Boolean).join(', ') : 'No destinations selected'}</span><span>{Math.max(1, Math.ceil(post.content.trim().split(/\s+/).filter(Boolean).length / 200))} min read</span></div></div>
        <div className="pp-post-actions">{confirmId === post.id ? <div className="pp-confirm"><span>Delete local post?</span><small>Live website posts stay published.</small><div><button type="button" onClick={() => setConfirmId(null)} disabled={deleting === post.id}>Cancel</button><button className="pp-danger" type="button" onClick={() => remove(post)} disabled={deleting === post.id}>{deleting === post.id ? <LoaderCircle size={14} className="pe-spinning" /> : 'Delete'}</button></div></div> : <><button type="button" className="pp-delete" aria-label={`Export ${post.title} as text`} title="Export post as .txt" onClick={() => exportPost(post)}><Download size={16} /></button><button type="button" className="pp-delete" aria-label={`Delete ${post.title}`} onClick={() => setConfirmId(post.id)}><Trash2 size={16} /></button><button type="button" className="pp-open" aria-label={`Edit ${post.title}`} onClick={() => onEdit(post)}><ArrowUpRight size={19} /></button></>}</div>
      </article>) : <div className="pp-empty"><div><FileText size={30} strokeWidth={1.5} /></div><h3>{search ? 'No stories found.' : filter === 'published' ? 'Your first publish is ahead.' : 'A blank page is a good beginning.'}</h3><p>{search ? 'Try a different search or change the status filter.' : 'Create a post, choose your websites, and share something worth reading.'}</p>{!search && <button type="button" className="pp-primary" onClick={onCreate}><Plus size={16} />Write your first post</button>}</div>}
    </div>
    <div className="pp-list-footer"><span>{filtered.length} {filtered.length === 1 ? 'post' : 'posts'}{search && ` matching “${search}”`}</span><span>A little consistency goes a long way.</span></div>
  </section>;
}
