import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowRight, CheckCircle2, ChevronRight, Code2, Database, Eye, FileCode2, FileText, FolderGit2, GitBranch, Globe2, Info, Loader2, LockKeyhole, LogOut, RefreshCw, Save, Search, ShieldCheck, UserRound, Languages, Link2 } from 'lucide-react';
import { api } from '../api';
import type { Post } from '../types';
import './repositories.css';

interface Target { key: string; label: string; url: string; locale: string; contentPath: string; sourceLive?: boolean; }
interface Repository {
  id: string; label: string; repository: string; description: string;
  kind: 'git-content' | 'database' | 'empty'; checkoutDirectory?: string; targets: Target[]; warnings: string[];
  deployment: string; available: boolean; sourceMode?: 'github' | 'local'; sourceRequiresToken?: boolean; branch: string | null; head: string | null; message: string;
}
interface PreparedChange {
  id: string; repositoryId: string; targetKey: string; postId: string; postTitle: string;
  format: 'git-patch' | 'database-draft'; relativePath: string; articleUrl: string;
  baseHead: string; createdAt: string; status: 'prepared'; instructions: string; warnings: string[]; downloadUrl: string; remoteDraftSavedAt?: string;
}
interface ArticleVersion { targetKey: string; locale: string; slug: string; title: string; url: string; }
interface Article {
  slug: string; title: string; description: string; url: string;
  sourceSlug?: string; articleKey?: string; seoTitle?: string; primaryKeyword?: string; takeaway?: string; imageAlt?: string;
  versions?: ArticleVersion[];
}
interface ArticleState { key: string; loading: boolean; articles: Article[]; sourceArticles?: Article[]; sourceHash: string; message: string; error: string; }
interface ConnectionResult { message: string; readable?: boolean; head?: string; branch?: string; configured?: boolean; authenticated?: boolean; admin?: boolean; }
interface MediaSession { authenticated: boolean; admin: boolean; source: 'browser' | 'environment' | 'none'; expiresAt?: string; message: string; }
class MediaAccountError extends Error { constructor(public status: number, message: string) { super(message); } }
async function mediaAccountRequest(action: 'session' | 'login' | 'logout', body?: { email: string; password: string }, signal?: AbortSignal): Promise<MediaSession> {
  const failure = action === 'login' ? 'Could not connect your account. Check your email and password and try again.' : action === 'logout' ? 'Could not disconnect your account. Try again.' : 'Could not check your account connection. Try again or reconnect.';
  let response: Response;
  try {
    response = await fetch(`/api/connections/mediasped/${action}`, { method: action === 'session' ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal, ...(action !== 'session' ? { headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) } : {}) });
  } catch { throw new MediaAccountError(0, failure); }
  if (!response.ok) {
    const message = action === 'login' && response.status === 428 ? 'Your browser connection is ready. Re-enter your password and connect again.' : action === 'login' && response.status === 429 ? 'Too many sign-in attempts. Wait a few minutes and try again.' : action === 'login' && response.status === 503 ? 'Account sign-in is unavailable. Check the website connection setup or try again later.' : failure;
    throw new MediaAccountError(response.status, message);
  }
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== 'object' || !('authenticated' in value) || typeof value.authenticated !== 'boolean' || !('admin' in value) || typeof value.admin !== 'boolean' || !('source' in value) || !['browser', 'environment', 'none'].includes(String(value.source)) || !('message' in value) || typeof value.message !== 'string' || ('expiresAt' in value && typeof value.expiresAt !== 'string')) throw new MediaAccountError(0, failure);
  return { authenticated: value.authenticated, admin: value.admin, source: value.source as MediaSession['source'], message: value.message, ...('expiresAt' in value ? { expiresAt: value.expiresAt as string } : {}) };
}
interface Props { posts: Post[]; onNotify: (message: string) => void; }
const emptyArticles: ArticleState = { key: '', loading: false, articles: [], sourceHash: '', message: '', error: '' };
const languageNames: Record<string, string> = { sl: 'Slovenian', hr: 'Croatian', it: 'Italian' };
function todayInLjubljana() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { timeZone: 'Europe/Ljubljana', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function RepositoryIcon({ kind, size = 19 }: { kind: Repository['kind']; size?: number }) {
  return kind === 'database' ? <Database size={size} /> : kind === 'empty' ? <FolderGit2 size={size} /> : <GitBranch size={size} />;
}

export function RepositoriesPage({ posts, onNotify }: Props) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [changes, setChanges] = useState<PreparedChange[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'ready' | 'setup' | 'planned'>('all');
  const [targetKey, setTargetKey] = useState('');
  const [postId, setPostId] = useState('');
  const [articles, setArticles] = useState<ArticleState>(emptyArticles);
  const [articleQuery, setArticleQuery] = useState('');
  const [reloadArticles, setReloadArticles] = useState(0);
  const [category, setCategory] = useState('');
  const [artwork, setArtwork] = useState('');
  const [takeaway, setTakeaway] = useState('');
  const [publishedAt, setPublishedAt] = useState(todayInLjubljana);
  const [directoryLink, setDirectoryLink] = useState('');
  const [primaryKeyword, setPrimaryKeyword] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [imageAlt, setImageAlt] = useState('');
  const [sourceSlug, setSourceSlug] = useState('');
  const [ctaTemplateSlug, setCtaTemplateSlug] = useState('');
  const [imageSourceSlug, setImageSourceSlug] = useState('google-ocene-vodic-za-podjetja');
  const [preparing, setPreparing] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveDraftError, setSaveDraftError] = useState('');
  const [mediaSession, setMediaSession] = useState<MediaSession | null>(null);
  const [mediaStatusLoading, setMediaStatusLoading] = useState(false);
  const [mediaStatusRetry, setMediaStatusRetry] = useState(0);
  const [mediaAuthAction, setMediaAuthAction] = useState<'login' | 'logout' | null>(null);
  const [mediaAuthError, setMediaAuthError] = useState('');
  const [mediaEmail, setMediaEmail] = useState('');
  const [mediaPassword, setMediaPassword] = useState('');
  const busy = preparing || savingDraft || mediaAuthAction !== null;
  const [prepareError, setPrepareError] = useState('');
  const [preview, setPreview] = useState<{ change: PreparedChange; text: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState('');
  const [test, setTest] = useState<{ key: string; loading: boolean; result?: ConnectionResult; error?: string } | null>(null);
  const mounted = useRef(true);
  const catalogRequest = useRef(0);
  const articleRequest = useRef(0);
  const prepareRequest = useRef(0);
  const previewRequest = useRef(0);
  const testRequest = useRef(0);
  const saveRequest = useRef(0);
  const mediaRequest = useRef(0);
  const previewElement = useRef<HTMLDivElement>(null);
  const selected = repositories.find(repository => repository.id === repositoryId);
  const hostedSource = selected?.sourceMode === 'github' || !!selected?.sourceRequiresToken;
  const sourceReadyCount = repositories.filter(repository => repository.available && repository.kind !== 'empty').length;
  const setupCount = repositories.filter(repository => !repository.available && repository.kind !== 'empty').length;
  const plannedCount = repositories.filter(repository => repository.kind === 'empty').length;
  const visibleRepositories = repositories.filter(repository => {
    const matchesSearch = `${repository.label} ${repository.repository}`.toLowerCase().includes(catalogQuery.trim().toLowerCase());
    const matchesFilter = catalogFilter === 'all' || (catalogFilter === 'ready' && repository.available && repository.kind !== 'empty') || (catalogFilter === 'setup' && !repository.available && repository.kind !== 'empty') || (catalogFilter === 'planned' && repository.kind === 'empty');
    return matchesSearch && matchesFilter;
  });
  const target = selected?.targets.find(item => item.key === targetKey);
  const selectionKey = selected && target ? `${selected.id}:${target.key}` : repositoryId;
  const currentSelection = useRef(selectionKey);
  currentSelection.current = selectionKey;
  const selectedPost = posts.find(post => post.id === postId);
  const currentPost = useRef(postId);
  currentPost.current = postId;
  const currentPreview = useRef(preview?.change.id || '');
  currentPreview.current = preview?.change.id || '';
  const currentMediaSession = useRef(mediaSession);
  currentMediaSession.current = mediaSession;

  const loadCatalog = useCallback(async () => {
    const request = ++catalogRequest.current;
    setCatalogLoading(true); setCatalogError('');
    try {
      const result = await api<{ repositories: Repository[]; changes: PreparedChange[] }>('/repositories');
      if (!mounted.current || request !== catalogRequest.current) return;
      setRepositories(result.repositories); setChanges(result.changes);
      setRepositoryId(previous => result.repositories.some(item => item.id === previous) ? previous : result.repositories[0]?.id || '');
    } catch (cause) {
      if (mounted.current && request === catalogRequest.current) setCatalogError(cause instanceof Error ? cause.message : 'Could not load repository connections.');
    } finally { if (mounted.current && request === catalogRequest.current) setCatalogLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void loadCatalog();
    return () => { mounted.current = false; catalogRequest.current++; articleRequest.current++; prepareRequest.current++; previewRequest.current++; testRequest.current++; saveRequest.current++; mediaRequest.current++; };
  }, [loadCatalog]);
  useEffect(() => {
    if (selected && !selected.targets.some(item => item.key === targetKey)) setTargetKey(selected.targets[0]?.key || '');
  }, [selected, targetKey]);
  useEffect(() => {
    const request = ++articleRequest.current;
    if (!selected || !target || selected.kind === 'empty' || !selected.available) { setArticles(emptyArticles); return; }
    const controller = new AbortController();
    const key = `${selected.id}:${target.key}`;
    setArticles({ ...emptyArticles, key, loading: true });
    api<{ articles: Article[]; sourceArticles?: Article[]; sourceHash: string; message: string; head?: string; branch?: string; sourceMode?: 'github' | 'local' }>(`/repositories/${selected.id}/articles?target=${encodeURIComponent(target.key)}`, { signal: controller.signal }).then(result => {
      if (mounted.current && request === articleRequest.current && currentSelection.current === key) {
        setArticles({ key, loading: false, ...result, error: '' });
        if (result.head) setRepositories(previous => previous.map(repository => repository.id === selected.id && repository.head !== result.head ? { ...repository, head: result.head!, branch: result.branch ?? repository.branch, sourceMode: result.sourceMode ?? repository.sourceMode } : repository));
      }
    }).catch(cause => {
      if (!controller.signal.aborted && mounted.current && request === articleRequest.current && currentSelection.current === key) setArticles({ ...emptyArticles, key, error: cause instanceof Error ? cause.message : 'Could not read existing articles.' });
    });
    return () => controller.abort();
  }, [repositoryId, targetKey, selected?.head, selected?.available, reloadArticles]);

  useEffect(() => {
    if (repositoryId !== 'mediasped' || !targetKey) return;
    const controller = new AbortController(), request = ++mediaRequest.current, key = `mediasped:${targetKey}`;
    setMediaStatusLoading(true); setMediaPassword(''); testRequest.current++; setTest(null);
    mediaAccountRequest('session', undefined, controller.signal).then(session => {
      if (!mounted.current || request !== mediaRequest.current || currentSelection.current !== key) return;
      setMediaSession(session); setMediaAuthError('');
      if (session.authenticated && session.admin) {
        setMediaAuthError('');
        setTest({ key, loading: false, result: { configured: true, authenticated: true, admin: true, message: session.message } });
      }
    }).catch(cause => {
      if (!controller.signal.aborted && mounted.current && request === mediaRequest.current && currentSelection.current === key) {
        setMediaSession(null); setMediaAuthError(cause instanceof MediaAccountError ? cause.message : 'Could not check your account connection. Try again or reconnect.');
      }
    }).finally(() => { if (mounted.current && request === mediaRequest.current && currentSelection.current === key) setMediaStatusLoading(false); });
    return () => controller.abort();
  }, [repositoryId, targetKey, mediaStatusRetry]);
  useEffect(() => {
    const session = mediaSession;
    if (!session?.authenticated || !session.expiresAt) return;
    const expires = Date.parse(session.expiresAt);
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      if (!mounted.current || currentMediaSession.current !== session) return;
      const remaining = expires - Date.now();
      if (Number.isFinite(remaining) && remaining > 0) { timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647)); return; }
      setMediaSession({ ...session, authenticated: false, admin: false, message: 'Your account connection expired. Reconnect to continue.' });
      setMediaAuthError('Your Mediašped session expired. Reconnect to continue. Your prepared content is kept.');
      if (currentSelection.current.startsWith('mediasped:')) { testRequest.current++; setTest(null); }
    };
    schedule();
    return () => clearTimeout(timer);
  }, [mediaSession]);

  async function connectMediaAccount(event: FormEvent) {
    event.preventDefault();
    if (busy || mediaStatusLoading || selected?.id !== 'mediasped' || !target) return;
    const request = ++mediaRequest.current, key = selectionKey;
    const credentials = { email: mediaEmail.trim(), password: mediaPassword };
    setMediaPassword(''); setMediaSession(null); setMediaAuthAction('login'); setMediaAuthError(''); setSaveDraftError('');
    testRequest.current++; setTest(null);
    try {
      const session = await mediaAccountRequest('login', credentials);
      if (!mounted.current || request !== mediaRequest.current || currentSelection.current !== key) return;
      setMediaSession(session);
      if (session.authenticated) {
        setTest({ key, loading: false, result: { configured: true, authenticated: true, admin: session.admin, message: session.message } });
        onNotify(session.admin ? 'Mediašped account connected. Administrator access verified.' : 'Account connected. Administrator access is needed to save website drafts.');
      } else setMediaAuthError('Could not connect your account. Check your email and password and try again.');
    } catch (cause) {
      if (mounted.current && request === mediaRequest.current && currentSelection.current === key) setMediaAuthError(cause instanceof MediaAccountError ? cause.message : 'Could not connect your account. Check your email and password and try again.');
    } finally {
      credentials.password = '';
      if (mounted.current && request === mediaRequest.current) { setMediaPassword(''); setMediaAuthAction(null); }
    }
  }
  async function disconnectMediaAccount() {
    if (busy || selected?.id !== 'mediasped') return;
    const request = ++mediaRequest.current, key = selectionKey;
    setMediaAuthAction('logout'); setMediaAuthError(''); setMediaPassword('');
    testRequest.current++; setTest(null);
    try {
      const session = await mediaAccountRequest('logout');
      if (!mounted.current || request !== mediaRequest.current || currentSelection.current !== key) return;
      setMediaSession(session); setMediaStatusLoading(false);
      onNotify('Mediašped account disconnected. Your prepared content is kept.');
    } catch {
      if (mounted.current && request === mediaRequest.current && currentSelection.current === key) { setMediaSession(null); setMediaAuthError('Could not verify that your account disconnected. Reconnect or try again. Your prepared content is kept.'); }
    } finally { if (mounted.current && request === mediaRequest.current) { setMediaPassword(''); setMediaAuthAction(null); } }
  }
  function requireMediaReconnect(message = 'Reconnect your Mediašped account to continue. Your prepared content is kept.') {
    setMediaPassword(''); testRequest.current++; setTest(null);
    setMediaSession(previous => previous ? { ...previous, authenticated: false, admin: false, message: 'Reconnect your account to verify administrator access.' } : null);
    setMediaAuthError(message);
  }

  function selectRepository(repository: Repository) {
    if (busy) return;
    setMediaPassword('');
    setRepositoryId(repository.id); setTargetKey(repository.targets[0]?.key || '');
    setArticles(emptyArticles); setArticleQuery(''); setPrepareError(''); setPreview(null); setPreviewLoading(''); setTest(null); setSaveDraftError('');
    setCategory(''); setArtwork(''); setTakeaway(''); setDirectoryLink(''); setPrimaryKeyword(''); setSeoTitle(''); setImageAlt(''); setSourceSlug(''); setCtaTemplateSlug(''); setImageSourceSlug('google-ocene-vodic-za-podjetja');
    previewRequest.current++; testRequest.current++;
  }
  function selectTarget(key: string) {
    if (busy || key === targetKey) return;
    setMediaPassword('');
    if (selected?.id === 'ocenagor') { setPostId(''); setSeoTitle(''); setImageAlt(''); setSourceSlug(''); setPrimaryKeyword(''); setTakeaway(''); setCategory(''); setArtwork(''); setCtaTemplateSlug(''); setPublishedAt(todayInLjubljana()); }
    setTargetKey(key); setArticles(emptyArticles); setArticleQuery(''); setPrepareError(''); setPreview(null); setPreviewLoading(''); setTest(null); setSaveDraftError('');
    previewRequest.current++; testRequest.current++;
  }
  async function testConnection() {
    if (!selected || !target) return;
    if (selected.id === 'mediasped') setMediaPassword('');
    const key = selectionKey, request = ++testRequest.current;
    setTest({ key, loading: true });
    try {
      const result = await api<ConnectionResult>(`/repositories/${selected.id}/test-connection`, { method: 'POST' });
      if (mounted.current && request === testRequest.current && currentSelection.current === key) {
        setTest({ key, loading: false, result });
        if (selected.id === 'mediasped' && result.authenticated && result.admin) setMediaStatusRetry(previous => previous + 1);
        if (selected.id === 'mediasped' && result.authenticated === false) {
          setMediaSession(previous => previous ? { ...previous, authenticated: false, admin: false, message: 'Reconnect your account to verify administrator access.' } : null);
          setMediaAuthError('Reconnect your Mediašped account to verify access. Your prepared content is kept.');
        }
      }
    } catch (cause) {
      if (mounted.current && request === testRequest.current && currentSelection.current === key) {
        if (selected.id === 'mediasped') requireMediaReconnect('Reconnect your Mediašped account to verify access. Your prepared content is kept.');
        else setTest({ key, loading: false, error: cause instanceof Error ? cause.message : 'Connection could not be verified.' });
      }
    }
  }
  const missingPostFields = selectedPost ? ['title', 'slug', 'excerpt', 'content'].filter(field => !selectedPost[field as 'title' | 'slug' | 'excerpt' | 'content'].trim()) : [];
  const invalidPostText = selectedPost ? [selectedPost.title, selectedPost.excerpt, selectedPost.content].some(value => value.includes('<')) : false;
  const validSlug = selectedPost ? /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selectedPost.slug) : false;
  const currentArticles = articles.key === selectionKey ? articles : emptyArticles;
  const ocenaTranslated = selected?.id === 'ocenagor' && targetKey !== 'si';
  const existingOcenaArticle = selected?.id === 'ocenagor' ? currentArticles.articles.find(article => article.slug === selectedPost?.slug) : undefined;
  const ocenaNewArticle = selected?.id === 'ocenagor' && !!selectedPost && !existingOcenaArticle;
  const ocenaSourceOptions = targetKey === 'si' ? currentArticles.articles : currentArticles.sourceArticles || [];
  const selectedSourceArticle = ocenaSourceOptions.find(article => article.slug === sourceSlug);
  const existingLinkedVersion = selectedSourceArticle?.versions?.find(version => version.targetKey === targetKey);
  const sourcePairConflict = ocenaTranslated && !!selectedPost && !!existingLinkedVersion && existingLinkedVersion.slug !== selectedPost.slug;
  const missingOcenaVersions = ocenaTranslated ? ocenaSourceOptions.filter(article => !article.versions?.some(version => version.targetKey === targetKey)) : [];
  useEffect(() => {
    if (selected?.id !== 'ocenagor') return;
    const existing = currentArticles.articles.find(article => article.slug === selectedPost?.slug);
    setSeoTitle(existing?.seoTitle || selectedPost?.title || '');
    setPrimaryKeyword(existing?.primaryKeyword || '');
    setTakeaway(existing?.takeaway || '');
    setImageAlt(existing?.imageAlt || '');
    setSourceSlug(existing?.sourceSlug || '');
    setCtaTemplateSlug(''); setCategory(''); setArtwork('');
    setPublishedAt(existing ? '' : todayInLjubljana());
  }, [selectionKey, postId, articles]);
  const ocenaNewMetadataComplete = ocenaTranslated
    ? !!(sourceSlug && seoTitle.trim() && primaryKeyword.trim() && takeaway.trim() && imageAlt.trim() && publishedAt && ctaTemplateSlug)
    : !!(category && artwork && publishedAt && seoTitle.trim() && primaryKeyword.trim() && takeaway.trim() && ctaTemplateSlug && imageSourceSlug.trim());
  const metadataComplete = selected?.id === 'logistiscworld' ? !!(category && artwork && takeaway.trim() && publishedAt) : selected?.id === 'onlyworld' ? !!directoryLink : selected?.id === 'ocenagor' ? (ocenaNewArticle ? ocenaNewMetadataComplete : !ocenaTranslated || !!sourceSlug) : true;
  const sourceReady = selected?.kind === 'database' || (!!currentArticles.sourceHash && !currentArticles.loading && !currentArticles.error);
  const canPrepare = !!(!sourcePairConflict && selected?.available && selected.head && target && selectedPost && !missingPostFields.length && !invalidPostText && validSlug && metadataComplete && sourceReady && !busy);
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!canPrepare || !selected || !target || !selectedPost) return;
    const request = ++prepareRequest.current, key = selectionKey, savedPostId = selectedPost.id;
    const ocenaMetadata = {
      ...(seoTitle.trim() ? { seoTitle: seoTitle.trim() } : {}),
      ...(primaryKeyword.trim() ? { primaryKeyword: primaryKeyword.trim() } : {}),
      ...(takeaway.trim() ? { takeaway: takeaway.trim() } : {}),
      ...(imageAlt.trim() ? { imageAlt: imageAlt.trim() } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(ocenaTranslated ? { sourceSlug } : {}),
      ...(ocenaNewArticle ? { ctaTemplateSlug, ...(!ocenaTranslated ? { category, icon: artwork, imageSourceSlug: imageSourceSlug.trim() } : {}) } : {}),
    };
    const metadata = selected.id === 'logistiscworld' ? { category, artwork, takeaway: takeaway.trim(), publishedAt } : selected.id === 'onlyworld' ? { directoryLink } : selected.id === 'ocenagor' ? ocenaMetadata : {};
    previewRequest.current++; setPreviewLoading('');
    setPreparing(true); setPrepareError(''); setSaveDraftError(''); setPreview(null);
    try {
      const result = await api<{ change: PreparedChange; preview: string }>(`/repositories/${selected.id}/prepare`, {
        method: 'POST', body: JSON.stringify({ postId: selectedPost.id, targetKey: target.key, expectedHead: selected.head, ...(selected.kind === 'git-content' ? { expectedSourceHash: currentArticles.sourceHash } : {}), metadata }),
      });
      if (!mounted.current || request !== prepareRequest.current || currentSelection.current !== key || currentPost.current !== savedPostId) return;
      setChanges(previous => [result.change, ...previous.filter(change => change.id !== result.change.id)]);
      setPreview({ change: result.change, text: result.preview });
      onNotify('Change prepared for review. Your websites and repositories are unchanged.');
      requestAnimationFrame(() => previewElement.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }));
    } catch (cause) {
      if (mounted.current && request === prepareRequest.current && currentSelection.current === key) setPrepareError(cause instanceof Error ? cause.message : 'Could not prepare this change.');
    } finally { if (mounted.current && request === prepareRequest.current) setPreparing(false); }
  }
  async function reviewChange(change: PreparedChange) {
    if (busy) return;
    const request = ++previewRequest.current, key = selectionKey;
    setPreviewLoading(change.id); setPrepareError(''); setSaveDraftError('');
    try {
      const response = await fetch(change.downloadUrl);
      if (!response.ok) throw new Error('Could not open this prepared artifact. Refresh the connection and retry.');
      const text = await response.text();
      if (mounted.current && request === previewRequest.current && currentSelection.current === key) {
        setPreview({ change, text });
        requestAnimationFrame(() => previewElement.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }));
      }
    } catch (cause) {
      if (mounted.current && request === previewRequest.current && currentSelection.current === key) setPrepareError(cause instanceof Error ? cause.message : 'Could not load preview.');
    } finally { if (mounted.current && request === previewRequest.current) setPreviewLoading(''); }
  }
  const visibleArticles = currentArticles.articles.filter(article => `${article.title} ${article.slug}`.toLowerCase().includes(articleQuery.toLowerCase()));
  const selectedChanges = changes.filter(change => change.repositoryId === repositoryId);
  const currentTest = test?.key === selectionKey ? test : null;
  const testSuccess = currentTest?.result && (selected?.kind === 'database' ? currentTest.result.authenticated && currentTest.result.admin : currentTest.result.readable);

  const mediaPreview = selected?.id === 'mediasped' && preview?.change.repositoryId === 'mediasped' && preview.change.format === 'database-draft';
  const previewMatchesTarget = mediaPreview && preview?.change.targetKey === target?.key;
  const mediaSessionExpired = !!(mediaSession?.expiresAt && (!Number.isFinite(Date.parse(mediaSession.expiresAt)) || Date.parse(mediaSession.expiresAt) <= Date.now()));
  const adminVerified = !!(currentTest?.result?.authenticated && currentTest.result.admin && !currentTest.loading && (selected?.id !== 'mediasped' || (!mediaStatusLoading && !mediaSessionExpired && mediaSession?.authenticated && mediaSession.admin)));
  const canSaveWebsiteDraft = !!(previewMatchesTarget && adminVerified && !preview?.change.remoteDraftSavedAt && !busy && !previewLoading);
  async function saveWebsiteDraft() {
    if (!canSaveWebsiteDraft || !preview) return;
    const request = ++saveRequest.current, key = selectionKey, changeId = preview.change.id;
    previewRequest.current++; setPreviewLoading('');
    setSavingDraft(true); setSaveDraftError('');
    try {
      const response = await fetch(`/api/repository-changes/${changeId}/save-draft`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
      if (response.status === 401 || response.status === 403) throw new MediaAccountError(response.status, response.status === 401 ? 'Your Mediašped connection expired. Reconnect to save this draft. Your prepared content is kept.' : 'Administrator access could not be verified. Reconnect with an administrator account. Your prepared content is kept.');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save the website draft. Your prepared payload is kept.');
      const result = data as { change: PreparedChange; message: string };
      if (!mounted.current || request !== saveRequest.current || currentSelection.current !== key || currentPreview.current !== changeId) return;
      setChanges(previous => previous.map(change => change.id === result.change.id ? result.change : change));
      setPreview(previous => previous?.change.id === changeId ? { ...previous, change: result.change } : previous);
      onNotify(result.message || 'Website draft saved. It is not published.');
    } catch (cause) {
      if (mounted.current && request === saveRequest.current && currentSelection.current === key && currentPreview.current === changeId) {
        if (cause instanceof MediaAccountError) requireMediaReconnect(cause.message);
        setSaveDraftError(cause instanceof Error ? cause.message : 'Could not save the website draft. Your prepared payload is still available for review.');
      }
    } finally { if (mounted.current && request === saveRequest.current) setSavingDraft(false); }
  }

  return <section className="repositories-page">
    <div className="repo-page-heading"><div><span className="repo-eyebrow">YOUR WEBSITES, UNDER ONE ROOF</span><h1>Repository connections<span>.</span></h1><p>Read your existing content and prepare the next story for review.</p></div><button className="repo-button" disabled={catalogLoading || busy} onClick={() => void loadCatalog()}><RefreshCw size={15} className={catalogLoading ? 'repo-spin' : ''} />Refresh</button></div>
    {!!repositories.length && <div className="repo-catalog-stats" role="group" aria-label="Filter repository connections by setup status">{([
      { key: 'all', label: 'All connections', count: repositories.length, detail: 'Your website catalog', icon: FolderGit2 },
      { key: 'ready', label: 'Source ready', count: sourceReadyCount, detail: 'Readable content source', icon: CheckCircle2 },
      { key: 'setup', label: 'Setup needed', count: setupCount, detail: 'Connect repository source', icon: GitBranch },
      { key: 'planned', label: 'Planned websites', count: plannedCount, detail: 'No content adapter yet', icon: Globe2 },
    ] as const).map(item => <button key={item.key} className={`repo-catalog-stat ${catalogFilter === item.key ? 'repo-stat-selected' : ''}`} aria-pressed={catalogFilter === item.key} disabled={busy} onClick={() => setCatalogFilter(item.key)}><span className="repo-stat-label"><item.icon size={16} />{item.label}</span><strong>{item.count}</strong><small>{item.detail}</small></button>)}</div>}
    <div className="repo-safety-note"><ShieldCheck size={20} /><div><strong>Preparation keeps you in control.</strong><p>Preparing a change saves a review artifact in Blog Machine. Source files, commits, pushes, and deployments stay unchanged. Saving a Mediašped website draft is a separate action below.</p></div></div>
    {catalogError && <div className="repo-error" role="alert"><AlertCircle size={17} /><span>{catalogError}</span><button disabled={busy} onClick={() => void loadCatalog()}>Try again</button></div>}
    {catalogLoading && !repositories.length ? <div className="repo-loading" role="status"><Loader2 size={25} className="repo-spin" /><p>Reading your repository connections…</p></div> : <div className="repo-workspace">
      <aside className="repo-navigation" aria-label="Repository connections"><div className="repo-nav-heading">YOUR REPOSITORIES <span>{visibleRepositories.length} / {repositories.length}</span></div><label className="repo-catalog-search"><Search size={15} /><input aria-label="Search repository connections" disabled={busy} value={catalogQuery} onChange={event => setCatalogQuery(event.target.value)} placeholder="Find a connection…" /></label>{visibleRepositories.map(repository => <button key={repository.id} className={`repo-nav-item ${repository.id === repositoryId ? 'repo-selected' : ''}`} disabled={busy} aria-pressed={repository.id === repositoryId} onClick={() => selectRepository(repository)}><span className={`repo-nav-icon ${repository.kind === 'empty' ? 'repo-empty-icon' : ''}`}><RepositoryIcon kind={repository.kind} /></span><span><strong>{repository.label}</strong><small><span className={`repo-status-dot ${repository.kind === 'empty' ? 'repo-dot-planned' : repository.available ? 'repo-dot-ready' : 'repo-dot-setup'}`} />{repository.kind === 'empty' ? 'Planned website' : repository.available ? 'Source ready' : 'Source unavailable'}</small></span><ChevronRight size={14} /></button>)}{!visibleRepositories.length && <div className="repo-navigation-empty" role="status"><Search size={22} /><strong>No matching connections</strong><p>{catalogFilter === 'ready' && !sourceReadyCount ? 'Connect a website repository to make its source available.' : 'Try another name or setup status.'}</p><button type="button" className="repo-button repo-small-button" onClick={() => { setCatalogQuery(''); setCatalogFilter('all'); }}>Show all connections</button></div>}</aside>
      <div className="repo-detail">
        {selected && <>
          <section className="repo-panel repo-identity"><div className="repo-identity-top"><div><span className="repo-eyebrow">{selected.kind === 'database' ? 'DATABASE DRAFT CONNECTOR' : selected.kind === 'empty' ? 'WEBSITE NOT BUILT YET' : 'GIT CONTENT CONNECTOR'}</span><div className="repo-identity-name"><h2>{selected.label}</h2><span className={`repo-source-status ${selected.kind === 'empty' ? 'repo-status-planned' : selected.available ? 'repo-status-ready' : 'repo-status-setup'}`}><span className="repo-status-dot" />{selected.kind === 'empty' ? 'Planned' : selected.available ? 'Source ready' : 'Setup needed'}</span></div><p>{selected.description}</p></div><a className="repo-github-link" aria-label={`Open ${selected.repository} on GitHub`} href={`https://github.com/${selected.repository}`} target="_blank" rel="noreferrer"><FolderGit2 size={16} /><span>GitHub</span><ArrowRight size={13} /></a></div><div className="repo-identity-facts"><span><Code2 size={13} />{selected.repository}</span>{selected.branch && <span title={selected.branch}><GitBranch size={13} />{selected.branch}</span>}{selected.head && <span title={selected.head}>Commit <code>{selected.head.slice(0, 8)}</code></span>}</div><p className="repo-source-message">{selected.message}</p>{selected.sourceMode && <span className="repo-source-method"><ShieldCheck size={12} />{selected.sourceMode === 'github' ? 'Read-only GitHub source access' : 'Local repository source access'}</span>}
            {selected.id === 'ocenagor' && <div className="repo-family-overview"><div><Languages size={17} /><strong>One content family. Three local audiences.</strong></div><p>Each destination has its own article text, slug, and search metadata.</p><div className="repo-family-destinations" role="group" aria-label="OcenaGor language destinations">{selected.targets.map(destination => <button key={destination.key} type="button" disabled={busy} aria-pressed={destination.key === targetKey} className={destination.key === targetKey ? 'repo-family-active' : ''} onClick={() => selectTarget(destination.key)}><span>{destination.locale.toUpperCase()}</span><strong>{new URL(destination.url).hostname}</strong><small>{languageNames[destination.locale] || destination.locale}{destination.key === 'si' ? ' · source edition' : ' · linked edition'}</small></button>)}</div></div>}
            {!!selected.warnings.length && <details className="repo-connection-notes" open={selected.available}><summary><Info size={15} />Connection notes <span>{selected.warnings.length}</span><ChevronRight size={15} /></summary><div className="repo-warnings"><ul>{selected.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div></details>}
          </section>
          {selected.kind === 'empty' ? <div className="repo-empty-state repo-panel"><FolderGit2 size={35} /><h3>A home for a future website.</h3><p>{selected.deployment}</p><p>No publishing connection is available for this repository yet.</p></div> : !selected.available ? <section className="repo-panel repo-setup-panel" aria-labelledby="repo-setup-title"><span className="repo-setup-emblem"><FolderGit2 size={28} strokeWidth={1.5} /></span><span className="repo-eyebrow">ONE STEP BEFORE YOUR NEXT STORY</span><h3 id="repo-setup-title">{selected.sourceRequiresToken ? 'Connect this private repository' : hostedSource ? 'GitHub source needs attention' : 'Bring this website into your workspace'}</h3><p>{selected.sourceRequiresToken ? `The ${selected.label} connector needs permission to read its private GitHub source. Ask the workspace owner to configure repository read access securely on the server.` : hostedSource ? selected.message : `The ${selected.label} connector is supported. Its checkout needs to be available before you can read source content or prepare a change.`}</p>{selected.sourceRequiresToken ? <ol className="repo-setup-steps"><li><span>1</span><div><strong>Grant repository read access</strong><p>Set <code>BLOGMACHINE_GITHUB_TOKEN</code> in Netlify’s secure server environment. Use a fine-grained GitHub token with Contents: Read permission for <code>{selected.repository}</code> only. This connection does not need permission to publish or push source changes.</p></div></li><li><span>2</span><div><strong>Check source access</strong><p>Refresh after the server configuration is saved. Credentials belong in secure settings, not in an article or a browser form.</p></div></li></ol> : hostedSource ? <ol className="repo-setup-steps"><li><span>1</span><div><strong>Check the existing source connection</strong><p>Use the connection already configured for <code>{selected.repository}</code>. If GitHub reports an authorization problem, verify its repository access and token expiry in secure server settings.</p></div></li><li><span>2</span><div><strong>Refresh when the source is available</strong><p>For a temporary GitHub failure or rate limit, retry after the service recovers. A failed read alone does not mean you need a new credential.</p></div></li></ol> : <ol className="repo-setup-steps"><li><span>1</span><div><strong>Add the existing repository</strong><p>Add <code>{selected.repository}</code> to your cloud environment or restore its existing checkout.</p></div></li><li><span>2</span><div><strong>Keep its expected directory</strong><p>Default location: <code>/workspace/{selected.checkoutDirectory || selected.id}</code>. If your repositories root is configured elsewhere, use that parent directory.</p></div></li><li><span>3</span><div><strong>Refresh this connection</strong><p>Blog Machine checks the repository identity and commit before preparing content.</p></div></li></ol>}<div className="repo-setup-actions"><button className="repo-button repo-primary" disabled={catalogLoading || busy} onClick={() => void loadCatalog()}><RefreshCw size={15} className={catalogLoading ? 'repo-spin' : ''} />{catalogLoading ? 'Checking source…' : hostedSource ? 'Check source access' : 'Check for checkout'}</button><a className="repo-button" href={`https://github.com/${selected.repository}`} target="_blank" rel="noreferrer"><FolderGit2 size={15} />View repository<ArrowRight size={13} /></a></div><p className="repo-setup-footnote"><ShieldCheck size={15} />Repository read access provides source content. Live publishing and database administrator access are separate connections.</p></section> : <>
            {selected.id === 'mediasped' && <section className="repo-panel repo-account-panel" aria-labelledby="media-account-title"><div className="repo-section-title"><div><span className="repo-eyebrow">USE YOUR EXISTING WEBSITE ACCOUNT</span><h3 id="media-account-title">Connect Mediašped</h3><p>Sign in to save unpublished drafts in your website’s existing editor.</p></div><LockKeyhole size={21} /></div>
              {mediaStatusLoading ? <div className="repo-account-loading" role="status"><Loader2 size={17} className="repo-spin" />Checking your account connection…</div> : <>
                {mediaSession && mediaSession.source !== 'none' && <div className={`repo-account-status ${mediaSession.authenticated && mediaSession.admin && !mediaSessionExpired ? 'repo-account-verified' : ''}`} role="status"><UserRound size={19} /><div><strong>{mediaSession.source === 'environment' ? mediaSession.authenticated ? 'Server connection available' : 'Server connection needs attention' : mediaSession.authenticated && !mediaSessionExpired ? mediaSession.admin ? 'Account connected · administrator verified' : 'Account connected · administrator access needed' : 'Reconnect your account'}</strong><p>{mediaSession.message}</p>{mediaSession.expiresAt && Number.isFinite(Date.parse(mediaSession.expiresAt)) && <small>{mediaSessionExpired ? 'Session expired' : `Session expires ${formatDate(mediaSession.expiresAt)}`}</small>}{mediaSession.source === 'environment' && <small>The server connection is separate from your personal account. You can sign in with your own account below.</small>}</div>{mediaSession.source === 'browser' && <button type="button" className="repo-button repo-small-button" disabled={busy} onClick={() => void disconnectMediaAccount()}>{mediaAuthAction === 'logout' ? <Loader2 size={13} className="repo-spin" /> : <LogOut size={13} />}{mediaAuthAction === 'logout' ? 'Disconnecting…' : 'Disconnect account'}</button>}</div>}
                {!(mediaSession?.source === 'browser' && mediaSession.authenticated && !mediaSessionExpired) && <form className="repo-account-form" onSubmit={event => void connectMediaAccount(event)}><div className="repo-form-grid"><label className="repo-field" htmlFor="media-account-email">Email<input id="media-account-email" type="email" name="username" autoComplete="username" required value={mediaEmail} disabled={busy} onChange={event => setMediaEmail(event.target.value)} placeholder="Your Mediašped account email" /></label><label className="repo-field" htmlFor="media-account-password">Password<input id="media-account-password" type="password" name="password" autoComplete="current-password" required value={mediaPassword} disabled={busy} onChange={event => setMediaPassword(event.target.value)} placeholder="Your account password" /></label></div><div className="repo-account-form-actions"><button className="repo-button repo-primary" disabled={busy || mediaStatusLoading || !mediaEmail.trim() || !mediaPassword}>{mediaAuthAction === 'login' ? <Loader2 size={15} className="repo-spin" /> : <LockKeyhole size={15} />}{mediaAuthAction === 'login' ? 'Connecting account…' : 'Connect account'}</button><p>Your password is used for this sign-in request. It is not saved in browser storage.</p></div></form>}
                {mediaSession?.source === 'browser' && mediaSession.authenticated && !mediaSession.admin && <p className="repo-form-note">This account needs administrator access to save website drafts. Disconnect it to sign in with another account.</p>}
              </>}
              {mediaSession?.source === 'none' && !mediaStatusLoading && <p className="repo-account-prompt" role="status">{mediaSession.message}</p>}
              {mediaAuthError && <div className="repo-error repo-account-error" role="alert"><AlertCircle size={16} /><span>{mediaAuthError}</span><button type="button" disabled={busy || mediaStatusLoading} onClick={() => { setMediaPassword(''); setMediaStatusRetry(previous => previous + 1); }}>Check account status</button></div>}
              <p className="repo-account-footnote"><ShieldCheck size={13} />Connecting an account does not publish content or save a website draft.</p>
            </section>}
            <section className="repo-panel repo-target-panel"><div className="repo-section-title"><div><h3>Choose a destination</h3><p>Domain mappings come from the inspected source.</p></div><Globe2 size={20} /></div><label className="repo-field">{selected.id === 'onlyworld' ? 'Country website' : selected.id === 'mediasped' || selected.id === 'ocenagor' ? 'Language destination' : selected.kind === 'database' ? 'Shop' : 'Website'}<select value={targetKey} disabled={busy || !selected.available} onChange={event => selectTarget(event.target.value)}>{selected.targets.map(item => <option key={item.key} value={item.key}>{item.label} · {item.locale}</option>)}</select></label>{target && <div className="repo-target-facts"><span>{target.url}</span><code>{target.contentPath}</code><span className="repo-locale">Content language: {target.locale}</span>{target.sourceLive === false && <strong>Marked pre-launch in source</strong>}</div>}
              <div className="repo-connection-action"><button className="repo-button repo-small-button" disabled={!selected.available || !target || currentTest?.loading || (selected.id === 'mediasped' && mediaStatusLoading) || busy} onClick={() => void testConnection()}>{currentTest?.loading ? <Loader2 size={14} className="repo-spin" /> : <ShieldCheck size={14} />}{selected.kind === 'database' ? 'Test admin access' : selected.sourceMode === 'github' ? 'Check source access' : 'Check local checkout'}</button><small>Read-only check · no content changes</small></div>
              {currentTest && !currentTest.loading && <div className={`repo-test-result ${testSuccess ? 'repo-test-success' : ''}`} role="status">{testSuccess ? <CheckCircle2 size={16} /> : <Info size={16} />}<div><strong>{testSuccess ? selected.kind === 'database' ? 'Admin access verified' : selected.sourceMode === 'github' ? 'GitHub source is readable' : 'Local checkout is readable' : selected.kind === 'database' && currentTest.result?.authenticated ? 'Signed in · admin access not verified' : 'Connection not verified'}</strong><p>{currentTest.result?.message || currentTest.error}</p></div></div>}
            </section>
            <section className="repo-panel repo-articles-panel"><div className="repo-section-title"><div><h3>{selected.kind === 'database' ? 'Existing database articles' : 'Articles in the source'} <span className="repo-count">{currentArticles.articles.length}</span></h3><p>{selected.kind === 'database' ? 'Reading published rows requires server database configuration.' : 'A source article is not proof that its URL is live.'}</p></div><button className="repo-icon-button" aria-label="Reload existing articles" title="Reload existing articles" disabled={currentArticles.loading || busy || !target || !selected.available} onClick={() => setReloadArticles(previous => previous + 1)}><RefreshCw size={15} className={currentArticles.loading ? 'repo-spin' : ''} /></button></div>
              {currentArticles.loading ? <div className="repo-loading repo-loading-small" role="status"><Loader2 className="repo-spin" size={20} /><p>Reading existing articles…</p></div> : currentArticles.error ? <div className="repo-read-error" role="status"><Info size={17} /><div><p>{currentArticles.error}</p>{selected.kind === 'database' && <small>You can still prepare a database draft below. Preparing its JSON payload does not require database credentials.</small>}</div></div> : !selected.available ? <div className="repo-read-error"><Info size={17} /><p>Restore this checkout to read its articles and prepare content.</p></div> : <>
                {(currentArticles.articles.length > 4 || !!articleQuery) && <label className="repo-search-field"><FileText size={14} /><input aria-label="Search source articles" value={articleQuery} onChange={event => setArticleQuery(event.target.value)} placeholder="Search existing articles…" /></label>}
                {visibleArticles.length ? <div className="repo-article-list" tabIndex={0} role="region" aria-label="Existing articles">{visibleArticles.map(article => <article key={article.slug}><FileText size={15} /><div><h4>{article.title}</h4><p>{article.description}</p><span>{article.url}</span>{selected.id === 'ocenagor' && <><div className="repo-language-links" aria-label={`Language versions of ${article.title}`}><Link2 size={12} /><span>Source versions</span>{selected.targets.map(destination => { const version = article.versions?.find(item => item.targetKey === destination.key); return version ? <button key={destination.key} type="button" disabled={busy} className={destination.key === targetKey ? 'repo-version-current' : ''} title={version.title} aria-label={`View ${languageNames[destination.locale] || destination.locale} source version of ${article.title}`} onClick={() => { if (destination.key !== targetKey) selectTarget(destination.key); setArticleQuery(version.slug); }}>{destination.locale.toUpperCase()}<ChevronRight size={11} /></button> : <span key={destination.key} className="repo-version-missing">{destination.locale.toUpperCase()} missing</span>; })}</div><details className="repo-article-seo"><summary>SEO &amp; source details</summary><dl><div><dt>SEO title</dt><dd>{article.seoTitle || 'Not provided by this source'}</dd></div><div><dt>Primary keyword</dt><dd>{article.primaryKeyword || 'Not provided by this source'}</dd></div><div><dt>Cover description</dt><dd>{article.imageAlt || 'Uses the source image registry'}</dd></div><div><dt>Slovenian source</dt><dd>{article.sourceSlug || (targetKey === 'si' ? article.slug : 'No source relationship returned')}</dd></div></dl></details></>}</div></article>)}</div> : <div className="repo-no-articles"><FileText size={23} /><p>{articleQuery ? 'No source articles match your search.' : 'No articles returned for this destination.'}</p></div>}
                {selected.id === 'ocenagor' && ocenaTranslated && !!missingOcenaVersions.length && <details className="repo-missing-versions"><summary><Languages size={15} />{missingOcenaVersions.length} Slovenian source {missingOcenaVersions.length === 1 ? 'article needs' : 'articles need'} a {languageNames[target?.locale || ''] || target?.locale} version</summary><p>Write and save the language version in Posts, then pair it with its Slovenian source below.</p><ul>{missingOcenaVersions.map(article => <li key={article.slug}><strong>{article.title}</strong><code>/{article.slug}</code></li>)}</ul></details>}
                {currentArticles.message && <p className="repo-list-message">{currentArticles.message}</p>}
              </>}
            </section>
            <section className="repo-panel repo-prepare-panel"><div className="repo-section-title"><div><span className="repo-eyebrow">FROM YOUR WRITING DESK</span><h3>Prepare a {selected.kind === 'database' ? 'database draft' : 'source change'}</h3><p>Choose a saved post. Review the result before taking it any further.</p></div><FileCode2 size={22} /></div>
              <form onSubmit={event => void prepare(event)}>{selected.id === 'ocenagor' && <div className="repo-language-writing-note"><Languages size={18} /><p>Choose a saved post written in <strong>{languageNames[target?.locale || ''] || target?.locale}</strong>. Its title, slug, description, and body are used as written. This workflow does not translate text.</p></div>}<label className="repo-field">{selected.id === 'ocenagor' ? `${languageNames[target?.locale || ''] || target?.locale} post` : 'Blog Machine post'}<select required value={postId} disabled={busy} onChange={event => { setPostId(event.target.value); setPrepareError(''); }}><option value="">Choose a saved post</option>{posts.map(post => <option key={post.id} value={post.id}>{post.title} · {post.status}</option>)}</select></label>
                {!posts.length && <p className="repo-form-note">Start by <a href="#posts">creating a post</a> in your writing workspace.</p>}
                {selectedPost && <div className="repo-draft-summary"><strong>{selectedPost.title}</strong><p>{selectedPost.excerpt || 'No short description yet.'}</p><div><span>/{selectedPost.slug || 'slug-missing'}</span><span>{selectedPost.content.trim() ? selectedPost.content.trim().split(/\s+/).length : 0} words</span></div></div>}
                {selectedPost && missingPostFields.includes('excerpt') && <div className="repo-validation-note"><Info size={16} /><p>Add a short description in the post editor before preparing this destination. Descriptions are not generated automatically. <a href="#posts">Open Posts <ArrowRight size={12} /></a></p></div>}
                {selectedPost && (missingPostFields.some(field => field !== 'excerpt') || !validSlug || invalidPostText) && <div className="repo-validation-note"><AlertCircle size={16} /><p>{invalidPostText ? 'Use plain text without HTML or < characters before preparing repository content.' : !validSlug && selectedPost.slug ? 'Use a lowercase slug with words separated by single hyphens.' : 'Add a title, slug, and article content in the post editor first.'}</p></div>}
                {selected.id === 'logistiscworld' && <fieldset className="repo-metadata" disabled={busy}><legend>LogisticsWorld article details</legend><div className="repo-form-grid"><label className="repo-field">Category<select required value={category} onChange={event => setCategory(event.target.value)}><option value="">Choose category</option><option>Slovenia</option><option>Ocean freight</option><option>Planning</option></select></label><label className="repo-field">Artwork<select required value={artwork} onChange={event => setArtwork(event.target.value)}><option value="">Choose artwork</option><option value="port">Port</option><option value="containers">Containers</option><option value="checklist">Checklist</option></select></label></div><label className="repo-field">Publication date<input required type="date" value={publishedAt} onChange={event => setPublishedAt(event.target.value)} /></label><label className="repo-field">Key takeaway<textarea required rows={3} value={takeaway} onChange={event => setTakeaway(event.target.value)} placeholder="What should the reader remember?" /></label><p className="repo-form-note">The date is metadata for the proposed article; it does not schedule a deployment. No source references are generated.</p></fieldset>}
                {selected.id === 'onlyworld' && <fieldset className="repo-metadata" disabled={busy}><legend>Country article details</legend><label className="repo-field">Directory link<select required value={directoryLink} onChange={event => setDirectoryLink(event.target.value)}><option value="">Choose a directory destination</option><option value="/creators">Creators · /creators</option><option value="/cities">Cities · /cities</option><option value="/free">Free creators · /free</option><option value="/best">Best creators · /best</option><option value="/new">New creators · /new</option></select></label><p className="repo-form-note">Write the article in {target?.locale || 'the selected country’s language'} before preparing it. This workflow does not translate your post. Existing city associations are preserved when updating the same slug.</p></fieldset>}
                {selected.id === 'ocenagor' && selectedPost && <>
                  {ocenaTranslated && <fieldset className="repo-metadata" disabled={busy}><legend>Link this language version</legend><label className="repo-field">Slovenian source article<select required value={sourceSlug} disabled={!!existingOcenaArticle || currentArticles.loading || !!currentArticles.error} onChange={event => setSourceSlug(event.target.value)}><option value="">{currentArticles.loading ? 'Loading Slovenian source articles…' : 'Choose the related Slovenian article'}</option>{ocenaSourceOptions.map(article => <option key={article.slug} value={article.slug}>{article.title}{article.versions?.some(version => version.targetKey === targetKey) ? ' · version exists' : ' · no version yet'}</option>)}</select></label>{currentArticles.error && <div className="repo-error" role="alert"><AlertCircle size={16} /><span>{currentArticles.error}</span><button type="button" onClick={() => setReloadArticles(previous => previous + 1)}>Reload source</button></div>}{sourcePairConflict && <div className="repo-validation-note"><Info size={16} /><p>This source already has a {languageNames[target?.locale || ''] || target?.locale} version at <code>/{existingLinkedVersion?.slug}</code>. Use a saved post with that slug to update it; a second language version is not created.</p></div>}{selectedSourceArticle && <div className="repo-source-relationship"><span>Slovenian source</span><strong>{selectedSourceArticle.title}</strong><code>/{selectedSourceArticle.slug}</code><ArrowRight size={17} /><span>{languageNames[target?.locale || ''] || target?.locale} version</span><strong>{selectedPost.title}</strong><code>/{selectedPost.slug}</code></div>}<p className="repo-form-note">The source link keeps language versions together on the website. Shared category, article icon, and cover assets follow the Slovenian source. Existing language versions keep their source pairing.</p></fieldset>}
                  <fieldset className="repo-metadata" disabled={busy}><legend>{languageNames[target?.locale || ''] || target?.locale} search &amp; article details</legend>
                    <label className="repo-field">SEO title<input required={ocenaNewArticle} maxLength={250} value={seoTitle} onChange={event => setSeoTitle(event.target.value)} placeholder="A search title in this destination’s language" /></label>
                    {ocenaTranslated && <p className="repo-form-note">The website adds its domain to this SEO title. Enter the localized title without repeating the domain.</p>}
                    <label className="repo-field">Primary keyword<input required={ocenaNewArticle} maxLength={250} value={primaryKeyword} onChange={event => setPrimaryKeyword(event.target.value)} placeholder="Main search term in this language" /></label>
                    <label className="repo-field">Key takeaway<textarea required={ocenaNewArticle} rows={3} value={takeaway} onChange={event => setTakeaway(event.target.value)} placeholder="What should this audience remember?" /></label>
                    <label className="repo-field">Cover image description{!ocenaTranslated && ' (optional)'}<input required={ocenaTranslated && ocenaNewArticle} value={imageAlt} maxLength={1000} onChange={event => setImageAlt(event.target.value)} placeholder="Describe the existing cover in this language" /></label>
                    <p className="repo-form-note">Existing venue photos retain their approved language-specific descriptions. This field supplies article cover metadata; it does not override a venue photo’s approved description.</p>
                    <label className="repo-field">{ocenaNewArticle ? 'Publication date' : 'Update date (optional)'}<input required={ocenaNewArticle} type="date" value={publishedAt} onChange={event => setPublishedAt(event.target.value)} /></label>
                    <p className="repo-form-note">The saved post’s short description becomes its search description. An update date preserves the original publication date. No indexing or deployment is performed here.</p>
                    {ocenaNewArticle && !ocenaTranslated && <div className="repo-form-grid"><label className="repo-field">Source category<select required value={category} onChange={event => setCategory(event.target.value)}><option value="">Choose category</option>{['Google profil', 'Google ocene', 'NFC komponente', 'Digitalni meni', 'AI telefonist', 'Rezervacije miz', 'Rezervacije terminov', 'Spletne strani'].map(value => <option key={value}>{value}</option>)}</select></label><label className="repo-field">Article icon<select required value={artwork} onChange={event => setArtwork(event.target.value)}><option value="">Choose icon</option><option value="profile">Profile</option><option value="reviews">Reviews</option><option value="nfc">NFC</option><option value="reply">Reply</option></select></label></div>}
                    {ocenaNewArticle && <><label className="repo-field">Approved {languageNames[target?.locale || ''] || target?.locale} CTA template<select required value={ctaTemplateSlug} onChange={event => setCtaTemplateSlug(event.target.value)}><option value="">Choose an existing article’s call to action</option>{currentArticles.articles.map(article => <option key={article.slug} value={article.slug}>{article.title}</option>)}</select></label><p className="repo-form-note">Reuses the selected article’s call to action in this language. Article text is not copied.</p>{!ocenaTranslated && <><label className="repo-field">Approved cover image source<input required value={imageSourceSlug} onChange={event => setImageSourceSlug(event.target.value)} placeholder="Existing Slovenian article slug" /></label><p className="repo-form-note">Reuses an approved image registry entry and its existing assets. No new cover is created.</p></>}</>}
                    {!ocenaNewArticle && <p className="repo-form-note">This updates the existing language version. Its shared category, article icon, cover assets, and call to action are preserved. Leave optional search fields blank to keep their current values.</p>}
                  </fieldset>
                </>}
                {selected.kind === 'database' && <div className="repo-database-note"><Database size={17} /><p>Creates a downloadable JSON payload with <code>{selected.id === 'mediasped' ? 'published: false' : 'status: draft'}</code>. {selected.id === 'mediasped' ? 'Database credentials are needed to read existing posts, verify admin access, and use the separate Save website draft action.' : 'Database credentials are only needed to read existing posts or test admin access.'}</p></div>}
                {selectedPost && currentArticles.articles.some(article => article.slug === selectedPost.slug) && selected.kind === 'git-content' && <div className="repo-validation-note"><Info size={16} /><p>This slug already exists in the source. The prepared patch will update that article.</p></div>}
                {prepareError && <div className="repo-error" role="alert"><AlertCircle size={17} /><span>{prepareError}</span></div>}
                <div className="repo-prepare-actions"><button className="repo-button repo-primary" disabled={!canPrepare}>{preparing ? <Loader2 size={16} className="repo-spin" /> : <FileCode2 size={16} />}{preparing ? 'Preparing change…' : 'Prepare change'}</button><span>{selected.kind === 'database' ? 'JSON draft · no database write' : 'Reviewable patch · no source edits'}</span></div>
                {selected.kind === 'git-content' && !sourceReady && <p className="repo-form-note">Load the current source articles successfully before preparing a patch.</p>}
              </form>
            </section>
          </>}
          {!!selectedChanges.length && <section className="repo-panel repo-history"><div className="repo-section-title"><div><h3>Prepared changes <span className="repo-count">{selectedChanges.length}</span></h3><p>Saved artifacts for this connection. No deployment has been performed.</p></div></div><div>{selectedChanges.map(change => <article key={change.id}><span className="repo-history-icon"><FileCode2 size={17} /></span><div><strong>{change.postTitle}</strong><small>{selected.targets.find(item => item.key === change.targetKey)?.label || change.targetKey} · {formatDate(change.createdAt)}</small><span className="repo-prepared-label">{change.remoteDraftSavedAt ? 'Website draft saved · not published' : 'Prepared for review · not live'}</span></div><button className="repo-button repo-small-button" disabled={!!previewLoading || busy} onClick={() => void reviewChange(change)}>{previewLoading === change.id ? <Loader2 size={13} className="repo-spin" /> : <Eye size={13} />}Review</button><a className="repo-icon-button" href={change.downloadUrl} download aria-label={`Download prepared change for ${change.postTitle}`} title="Download prepared change"><ArrowDownToLine size={16} /></a></article>)}</div></section>}
          {preview && <section className="repo-panel repo-preview" ref={previewElement}><div className="repo-section-title"><div><span className="repo-eyebrow">{preview.change.remoteDraftSavedAt ? 'WEBSITE DRAFT SAVED · NOT PUBLISHED' : 'PREPARED FOR REVIEW · NOT LIVE'}</span><h3>{preview.change.postTitle}</h3><p>{preview.change.relativePath}</p></div><a className="repo-button repo-small-button" href={preview.change.downloadUrl} download><ArrowDownToLine size={14} />Download {preview.change.format === 'git-patch' ? 'patch' : 'JSON'}</a></div><div className="repo-preview-facts"><span>Base commit <code title={preview.change.baseHead}>{preview.change.baseHead.slice(0, 8)}</code></span><span>Expected article URL: {preview.change.articleUrl}</span></div><pre tabIndex={0} aria-label={preview.change.format === 'git-patch' ? 'Prepared patch preview' : 'Prepared database draft preview'}>{preview.text}</pre>{mediaPreview && <div className="repo-save-draft-panel"><div><Database size={20} /><div><strong>{preview.change.remoteDraftSavedAt ? 'Website draft saved · not published' : 'Save to your website’s editor'}</strong><p>{preview.change.remoteDraftSavedAt ? `Saved ${formatDate(preview.change.remoteDraftSavedAt)}. It was saved as an unpublished draft in your existing editor.` : 'This separate action creates an unpublished article in Mediašped’s database. It does not publish the article.'}</p></div></div><button className="repo-button repo-primary" disabled={!canSaveWebsiteDraft} onClick={() => void saveWebsiteDraft()}>{savingDraft ? <Loader2 size={15} className="repo-spin" /> : preview.change.remoteDraftSavedAt ? <CheckCircle2 size={15} /> : <Save size={15} />}{savingDraft ? 'Saving website draft…' : preview.change.remoteDraftSavedAt ? 'Website draft saved' : 'Save website draft'}</button>{!preview.change.remoteDraftSavedAt && !adminVerified && <p className="repo-form-note">Connect your Mediašped account or test administrator access before saving a website draft. Your prepared content is kept.</p>}{!preview.change.remoteDraftSavedAt && !previewMatchesTarget && <p className="repo-form-note">Select this prepared draft’s language destination before saving it.</p>}{saveDraftError && <div className="repo-error" role="alert"><AlertCircle size={16} /><span>{saveDraftError}</span></div>}</div>}<div className="repo-next-step"><ShieldCheck size={18} /><div><strong>Your next step</strong><p>{preview.change.instructions}</p></div></div>{!!preview.change.warnings.length && <div className="repo-warnings"><Info size={16} /><ul>{preview.change.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}</section>}
        </>}
      </div>
    </div>}
  </section>;
}
