import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { api } from '../api';

type Session = { authenticated: boolean; admin: boolean; message: string; expiresAt?: string };
export function TrgovinaConnectionPanel({ onConnection }: { onConnection: (connected: boolean) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [proof, setProof] = useState('');
  const [challenge, setChallenge] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const active = useRef(true);
  const callback = useRef(onConnection); callback.current = onConnection;
  useEffect(() => {
    active.current = true; const controller = new AbortController();
    api<Session>('/connections/trgovina/session', { signal: controller.signal }).then(value => {
      if (!active.current) return;
      setSession(value); callback.current(value.authenticated && value.admin);
    }).catch(() => { if (active.current) setError('Could not check the Trgovina account. Reload this connection.'); })
      .finally(() => { if (active.current) setBusy(false); });
    return () => { active.current = false; controller.abort(); callback.current(false); };
  }, []);
  useEffect(() => {
    if (!session?.expiresAt || !session.authenticated) return;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    const timer = setTimeout(() => { setSession(null); callback.current(false); setError('Your Trgovina session expired. Connect again.'); }, Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [session]);
  async function requestEmail(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setProof(''); callback.current(false);
    try {
      await api('/connections/trgovina/email/start', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      if (active.current) { setChallenge(true); setSession(null); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Could not request sign-in.'); }
    finally { if (active.current) setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); const value = proof; setProof('');
    try {
      const connected = await api<Session>('/connections/trgovina/email/verify', { method: 'POST', body: JSON.stringify({ proof: value }) });
      if (active.current) { setSession(connected); setChallenge(false); callback.current(connected.authenticated && connected.admin); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Could not verify administrator access.'); }
    finally { if (active.current) setBusy(false); }
  }
  async function disconnect() {
    if (busy) return; setBusy(true); setError('');
    try { const value = await api<Session>('/connections/trgovina/logout', { method: 'POST' }); if (active.current) { setSession(value); setChallenge(false); setProof(''); callback.current(false); } }
    catch { if (active.current) setError('Could not confirm the disconnect. Try again.'); }
    finally { if (active.current) setBusy(false); }
  }
  return <section className="repo-panel repo-account-panel" aria-label="Connect Trgovina">
    <div className="repo-section-title"><div><span className="repo-eyebrow">YOUR EXISTING SHOP ACCOUNT</span><h3>Connect Trgovina</h3><p>Verify your administrator account to read the shop blog and save unpublished drafts.</p></div><LockKeyhole size={21} /></div>
    {session?.authenticated && session.admin ? <div className="repo-account-status repo-account-verified" role="status"><ShieldCheck size={18} /><div><strong>Account connected · administrator verified</strong><p>{session.message}</p></div><button className="repo-button" disabled={busy} onClick={() => void disconnect()}>Disconnect account</button></div> : <>
      <form onSubmit={event => void requestEmail(event)}><label className="repo-field">Trgovina account email<input type="email" required autoComplete="username" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label><button className="repo-button" disabled={busy || !email.trim()}>{busy ? 'Checking connection…' : 'Email me a sign-in link'}</button></form>
      {challenge && <form onSubmit={event => void verify(event)}><label className="repo-field">Trgovina email sign-in code or link<input type="password" autoComplete="off" required disabled={busy} value={proof} onChange={event => setProof(event.target.value)} /></label><button className="repo-button repo-primary" disabled={busy || !proof.trim()}>Verify email and connect</button></form>}
    </>}
    {error && <div className="repo-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
    <p className="repo-form-note">Uses an existing account and the shop’s administrator allowlist. Your password stays unchanged. Connecting does not publish or create an article.</p>
  </section>;
}
