'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { ArrowRight, Check, CircleStop, Code2, Copy, ExternalLink, Globe2, Monitor, Radio, RefreshCw, ShieldCheck, Terminal, X, ChevronRight } from 'lucide-react';
import { Brand } from '../components/Brand';
import { type CompanionResponse, type CompanionStatus, type FrontendPhase } from '../shared/frontend-state';
import { CompanionRequestError, createFrontendController, type FrontendController } from '../shared/frontend-controller';

const COMPANION_ORIGIN = 'http://127.0.0.1:3847';
const GITHUB_SETUP_URL = 'https://github.com/Rudrakshbhardwaj01/Yerel';
function companionError(error: unknown) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) return 'Unable to reach the local companion. Start it with “npm run cli”, then click Refresh.';
  return error instanceof Error ? error.message : 'Unable to reach the local companion.';
}
async function companionRequest<T>(path: string, token: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7000);
  try {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (token.trim()) headers.set('authorization', `Bearer ${token.trim()}`);
    // 127.0.0.1 is already classified as loopback by Chromium. Do not set
    // targetAddressSpace: "local": current specifications distinguish
    // loopback from local, and a mismatched explicit hint can fail.
    const response = await fetch(`${COMPANION_ORIGIN}${path}`, { ...init, headers, cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
    const text = await response.text();
    let body: T & { error?: string } = {} as T & { error?: string };
    if (text) { try { body = JSON.parse(text) as T & { error?: string }; } catch { throw new CompanionRequestError(`Companion returned invalid JSON (${response.status}).`, response.status === 401 || response.status === 403 ? 'auth' : 'invalid-response', response.status); } }
    if (!response.ok) throw new CompanionRequestError(body.error || (response.status === 401 || response.status === 403 ? 'Enter the pairing token from your companion.' : `Companion request failed (${response.status}).`), response.status === 401 || response.status === 403 ? 'auth' : 'http', response.status);
    return body;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new CompanionRequestError('The companion did not respond in time. Checking its status; the operation may still finish.', 'timeout');
    throw error;
  } finally { window.clearTimeout(timer); }
}

export default function Home() {
  const [workspace, setWorkspace] = useState(false);
  if (workspace) return <Workspace close={() => setWorkspace(false)} />;
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

function Workspace({ close }: { close: () => void }) {
  const [target, setTarget] = useState('http://127.0.0.1:5173');
  const [token, setToken] = useState('');
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<FrontendPhase>('disconnected');
  const [status, setStatus] = useState<CompanionStatus>({});
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const controller = useRef<FrontendController>();
  useEffect(() => {
    setStatus({}); setMessage(''); setPhase('disconnected'); setCopied(false);
    const current = createFrontendController({
      request: (path, init) => companionRequest<CompanionResponse>(path, token, init),
      onStatus: (next, nextPhase) => { setStatus(next); setPhase(nextPhase); setMessage(''); },
      onError: (error, nextPhase) => { setMessage(companionError(error)); setPhase(nextPhase); },
    });
    controller.current = current;
    void current.refresh();
    return () => { current.dispose(); controller.current = undefined; };
  }, [token]);
  const refresh = () => controller.current?.refresh();
  const start = () => {
    if (!target.trim() || !consent) return;
    return controller.current?.start(target);
  };
  const stop = () => {
    if (!status.id) { setMessage('The companion did not provide a tunnel id. Refresh and try again.'); return; }
    return controller.current?.stop(status.id);
  };
  const active = phase === 'active' && Boolean(status.url); const transitional = phase === 'validating' || phase === 'starting' || phase === 'stopping';
  const copy = async () => { if (!status.url) return; try { await navigator.clipboard.writeText(status.url); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setMessage('Could not copy the link. Select it and copy manually.'); } };
  return <main className="workspace"><header className="workspace-head"><a className="brand" href="#" onClick={(event) => { event.preventDefault(); close(); }}><Brand /></a><span className="workspace-label">WORKSPACE</span><div className={`engine-indicator ${phase === 'disconnected' ? 'unavailable' : 'ready'}`}><i /> {phase.toUpperCase()}</div><button className="icon-button" onClick={close} aria-label="Close workspace"><X /></button></header><section className="workspace-main"><div className="workspace-content">
    <div className="dash-intro"><div><p className="eyebrow">COMPANION WORKSPACE</p><h1>Share something<br /><em>worth seeing.</em></h1><p>Create a temporary public HTTPS link through the companion running on this machine.</p></div><div className="workspace-heading-actions"><button className="compact-button refresh-button" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</button><a className="compact-button" href={`${GITHUB_SETUP_URL}#quick-start`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" /> Setup guide</a></div></div>
    <div className={`share-card ${active ? 'share-card-active' : ''}`}><div className="card-title"><span className="card-icon"><Monitor /></span><div><h2>{active ? 'Share is live' : 'New share'}</h2><p>{active ? 'Your selected local service is reachable through the tunnel.' : 'Direct single-service tunnel'}</p></div></div>
     {!active ? <><label htmlFor="target">LOCAL SERVICE URL</label><div className="url-row"><input id="target" value={target} onChange={(event) => setTarget(event.target.value)} disabled={transitional} placeholder="http://127.0.0.1:5173" /><button className="pill share-action" onClick={() => void start()} disabled={transitional || !target.trim() || !consent || !token.trim() || phase === 'disconnected'}>{phase === 'validating' ? 'Validating…' : phase === 'starting' ? 'Starting…' : 'Start sharing'} <ArrowRight size={17} /></button></div><label className="consent-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={transitional} /><span>I understand this makes my selected local service publicly reachable.</span></label><label className="token-label" htmlFor="token">PAIRING TOKEN <span>Required — copy it from the companion terminal</span></label><input className="token-input" id="token" type="password" value={token} onChange={(event) => setToken(event.target.value)} disabled={transitional} placeholder="Paste the token shown by the companion" /></> : <div className="active-share-row"><div className="public-url-field"><span className="field-eyebrow">PUBLIC URL</span><a href={status.url} target="_blank" rel="noreferrer" title={status.url}>{status.url}</a></div><div className="share-actions"><button className="compact-button" onClick={() => void copy()}><Copy size={16} />{copied ? <><Check size={16} /> Copied</> : 'Copy link'}</button><a className="compact-button" href={status.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open</a><button className="compact-button stop-button" onClick={() => void stop()} disabled={transitional}><CircleStop size={16} /> Stop sharing</button></div></div>}
      {message && <p className="workspace-error" role="alert">{message}</p>}{phase === 'setup' && <p className="setup-hint">Pair the companion with its token, or start it locally using the <a href={GITHUB_SETUP_URL} target="_blank" rel="noreferrer">GitHub setup guide</a>.</p>}<p className="safety"><ShieldCheck size={15} /> Only this explicitly selected target will be exposed.</p>
    </div><div className="activity"><div className="activity-head"><h2>Companion status</h2><span>{phase}</span></div><div className="empty"><Radio size={20} /><p>{status.error || (phase === 'disconnected' ? 'Start the local companion, then refresh this workspace.' : phase === 'setup' ? 'The companion is running and ready for pairing.' : active ? 'Your public link is active.' : 'No active share yet.')}</p></div></div>
  </div></section></main>;
}
