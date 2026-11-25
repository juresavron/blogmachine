import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowUpRight, Check, CheckCircle2, ChevronRight, Eye, FileText, Globe2, LoaderCircle, Save, Send, X } from 'lucide-react';
import type { Post, Site } from '../types';
import './editor.css';

type PostInput = { title: string; slug: string; excerpt: string; content: string; siteIds: string[] };
type Props = { post: Post | null; sites: Site[]; onClose: () => void; onSave: (input: PostInput, publish: boolean) => Promise<void> };

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200).replace(/-$/, '');
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
  const discardPreviousFocus = useRef<HTMLElement | null>(null);
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const selectedSites = sites.filter(site => siteIds.includes(site.id));
  const invalidSlug = Boolean(slug) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const validDraft = Boolean(title.trim() && slug && !invalidSlug);
  const unreadySites = selectedSites.filter(site => site.platform === 'manual' || (site.platform === 'wordpress' && !site.credentialsConfigured));
  const canPublish = validDraft && Boolean(content.trim()) && selectedSites.length > 0 && unreadySites.length === 0;
  const demoOnly = selectedSites.length > 0 && selectedSites.every(site => site.platform === 'demo');
  const liveCount = selectedSites.filter(site => site.platform === 'wordpress').length;
  const saveLabel = post?.status === 'published' ? 'Save changes' : 'Save draft';
  const dirty = title !== (post?.title ?? '') || slug !== (post?.slug ?? '') || excerpt !== (post?.excerpt ?? '') || content !== (post?.content ?? '') || JSON.stringify([...siteIds].sort()) !== JSON.stringify([...(post?.siteIds ?? [])].sort());

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLInputElement>('#post-title')?.focus();
    return () => { document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault(); event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!confirmClose) return;
    discardRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => discardPreviousFocus.current?.focus();
  }, [confirmClose]);

  function requestClose() {
    if (saving) return;
    if (dirty) {
      discardPreviousFocus.current = document.activeElement as HTMLElement | null;
      setConfirmClose(true);
    } else onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!confirmClose) void save(false);
      return;
    }
    if (event.key === 'Escape' && !saving) {
      event.stopPropagation();
      if (confirmClose) setConfirmClose(false);
      else requestClose();
    }
    if (event.key !== 'Tab') return;
    const focusRoot = confirmClose ? discardRef.current : dialogRef.current;
    const elements = focusRoot?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]');
    if (!elements?.length) return;
    const first = elements[0], last = elements[elements.length - 1];
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
      await onSave({ title: title.trim(), slug: slug.trim(), excerpt: excerpt.trim(), content: content.trim(), siteIds: selectedSites.map(site => site.id) }, publish);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Your writing is still here; please try again.');
    } finally { setSaving(null); }
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? false : event.key === 'End' ? true : !preview;
    setPreview(next);
    document.getElementById(next ? 'pe-preview-tab' : 'pe-write-tab')?.focus();
  }

  const footerMessage = !validDraft ? 'Add a title and a valid URL slug to save your draft.'
    : !content.trim() ? 'Your idea can be saved now. Add content before publishing.'
      : !selectedSites.length ? 'Save your draft, or choose a destination to publish.'
        : unreadySites.length ? 'Remove destinations that need setup before publishing.'
          : demoOnly ? 'Demo publishing creates local records. No website will be contacted.'
            : `Publish post sends this story to ${liveCount} live ${liveCount === 1 ? 'website' : 'websites'}.`;

  return <div className="post-editor" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div className="pe-dialog" role="dialog" aria-modal="true" aria-labelledby="post-editor-title" aria-busy={Boolean(saving)} tabIndex={-1} ref={dialogRef} onKeyDown={handleKeyDown}>
      <div className="pe-topbar" inert={confirmClose}><div className="pe-breadcrumb"><FileText size={17} /><span>Posts</span><ChevronRight size={14} /><strong>{post ? 'Edit story' : 'New story'}</strong></div><div className="pe-topbar-actions"><span className={`pe-save-state ${dirty ? 'unsaved' : ''}`}><span />{saving ? 'Saving…' : dirty ? 'Unsaved changes' : post ? 'Saved locally' : 'New draft'}</span><button className="pe-icon-button" type="button" onClick={requestClose} disabled={Boolean(saving)} aria-label="Close editor"><X size={21} /></button></div></div>
      <div className="pe-layout" inert={confirmClose}>
        <section className="pe-main">
          <div className="pe-heading"><div><span className="pe-eyebrow">THE WRITING ROOM</span><h2 id="post-editor-title">{post ? 'Make every word count.' : 'Start with a good idea.'}</h2><p>A little space to turn your thoughts into a story.</p></div><span className={`pe-draft-label ${post?.status === 'published' ? 'published' : ''}`}><span />{post?.status === 'published' ? 'Published' : 'Draft'}</span></div>
          <label className="pe-label" htmlFor="post-title">Post title <span>{title.length}/250</span></label>
          <input className="pe-title-input" id="post-title" value={title} maxLength={250} placeholder="Give your story a headline…" onChange={event => { setTitle(event.target.value); if (!slugEdited) setSlug(slugify(event.target.value)); }} disabled={Boolean(saving)} autoComplete="off" />
          <div className="pe-slug-row"><label htmlFor="post-slug">URL slug</label><span>/</span><input id="post-slug" value={slug} maxLength={200} aria-invalid={invalidSlug || undefined} aria-describedby={invalidSlug ? 'pe-slug-error' : undefined} onChange={event => { setSlugEdited(true); setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-')); }} onBlur={() => setSlug(slugify(slug))} placeholder="your-post-slug" disabled={Boolean(saving)} /></div>
          {invalidSlug && <p className="pe-field-error" id="pe-slug-error">Use lowercase words separated by hyphens, without a hyphen at either end.</p>}
          <label className="pe-label" htmlFor="post-excerpt">Short description <span>Optional for general posts</span></label>
          <textarea className="pe-excerpt" id="post-excerpt" value={excerpt} maxLength={1000} onChange={event => setExcerpt(event.target.value)} placeholder="A short introduction that gives readers a reason to keep going." disabled={Boolean(saving)} rows={2} />
          <div className="pe-content-tabs"><div role="tablist" aria-label="Content view"><button type="button" role="tab" id="pe-write-tab" aria-selected={!preview} aria-controls="post-content-panel" tabIndex={!preview ? 0 : -1} onKeyDown={moveTab} onClick={() => setPreview(false)} className={!preview ? 'active' : ''}><FileText size={16} />Write</button><button type="button" role="tab" id="pe-preview-tab" aria-selected={preview} aria-controls="post-content-panel" tabIndex={preview ? 0 : -1} onKeyDown={moveTab} onClick={() => setPreview(true)} className={preview ? 'active' : ''}><Eye size={16} />Preview</button></div><span>Plain text</span></div>
          <div id="post-content-panel" className="pe-content-panel" role="tabpanel" aria-labelledby={preview ? 'pe-preview-tab' : 'pe-write-tab'}>
            {preview ? <article className="pe-preview"><h3>{title || 'Your headline goes here'}</h3>{excerpt && <p className="pe-preview-excerpt">{excerpt}</p>}{content ? content.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="pe-placeholder">Your story will appear here as you write.</p>}</article> : <textarea id="post-content" aria-label="Post content" className="pe-content-input" value={content} maxLength={200000} onChange={event => setContent(event.target.value)} placeholder={'Every story starts with a first sentence.\n\nMake this one yours…'} disabled={Boolean(saving)} />}
          </div>
          <div className="pe-writing-meta"><span>{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span><span>{wordCount ? `${Math.ceil(wordCount / 200)} min read` : 'A fresh page'}</span><span>{content.length.toLocaleString()} characters</span></div>
        </section>
        <aside className="pe-sidebar" aria-label="Publishing destinations">
          <div className="pe-sidebar-heading"><span className="pe-step"><Globe2 size={17} /></span><div><h3>Where will it live?</h3><p>Choose destinations for this story.</p></div></div>
          <div className="pe-destinations">
            {sites.length === 0 ? <p className="pe-empty-sites">Add a website from Websites when you’re ready to publish. You can save your draft now.</p> : sites.map(site => <label key={site.id} className={`pe-destination ${siteIds.includes(site.id) ? 'selected' : ''}`}>
              <input type="checkbox" checked={siteIds.includes(site.id)} onChange={() => toggleSite(site.id)} disabled={Boolean(saving)} />
              <span className={`pe-destination-icon ${site.platform}`}><Globe2 size={18} /></span><span className="pe-destination-info"><strong>{site.name}</strong><span>{new URL(site.url).hostname}</span><small>{site.platform === 'demo' ? 'Demo · local simulation' : site.platform === 'manual' ? 'Manual export only' : site.credentialsConfigured ? 'WordPress · credentials present' : 'WordPress · needs credentials'}</small></span><span className="pe-checkbox">{siteIds.includes(site.id) && <Check size={13} />}</span>
            </label>)}
          </div>
          <div className="pe-selected" aria-live="polite"><CheckCircle2 size={16} /><span>{selectedSites.length} {selectedSites.length === 1 ? 'destination' : 'destinations'} selected</span></div>
          {unreadySites.length > 0 && <p className="pe-callout">Manual destinations use text export from Posts. WordPress destinations need credentials. You can save this draft, or deselect these destinations to publish.</p>}
          {liveCount > 0 && unreadySites.length === 0 && <p className="pe-live-note"><Send size={15} />Publishing will create or update an article on your selected live websites.</p>}
          <div className="pe-indexing-note"><span className="pe-note-icon"><ArrowUpRight size={19} /></span><h4>A story worth discovering.</h4><p>After a live publication, use Search & indexing to inspect its URL. Google decides when to crawl and index it.</p></div>
          <p className="pe-autosave-note"><Save size={15} /><span>{post?.status === 'published' ? 'Saving keeps your edits locally. Publish again to update your websites.' : 'Your writing is saved when you choose Save draft. You can come back to it anytime.'}</span></p>
        </aside>
      </div>
      <div className="pe-footer" inert={confirmClose}><div className="pe-footer-message" aria-live="polite">{error ? <span className="pe-error" role="alert">{error}</span> : <span>{footerMessage}</span>}</div><div className="pe-actions"><button type="button" className="pe-button pe-secondary" onClick={() => save(false)} disabled={!validDraft || Boolean(saving)} title="Save locally (Ctrl or Command + S)">{saving === 'draft' ? <LoaderCircle size={17} className="pe-spinning" /> : <Save size={17} />}{saveLabel}</button><button type="button" className="pe-button pe-primary" onClick={() => save(true)} disabled={!canPublish || Boolean(saving)}>{saving === 'publish' ? <LoaderCircle size={17} className="pe-spinning" /> : <Send size={17} />}{demoOnly ? 'Publish demo' : 'Publish post'}</button></div></div>
      {confirmClose && <div className="pe-discard-backdrop"><div className="pe-discard-prompt" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" ref={discardRef}><span className="pe-eyebrow">BEFORE YOU GO</span><h3 id="discard-title">Keep your good ideas.</h3><p id="discard-description">This post has unsaved changes. Keep writing, or discard these edits and close the editor.</p><div><button className="pe-button pe-secondary" type="button" onClick={() => setConfirmClose(false)}>Keep writing</button><button className="pe-button pe-discard-button" type="button" onClick={onClose}>Discard changes</button></div></div></div>}
    </div>
  </div>;
}
