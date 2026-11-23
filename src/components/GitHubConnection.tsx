import { useEffect, useState, type FormEvent } from 'react';
import { FolderGit2, Loader2, LockKeyhole, LogOut } from 'lucide-react';

export function GitHubConnection({ onChange }: { onChange: () => void }) {
  const [hosted,setHosted]=useState(false), [configured,setConfigured]=useState(false), [editing,setEditing]=useState(false);
  const [token,setToken]=useState(''), [busy,setBusy]=useState(false), [error,setError]=useState('');
  useEffect(()=>{let active=true;fetch('/api/hosting/github',{cache:'no-store'}).then(async response=>{if(!response.ok)return;const value=await response.json();if(active){setHosted(value.hosted===true);setConfigured(value.configured===true);}}).catch(()=>{});return()=>{active=false;};},[]);
  if(!hosted)return null;
  async function connect(event:FormEvent){
    event.preventDefault();if(busy)return;const value=token;setToken('');setBusy(true);setError('');
    try{const response=await fetch('/api/hosting/github',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:value})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not connect GitHub.');setConfigured(true);setEditing(false);onChange();}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not connect GitHub.');}finally{setBusy(false);}
  }
  async function disconnect(){if(busy)return;setBusy(true);setError('');try{const response=await fetch('/api/hosting/github',{method:'DELETE'});if(!response.ok)throw new Error('Could not disconnect GitHub.');setConfigured(false);setToken('');setEditing(false);onChange();}catch(cause){setError(cause instanceof Error?cause.message:'Could not disconnect GitHub.');}finally{setBusy(false);}}
  return <section className="repo-panel repo-account-panel" aria-labelledby="github-connection-title">
    <div className="repo-section-title"><div><span className="repo-eyebrow">PRIVATE REPOSITORY ACCESS</span><h3 id="github-connection-title">{configured?'GitHub connected':'Connect GitHub'}</h3><p>{configured?'Read access is configured. Each website connection checks its own repository access.':'Connect your private repositories to read articles and prepare content changes.'}</p></div><FolderGit2 size={21}/></div>
    {configured&&!editing?<div className="repo-connection-action"><button className="repo-button" disabled={busy} onClick={()=>setEditing(true)}><LockKeyhole size={15}/>Update connection</button><button className="repo-button" disabled={busy} onClick={()=>void disconnect()}><LogOut size={15}/>Disconnect</button></div>:<form onSubmit={event=>void connect(event)}>
      <p>Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">GitHub fine-grained token</a> with <strong>Contents: read-only</strong> for your website repositories. The token is encrypted on the server and never returned to your browser.</p>
      <details><summary>Which repositories to select</summary><p>mediasped-landing-lovable-15, ocenagor-landing-lovable-13, logistiscworld, onlyworld, lumina, trgovina</p></details>
      <label className="repo-field">Personal access token<input type="password" value={token} onChange={event=>setToken(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} required placeholder="github_pat_…"/></label>
      <div className="repo-connection-action"><button className="repo-button" disabled={busy||!token.trim()}>{busy?<Loader2 size={15} className="repo-spin"/>:<LockKeyhole size={15}/>}Connect GitHub</button>{configured&&<button type="button" className="repo-button" disabled={busy} onClick={()=>{setEditing(false);setToken('');}}>Cancel</button>}</div>
    </form>}
    {error&&<p className="repo-error" role="alert">{error}</p>}
  </section>;
}
