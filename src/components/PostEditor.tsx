import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowUpRight, Check, CheckCircle2, ChevronRight, Eye, FileText, Globe2, LoaderCircle, Save, Send, X } from 'lucide-react';
import type { Post, Site } from '../types';
import './editor.css';

type PostInput = { title: string; slug: string; excerpt: string; content: string; siteIds: string[] };

type Props = {
  post: Post | null;
  sites: Site[];
  onClose: () => void;
  onSave: (input: PostInput, publish: boolean) => Promise<void>;
};

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function PostEditor({ post, sites, onClose, onSave }: Props) {
  const [title, setTitle] = useState(post?.title ?? '');
  const [slug, setSlug] = useState(post?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(Boolean(post));
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? '');
  const [content, setContent] = useState(post?.content ?? '');
  const [siteIds, setSiteIds] = useState<string[]>(post?.siteIds ?? []);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState<'draft' | 'publish' | null>(null);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const validDraft = Boolean(title.trim() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug));
  const canPublish = validDraft && Boolean(content.trim()) && siteIds.length > 0;
  const selectedSites = sites.filter(site => siteIds.includes(site.id));
  const saveLabel = post?.status === 'published' ? 'Save changes' : 'Save draft';
  const dirty = title !== (post?.title ?? '') || slug !== (post?.slug ?? '') || excerpt !== (post?.excerpt ?? '') || content !== (post?.content ?? '') || JSON.stringify([...siteIds].sort()) !== JSON.stringify([...(post?.siteIds ?? [])].sort());

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function requestClose() {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !saving) {
      event.stopPropagation();
      if (confirmClose) setConfirmClose(false);
      else requestClose();
    }
    if (event.key !== 'Tab') return;
    const focusRoot = confirmClose ? discardRef.current : dialogRef.current;
    const elements = focusRoot?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]');
    if (!elements?.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  function toggleSite(siteId: string) {
    setSiteIds(current => current.includes(siteId) ? current.filter(id => id !== siteId) : [...current, siteId]);
  }

  async function save(publish: boolean) {
    if (!validDraft || saving || (publish && !canPublish)) return;
    setError(''); setSaving(publish ? 'publish' : 'draft');
    try {
      await onSave({ title: title.trim(), slug: slug.trim(), excerpt: excerpt.trim(), content: content.trim(), siteIds }, publish);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Your writing is still here; please try again.');
    } finally {
      setSaving(null);
    }
  }

  return <div className="post-editor" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div className="pe-dialog" role="dialog" aria-modal="true" aria-labelledby="post-editor-title" tabIndex={-1} ref={dialogRef} onKeyDown={handleKeyDown}>
      <div className="pe-topbar">
        <div className="pe-breadcrumb"><FileText size={16} /><span>Workspace</span><ChevronRight size={14} /><strong>{post ? 'Edit post' : 'New post'}</strong></div>
        <button className="pe-icon-button" type="button" onClick={requestClose} disabled={Boolean(saving)} aria-label="Close editor"><X size={20} /></button>
      </div>
      <div className="pe-layout">
        <main className="pe-main">
          <div className="pe-heading"><div><span className="pe-eyebrow">THE WRITING ROOM</span><h2 id="post-editor-title">{post ? 'A little more polish.' : 'Your next great post.'}</h2><p>One good story. A home on every website.</p></div><span className="pe-draft-label"><span />{post?.status === 'published' ? 'Published' : 'Draft'}</span></div>
          <label className="pe-label" htmlFor="post-title">Post title</label>
          <input className="pe-title-input" id="post-title" value={title} maxLength={250} placeholder="Give your story a great headline…" onChange={event => { setTitle(event.target.value); if (!slugEdited) setSlug(slugify(event.target.value)); }} disabled={Boolean(saving)} autoComplete="off" />
          <div className="pe-slug-row"><label htmlFor="post-slug">URL slug</label><span>/</span><input id="post-slug" value={slug} maxLength={200} onChange={event => { setSlugEdited(true); setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-')); }} onBlur={() => setSlug(slugify(slug))} placeholder="your-post-slug" disabled={Boolean(saving)} /></div>
          <label className="pe-label" htmlFor="post-excerpt">Short description <span>optional</span></label>
          <textarea className="pe-excerpt" id="post-excerpt" value={excerpt} maxLength={1000} onChange={event => setExcerpt(event.target.value)} placeholder="A small introduction that makes people want to read on." disabled={Boolean(saving)} rows={2} />
          <div className="pe-content-tabs"><div role="tablist" aria-label="Content view"><button type="button" role="tab" aria-selected={!preview} aria-controls="post-content-panel" onClick={() => setPreview(false)} className={!preview ? 'active' : ''}><FileText size={15} />Write</button><button type="button" role="tab" aria-selected={preview} aria-controls="post-content-panel" onClick={() => setPreview(true)} className={preview ? 'active' : ''}><Eye size={15} />Preview</button></div><span>Plain text</span></div>
          <div id="post-content-panel" className="pe-content-panel" role="tabpanel">
            {preview ? <article className="pe-preview"><h3>{title || 'Your headline goes here'}</h3>{excerpt && <p className="pe-preview-excerpt">{excerpt}</p>}{content ? content.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="pe-placeholder">Your story will appear here as you write.</p>}</article> : <textarea id="post-content" aria-label="Post content" className="pe-content-input" value={content} maxLength={200000} onChange={event => setContent(event.target.value)} placeholder={'Every great story starts with a first sentence.\n\nMake this one yours…'} disabled={Boolean(saving)} />}
          </div>
          <div className="pe-writing-meta"><span>{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span><span>{Math.max(1, Math.ceil(wordCount / 200))} min read</span><span>{content.length.toLocaleString()} characters</span></div>
        </main>
        <aside className="pe-sidebar">
          <div className="pe-sidebar-heading"><span className="pe-step">01</span><div><h3>Choose your destinations</h3><p>Where should this story live?</p></div></div>
          <div className="pe-destinations">
            {sites.length === 0 ? <p className="pe-empty-sites">Add a website from the Websites page to publish your first post. You can save your draft now.</p> : sites.map(site => <label key={site.id} className={`pe-destination ${siteIds.includes(site.id) ? 'selected' : ''}`}>
              <input type="checkbox" checked={siteIds.includes(site.id)} onChange={() => toggleSite(site.id)} disabled={Boolean(saving)} />
              <span className="pe-destination-icon"><Globe2 size={18} /></span><span className="pe-destination-info"><strong>{site.name}</strong><span>{new URL(site.url).hostname}</span><small>{site.platform === 'demo' ? 'Demo website · simulated publishing' : site.platform === 'manual' ? 'Manual export only' : site.credentialsConfigured ? 'WordPress · credentials configured' : 'WordPress · credentials needed'}</small></span><span className="pe-checkbox">{siteIds.includes(site.id) && <Check size={13} />}</span>
            </label>)}
          </div>
          <div className="pe-selected"><CheckCircle2 size={15} /><span>{selectedSites.length} {selectedSites.length === 1 ? 'website' : 'websites'} selected</span></div>
          {selectedSites.some(site => site.platform === 'manual' || (site.platform === 'wordpress' && !site.credentialsConfigured)) && <p className="pe-callout">Some selected websites aren’t ready for publishing. Configure WordPress credentials or remove manual destinations before publishing.</p>}
          <div className="pe-indexing-note"><span className="pe-note-icon"><ArrowUpRight size={18} /></span><h4>Give your story a head start.</h4><p>After publishing, check indexing and submit your sitemap from the Indexing page. Google decides when to index your content.</p></div>
          <p className="pe-autosave-note">{post?.status === 'published' ? 'Save changes keeps edits locally. Choose Publish post to update the selected websites.' : 'Save draft keeps your writing locally. Choose Publish post when you’re ready to share it.'}</p>
        </aside>
      </div>
      <div className="pe-footer">
        <div className="pe-footer-message" aria-live="polite">{error ? <span className="pe-error" role="alert">{error}</span> : <span>{!validDraft ? 'Add a title and a valid URL slug to save your post.' : !content.trim() ? 'Save your idea now. Add content when you’re ready to publish.' : post?.status === 'published' ? 'Saving keeps changes locally. Publish post updates your websites.' : 'Ready when you are. Let’s put your words to work.'}</span>}</div>
        <div className="pe-actions"><button type="button" className="pe-button pe-secondary" onClick={() => save(false)} disabled={!validDraft || Boolean(saving)}>{saving === 'draft' ? <LoaderCircle size={16} className="pe-spinning" /> : <Save size={16} />}{saveLabel}</button><button type="button" className="pe-button pe-primary" onClick={() => save(true)} disabled={!canPublish || Boolean(saving)}>{saving === 'publish' ? <LoaderCircle size={16} className="pe-spinning" /> : <Send size={16} />}Publish post<ArrowUpRight size={15} /></button></div>
      </div>
      {confirmClose && <div className="pe-discard-backdrop"><div className="pe-discard-prompt" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" ref={discardRef}><span className="pe-eyebrow">A QUICK CHECK</span><h3 id="discard-title">Leave without saving?</h3><p id="discard-description">You have unsaved changes. Keep writing or save your post before closing to keep your work.</p><div><button className="pe-button pe-secondary" type="button" onClick={() => setConfirmClose(false)} autoFocus>Keep writing</button><button className="pe-button pe-discard-button" type="button" onClick={onClose}>Discard changes</button></div></div></div>}
    </div>
  </div>;
}
