'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { ArrowRight, Check, ChevronRight, CircleStop, Clipboard, Code2, Copy, ExternalLink, Globe2, Monitor, Radio, ShieldCheck, Terminal, X } from 'lucide-react';
import type { DesktopSnapshot, TargetApiResponse, TunnelStatus } from '../shared/types';
import { Brand } from '../components/Brand';

const fallback: DesktopSnapshot = { tunnel: { state: 'idle' }, activity: [], cloudflared: { available: false } };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store' });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

export default function Home() {
  const [workspace, setWorkspace] = useState(false);
  const [snapshot, setSnapshot] = useState<DesktopSnapshot>(fallback);
  const [target, setTarget] = useState('http://localhost:5173');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    let mounted = true;
    api<DesktopSnapshot>('/api/snapshot')
      .then((next) => { if (mounted) setSnapshot(next); })
      .catch((error) => { if (mounted) setMessage(error instanceof Error ? error.message : 'Unable to read service status.'); });
    return () => { mounted = false; };
  }, []);

  const start = async () => {
    setMessage(''); setBusy(true);
    try {
      const validation = await api<TargetApiResponse>('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target }) });
      if (!validation.ok) throw new Error(validation.error);
      const tunnel = await api<TunnelStatus>('/api/session/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: validation.target.url }) });
      setSnapshot((current) => ({ ...current, tunnel }));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to start sharing.'); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    setMessage(''); setBusy(true);
    try {
      const tunnel = await api<TunnelStatus>('/api/session/stop', { method: 'POST' });
      setSnapshot((current) => ({ ...current, tunnel }));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to stop sharing.'); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!snapshot.tunnel.url) return;
    try { await navigator.clipboard.writeText(snapshot.tunnel.url); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setMessage('Could not copy the link. Select it and copy manually.'); }
  };

  if (workspace) return <WorkspaceRefined target={target} setTarget={setTarget} snapshot={snapshot} message={message} busy={busy} consent={consent} setConsent={setConsent} start={start} stop={stop} copy={copy} copied={copied} close={() => setWorkspace(false)} />;
  return <main className="landing">
    <nav className="nav"><a className="brand" href="#top"><Brand /></a><div className="nav-links"><a href="#product">Product</a><a href="#how">How it works</a><a href="#security">Safety</a></div><div className="nav-actions"><button className="pill small" onClick={() => setWorkspace(true)}>Get Started <ArrowRight size={16} /></button></div></nav>
    <section className="hero" id="top"><div className="hero-copy"><p className="eyebrow"><span className="pulse" /> LOCAL DEVELOPMENT, UNBOUND</p><h1>Your localhost.<br /><em>Out in the world.</em></h1><p className="lede">Share a live link to the app running on your machine.<br />No deployment. No setup. Just a link.</p><div className="hero-ctas"><button className="pill" onClick={() => setWorkspace(true)}>Get Started <ArrowRight size={18} /></button><a className="text-link" href="#how">See how it works <ArrowRight size={16} /></a></div><p className="trust"><span className="dot" /> Local-first sharing with your explicit consent.</p></div><Preview /></section>
     <section className="section how-section" id="how"><div className="section-intro"><div><p className="eyebrow">HOW IT WORKS</p><h2>From local to live<br /><em>in a few clicks.</em></h2></div><p className="section-kicker">A short path from your machine<br />to someone else&apos;s screen.</p></div><div className="how-layout"><div className="steps"><Step n="01" icon={<Monitor />} title="Pick your app" text="Point Yerel at a local URL. Your machine stays the source of truth." /><Step n="02" icon={<ShieldCheck />} title="Open a tunnel" text="A temporary tunnel carries only the service you explicitly select." /><Step n="03" icon={<Globe2 />} title="Share the link" text="Copy a temporary HTTPS link. Stop sharing whenever you are done." /></div><div className="illustration-frame landscape-frame"><Image src="/illustration-2.png" alt="Illustrated mountain valley with a winding path" width={1644} height={913} sizes="(max-width: 1050px) 100vw, 42vw" /></div></div></section>
     <section className="feature-band product-section" id="product"><div className="illustration-frame meadow-frame"><Image src="/illustration-1.png" alt="Illustrated evergreen meadow under layered clouds" width={1070} height={806} sizes="(max-width: 1050px) 100vw, 38vw" /><span className="frame-caption">02 / KEEP IT LOCAL</span></div><div className="product-copy"><p className="eyebrow">A SMALL TOOL WITH A CLEAR JOB</p><h2>Built for the moment<br />before <em>deployment.</em></h2><div className="feature-list"><Feature icon={<Radio />} title="Real-time status" text="See when your tunnel is starting, live, or has stopped." /><Feature icon={<Code2 />} title="Developer-first" text="URL validation, safe process handling, and useful diagnostics." /><Feature icon={<Terminal />} title="Nothing to host" text="The app, tunnel, and data stay on your machine." /></div></div></section>
     <section className="section security security-section" id="security"><div className="security-card"><div className="security-copy"><ShieldCheck size={28} /><div><p className="eyebrow">SHARE WITH INTENTION</p><h2>Your local service is public<br /><em>only while you say so.</em></h2><p>Yerel does not scan or expose every port. You select one target, confirm the action, and get a clear stop control. A temporary URL is not authentication—keep development data and private endpoints in mind.</p></div></div><div className="illustration-frame road-frame"><Image src="/illustration-3.png" alt="Illustrated road leading through a green countryside" width={500} height={333} sizes="(max-width: 1050px) 100vw, 30vw" /><span className="frame-caption">03 / KEEP MOVING</span></div></div></section>
    <footer id="footer"><a className="brand" href="#top"><Brand /></a><span>Local, by design.</span><button className="footer-start" onClick={() => setWorkspace(true)}>Open the workspace <ArrowRight size={15} /></button></footer>
  </main>;
}

function Preview() { return <div className="preview-wrap"><div className="preview"><div className="preview-top"><div className="app-icon"><Code2 /></div><div className="app-name"><strong>your-app</strong><span>Next.js · localhost:3000</span></div><span className="live"><i /> PREVIEW</span><button disabled className="copy" title="Connect a service in the workspace"><Copy size={17} /> Copy link</button></div><div className="flow"><Flow icon={<Monitor />} title="localhost:3000" sub="Your machine" /><ChevronRight /><Flow icon={<ShieldCheck />} title="temporary tunnel" sub="Encrypted connection" /><ChevronRight /><Flow icon={<Globe2 />} title="HTTPS link" sub="Share when ready" /></div></div><p className="preview-note">Illustrative preview. Connect a real service in the workspace to create an actual URL.</p></div>; }
function Flow({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) { return <div className="flow-item"><span className="flow-icon">{icon}</span><span><b>{title}</b><small>{sub}</small></span></div>; }
function Step({ n, icon, title, text }: { n: string; icon: ReactNode; title: string; text: string }) { return <article className="step"><span className="step-number">{n}</span><div className="step-icon">{icon}</div><h3>{title}</h3><p>{text}</p></article>; }
function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="feature"><span>{icon}</span><div><h3>{title}</h3><p>{text}</p></div></div>; }

function Workspace({ target, setTarget, snapshot, message, busy, consent, setConsent, start, stop, copy, copied, close }: { target: string; setTarget: (v: string) => void; snapshot: DesktopSnapshot; message: string; busy: boolean; consent: boolean; setConsent: (v: boolean) => void; start: () => void; stop: () => void; copy: () => void; copied: boolean; close: () => void }) {
  const t = snapshot.tunnel; const active = t.state === 'active'; const transitional = t.state === 'starting' || t.state === 'stopping' || t.state === 'validating'; const inputDisabled = busy || transitional || active; const actionDisabled = busy || transitional || (!active && (!target.trim() || !consent));
  return <main className="workspace"><header className="workspace-head"><a className="brand" href="#" onClick={(e) => { e.preventDefault(); close(); }}><Brand /></a><span className="workspace-label">WORKSPACE</span><button className="icon-button" onClick={close} aria-label="Close workspace"><X /></button></header><div className="workspace-grid"><aside><p className="eyebrow">WORKSPACE</p><div className="side-nav"><span className="selected"><Radio size={17} /> Overview</span><span className="disabled-nav"><Code2 size={17} /> Projects <small>Not available</small></span><span className="disabled-nav"><Globe2 size={17} /> Live sessions <small>Not available</small></span><span className="disabled-nav"><Terminal size={17} /> Activity <small>Below</small></span></div><div className="side-foot"><p className="eyebrow">ENGINE</p><span className="engine-state"><i /> {snapshot.cloudflared.available ? 'Ready when you are' : 'cloudflared not detected'}</span><small>{snapshot.cloudflared.available ? 'Cloudflare tunnel engine available.' : 'Install cloudflared and add it to PATH.'}</small></div></aside><section className="dashboard"><div className="dash-intro"><div><p className="eyebrow">OVERVIEW</p><h1>Share something<br /><em>worth seeing.</em></h1><p>Select a local HTTP service and create a temporary public HTTPS link.</p></div><div className="status-chip"><i className={active ? 'green' : ''} />{t.state === 'active' ? 'LIVE' : t.state === 'idle' ? 'IDLE' : t.state.toUpperCase()}</div></div><div className="share-card"><div className="card-title"><span className="card-icon"><Monitor /></span><div><h2>New share</h2><p>Direct single-service tunnel</p></div></div><label htmlFor="target">LOCAL SERVICE URL</label><div className="url-row"><input id="target" value={target} onChange={(e) => setTarget(e.target.value)} disabled={inputDisabled} placeholder="http://localhost:5173" /><button className="pill" onClick={active ? stop : start} disabled={actionDisabled}>{busy ? 'Working…' : active ? <><CircleStop size={17} /> Stop sharing</> : <>Start sharing <ArrowRight size={17} /></>}</button></div><label className="consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={inputDisabled} /><span>I understand this makes my selected local service publicly reachable.</span></label>{message && <p className="error-message" role="alert">{message}</p>}{t.error && <p className="error-message" role="alert">{t.error}</p>}{t.url && <div className="live-link"><div><span className="eyebrow">PUBLIC URL</span><a href={t.url} target="_blank" rel="noreferrer">{t.url}</a></div><div className="link-actions"><button className="copy" onClick={copy}>{copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}</button><a className="copy" href={t.url} target="_blank" rel="noreferrer">Open <ArrowRight size={15} /></a></div></div>}</div><div className="activity-card"><div className="card-title"><span className="card-icon"><Radio /></span><div><h2>Recent activity</h2><p>Session events from this workspace</p></div></div>{snapshot.activity.length ? <div className="activity-list">{snapshot.activity.slice(0, 5).map((event) => <div className="activity-item" key={event.id}><i className={event.level} /><span>{event.message}</span><small>{new Date(event.at).toLocaleTimeString()}</small></div>)}</div> : <p className="empty-state">No activity yet. Start a share when you are ready.</p>}</div></section></div></main>;
}

function WorkspaceRefined({ target, setTarget, snapshot, message, busy, consent, setConsent, start, stop, copy, copied, close }: { target: string; setTarget: (v: string) => void; snapshot: DesktopSnapshot; message: string; busy: boolean; consent: boolean; setConsent: (v: boolean) => void; start: () => void; stop: () => void; copy: () => void; copied: boolean; close: () => void }) {
  const tunnel = snapshot.tunnel;
  const active = tunnel.state === 'active' && Boolean(tunnel.url);
  const transitional = tunnel.state === 'starting' || tunnel.state === 'stopping' || tunnel.state === 'validating';
  const engineReady = snapshot.cloudflared.available;
  const inputDisabled = busy || transitional || active;
  const actionDisabled = busy || transitional || (!active && (!target.trim() || !consent));
  const engineLabel = active ? 'Tunnel active' : engineReady ? 'Engine ready' : 'Engine unavailable';
  const engineClass = active || engineReady ? 'ready' : 'unavailable';
  return <main className="workspace">
    <header className="workspace-head"><a className="brand" href="#" onClick={(event) => { event.preventDefault(); close(); }}><Brand /></a><span className="workspace-label">WORKSPACE</span><div className={`engine-indicator ${engineClass}`}><i /> <span>{engineLabel}</span>{active && <small>engine ready</small>}</div><button className="icon-button" onClick={close} aria-label="Close workspace"><X /></button></header>
    <section className="workspace-main"><div className="workspace-content">
      <div className="dash-intro"><div><p className="eyebrow">OVERVIEW</p><h1>Share something<br /><em>worth seeing.</em></h1><p>Select one local HTTP service and create a temporary public HTTPS link.</p></div><div className={`status-chip ${active ? 'status-live' : ''}`}><i className={active ? 'green' : ''} />{active ? 'LIVE' : tunnel.state === 'idle' ? 'IDLE' : tunnel.state.toUpperCase()}</div></div>
      <div className={`share-card ${active ? 'share-card-active' : ''}`}>
        <div className="card-title"><span className="card-icon"><Monitor /></span><div><h2>{active ? 'Share is live' : 'New share'}</h2><p>{active ? 'Your selected local service is reachable through the tunnel.' : 'Direct single-service tunnel'}</p></div></div>
        {!active ? <><label htmlFor="target">LOCAL SERVICE URL</label><div className="url-row"><input id="target" value={target} onChange={(event) => setTarget(event.target.value)} disabled={inputDisabled} placeholder="http://localhost:5173" /><button className="pill share-action" onClick={start} disabled={actionDisabled}>{busy ? 'Working…' : <>Start sharing <ArrowRight size={17} /></>}</button></div><label className="consent-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy || transitional} /><span>I understand this URL will be public while sharing is active.</span></label></> : <div className="active-share-row"><div className="public-url-field"><span className="field-eyebrow">PUBLIC URL</span><a href={tunnel.url} target="_blank" rel="noreferrer" title={tunnel.url}>{tunnel.url}</a></div><div className="share-actions"><button className="compact-button" onClick={copy}><Clipboard size={16} />{copied ? 'Copied' : 'Copy'}</button><a className="compact-button" href={tunnel.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open</a><button className="compact-button stop-button" onClick={stop} disabled={busy}><CircleStop size={16} /> Stop sharing</button></div></div>}
        {message && <p className="workspace-error">{message}</p>}
        {!active && <p className="safety"><ShieldCheck size={15} /> Only this explicitly selected target will be exposed.</p>}
      </div>
      <div className="activity"><div className="activity-head"><h2>Activity</h2><span>{snapshot.activity.length} events</span></div>{snapshot.activity.length === 0 ? <div className="empty"><Radio size={20} /><p>No activity yet.<br /><small>Your share events will appear here.</small></p></div> : snapshot.activity.slice(0, 5).map((event) => <div className="event" key={event.id}><i className={event.level} /><span>{event.message}<small>{event.detail || new Date(event.at).toLocaleTimeString()}</small></span></div>)}</div>
    </div></section>
  </main>;
}
