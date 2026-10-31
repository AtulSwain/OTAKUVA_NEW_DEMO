'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Plus, Power, Trash2 } from 'lucide-react';
import { Field, FormSection } from '../Pickers';
import { ImageField } from '../ImageField';
import styles from '../control.module.css';

type Ad = { id: string; title: string | null; imageUrl: string | null; videoUrl: string | null; clickUrl: string | null; altText: string | null; placement: string; enabled: boolean };
type Product = { id: string; animeId: string | null; animeTitle: string | null; title: string | null; merchant: string | null; url: string | null; imageUrl: string | null; videoUrl: string | null; price: string | null; enabled: boolean };
type AdDraft = { title: string; imageUrl: string; videoUrl: string; clickUrl: string; altText: string; placement: 'HOME_ABOVE_HYPE' | 'ANIME_PAGE'; videoUrlRequired: boolean; clickUrlRequired: boolean };
type ProductDraft = { title: string; merchant: string; url: string; imageUrl: string; videoUrl: string; price: string; videoUrlRequired: boolean; clickUrlRequired: boolean };
type SubmitMessage = { text: string; code?: string };
const emptyAd: AdDraft = { title: '', imageUrl: '', videoUrl: '', clickUrl: '', altText: '', placement: 'HOME_ABOVE_HYPE', videoUrlRequired: false, clickUrlRequired: false };
const emptyProduct: ProductDraft = { title: '', merchant: 'Amazon', url: '', imageUrl: '', videoUrl: '', price: '', videoUrlRequired: false, clickUrlRequired: false };

export function MonetizationPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [adMsg, setAdMsg] = useState<SubmitMessage | null>(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState('');
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [switches, setSwitches] = useState({ sponsorAdsEnabled: false, commissionsEnabled: false });
  const [ad, setAd] = useState(emptyAd);
  const [product, setProduct] = useState(emptyProduct);
  const [productIssue, setProductIssue] = useState('');
  const sharedProductCount = products.filter((item) => item.animeId === null).length;
  const animeAdCount = ads.filter((item) => item.placement === 'ANIME_PAGE' && item.enabled).length;
  const homeAdCount = ads.filter((item) => item.placement !== 'ANIME_PAGE' && item.enabled).length;
  const animeAdsFull = ad.placement === 'ANIME_PAGE' && animeAdCount >= 20;

  const loadAds = useCallback(async () => {
    setAdsLoading(true); setAdsError('');
    try {
      const response = await fetch('/api/control/sponsor-ads', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load sponsor ads.');
      setAds(data.ads || []);
    } catch (error) {
      setAdsError((error as Error).message);
    } finally { setAdsLoading(false); }
  }, []);
  const loadProducts = useCallback(async () => {
    setProductsLoading(true); setProductsError('');
    try {
      const response = await fetch('/api/control/commission-products', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load products.');
      setProducts(data.products || []);
    } catch (error) { setProducts([]); setProductsError((error as Error).message); }
    finally { setProductsLoading(false); }
  }, []);
  useEffect(() => { void loadAds(); }, [loadAds]);
  useEffect(() => { void loadProducts(); }, [loadProducts]);
  useEffect(() => { fetch('/api/control/monetization-settings').then((r) => r.json()).then((d) => setSwitches(d.settings || { sponsorAdsEnabled: false, commissionsEnabled: false })).catch(() => {}); }, []);

  const setSwitch = async (key: 'sponsorAdsEnabled' | 'commissionsEnabled') => {
    setMsg('');
    try {
      const response = await fetch('/api/control/monetization-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: !switches[key] }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update the ad section.');
      setSwitches(data.settings || { ...switches, [key]: !switches[key] });
    } catch (error) { setMsg((error as Error).message); }
  };
  const createAd = async (draft = ad) => {
    setBusy(true); setAdMsg(null);
    try {
      const response = await fetch('/api/control/sponsor-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAdMsg({ text: data.error || 'Could not publish sponsor ad.', code: data.code });
        return;
      }
      setAdMsg({ text: `Sponsor ad published on the ${draft.placement === 'ANIME_PAGE' ? 'anime pages' : 'homepage'}.` });
      setSwitches((current) => ({ ...current, sponsorAdsEnabled: true }));
      setAd(emptyAd);
      await loadAds();
    } catch (error) {
      setAdMsg({ text: error instanceof Error ? error.message : 'Could not publish sponsor ad.' });
    } finally { setBusy(false); }
  };
  const createProduct = async (draft = product) => {
    setBusy(true); setMsg(''); setProductIssue('');
    try {
      const response = await fetch('/api/control/commission-products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
          setMsg(data.error || 'Could not publish commission media.');
          setProductIssue(typeof data.code === 'string' ? data.code : '');
        return;
      }
      setMsg('Commission media published on anime pages.');
      setProductIssue('');
      setSwitches((current) => ({ ...current, commissionsEnabled: true }));
      setProduct(emptyProduct);
      await loadProducts();
    } catch (error) {
      setProductIssue('');
      setMsg(error instanceof Error ? error.message : 'Could not save product.');
    } finally { setBusy(false); }
  };
  const toggle = async (kind: 'ads' | 'products', item: Ad | Product) => {
    const path = kind === 'ads' ? 'sponsor-ads' : 'commission-products';
    const response = await fetch(`/api/control/${path}/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !item.enabled }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMsg(data.error || 'Could not update this item.'); return; }
    kind === 'ads' ? void loadAds() : void loadProducts();
  };
  const remove = async (kind: 'ads' | 'products', id: string) => {
    const path = kind === 'ads' ? 'sponsor-ads' : 'commission-products';
    const response = await fetch(`/api/control/${path}/${id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMsg(data.error || 'Could not remove this item.'); return; }
    kind === 'ads' ? void loadAds() : void loadProducts();
  };

  return <div className={styles.page}>
    <header className={styles.head}><p className={styles.kicker}>Monetization</p><h1 className={styles.title}>Ads & commissions</h1><p className={styles.caption}>Save and configure to publish; you can disable either section at any time.</p></header>
    <FormSection title="Advertisement and sponsorship" hint="Choose where this ad appears. Add an image, a video, or both; URL requirements are configurable. Ads fill the full width of their section at the image's own shape — wide banners (about 3:1 or 4:1) look best.">
      <div className={styles.fieldWide}>
        <p className={styles.caption}>
          <strong>Home page:</strong> {homeAdCount} enabled — the newest 3 are shown. ·{' '}
          <strong>Anime pages:</strong> {animeAdCount} of 20 enabled — each anime page view shows one, taken in turn, so every ad gets an equal share of views and different visitors see different ads.
        </p>
      </div>
      <div className={styles.enableBar}><div><strong>Platform sponsor ads</strong><span>{switches.sponsorAdsEnabled ? 'Enabled — ads appear at their selected placement.' : 'Disabled — all sponsor ads are hidden.'}</span></div><button type="button" className={switches.sponsorAdsEnabled ? styles.dangerBtn : styles.primary} onClick={() => void setSwitch('sponsorAdsEnabled')}><Power size={15} /> {switches.sponsorAdsEnabled ? 'Disable ads' : 'Enable ads'}</button></div>
      <Field label="Advertisement placement"><select className={styles.selectFull} value={ad.placement} onChange={(e) => { setAd({ ...ad, placement: e.target.value as AdDraft['placement'] }); setAdMsg(null); }}><option value="HOME_ABOVE_HYPE">Home page — below Welcome, above Hype</option><option value="ANIME_PAGE">Anime page</option></select></Field>
      <Field label="Sponsor / campaign title (optional)" wide><input className={styles.input} value={ad.title} onChange={(e) => { setAd({ ...ad, title: e.target.value }); setAdMsg(null); }} placeholder="Leave blank to show only the media" /></Field>
      <div className={styles.fieldWide}><ImageField label="Ad image (optional when using a video)" kind="banner" shape="banner" value={ad.imageUrl} onChange={(url) => { setAd({ ...ad, imageUrl: url }); setAdMsg(null); }} /></div>
      <Field label="Video URL requirement"><select className={styles.selectFull} value={ad.videoUrlRequired ? 'required' : 'optional'} onChange={(e) => { setAd({ ...ad, videoUrlRequired: e.target.value === 'required' }); setAdMsg(null); }}><option value="optional">No video URL required</option><option value="required">Video URL required</option></select></Field>
      <Field label="Video URL (optional)"><input className={styles.input} value={ad.videoUrl} onChange={(e) => { setAd({ ...ad, videoUrl: e.target.value }); setAdMsg(null); }} placeholder="https://…" /></Field>
      <Field label="Click-through URL requirement"><select className={styles.selectFull} value={ad.clickUrlRequired ? 'required' : 'optional'} onChange={(e) => { setAd({ ...ad, clickUrlRequired: e.target.value === 'required' }); setAdMsg(null); }}><option value="optional">No URL required</option><option value="required">URL required</option></select></Field>
      <Field label="Click-through URL"><input className={styles.input} value={ad.clickUrl} onChange={(e) => { setAd({ ...ad, clickUrl: e.target.value }); setAdMsg(null); }} placeholder="https://sponsor.example/…" /></Field>
      <Field label="Accessible description"><input className={styles.input} value={ad.altText} onChange={(e) => setAd({ ...ad, altText: e.target.value })} placeholder="Sponsored message description" /></Field>
      <div className={styles.fieldWide}>
        <button type="button" className={styles.primary} disabled={busy || animeAdsFull} onClick={() => void createAd()}>{busy ? <Loader2 size={15} className={styles.spin} /> : <Plus size={15} />} {animeAdsFull ? 'Anime pages are full (20)' : busy ? 'Preparing and publishing…' : 'Save and configure'}</button>
        <p className={styles.caption}>After saving, the ad and platform sponsor section are enabled together.</p>
        {adMsg && <p className={adMsg.code ? styles.error : styles.okMsg} role={adMsg.code ? 'alert' : 'status'}>{adMsg.text}</p>}
      </div>
    </FormSection>
    <section className={styles.block}><h2 className={styles.blockTitle}>Sponsor ads</h2>{adsError && <p className={styles.error} role="alert">{adsError}</p>}{adsLoading && <p className={styles.caption}>Loading sponsor ads…</p>}{!adsLoading && !adsError && ads.length === 0 && <p className={styles.caption}>No sponsor ads have been added.</p>}<ul className={styles.list}>{ads.map((item) => <li className={styles.userRow} key={item.id}><span className={styles.rowText}><strong>{item.title || 'Untitled sponsor media'}</strong><span>{item.placement === 'ANIME_PAGE' ? 'Anime page' : 'Home page'} · {item.videoUrl ? 'Video' : 'Image'} · {item.enabled ? 'Enabled' : 'Disabled'}</span></span><button className={styles.secondary} type="button" onClick={() => void toggle('ads', item)}><Power size={14} /> {item.enabled ? 'Disable' : 'Enable'}</button><button className={styles.iconBtn} type="button" onClick={() => void remove('ads', item.id)} aria-label="Delete sponsor ad"><Trash2 size={15} /></button></li>)}</ul></section>
    <FormSection title="Anime commission products" hint={`Add up to 10 image or video items to the shared pool (${sharedProductCount} of 10 used). Every anime page view shows 4, taken in turn from the pool, so each item gets an equal share of views. Choose whether a video URL and product URL are required.`}>
      <div className={styles.enableBar}><div><strong>Anime commission section</strong><span>{switches.commissionsEnabled ? 'Enabled — products appear on anime pages.' : 'Disabled — commission products are hidden.'}</span></div><button type="button" className={switches.commissionsEnabled ? styles.dangerBtn : styles.primary} onClick={() => void setSwitch('commissionsEnabled')}><Power size={15} /> {switches.commissionsEnabled ? 'Disable section' : 'Enable section'}</button></div>
      <Field label="Product title (optional)"><input className={styles.input} value={product.title} onChange={(e) => setProduct({ ...product, title: e.target.value })} placeholder="Leave blank to show only the media" /></Field>
      <Field label="Merchant (when using a URL)"><select className={styles.selectFull} value={product.merchant} onChange={(e) => setProduct({ ...product, merchant: e.target.value })}><option>Amazon</option><option>Flipkart</option></select></Field>
      <Field label="Product URL requirement"><select className={styles.selectFull} value={product.clickUrlRequired ? 'required' : 'optional'} onChange={(e) => { setProduct({ ...product, clickUrlRequired: e.target.value === 'required' }); setProductIssue(''); }}><option value="optional">No URL required</option><option value="required">URL required</option></select></Field>
      <Field label="Product URL"><input className={styles.input} value={product.url} onChange={(e) => { setProduct({ ...product, url: e.target.value }); setProductIssue(''); }} placeholder="https://…" /></Field>
      <div className={styles.fieldWide}><ImageField label="Product image (optional when using a video)" kind="poster" shape="square" value={product.imageUrl} onChange={(url) => setProduct({ ...product, imageUrl: url })} /></div>
      <Field label="Video URL requirement"><select className={styles.selectFull} value={product.videoUrlRequired ? 'required' : 'optional'} onChange={(e) => { setProduct({ ...product, videoUrlRequired: e.target.value === 'required' }); setProductIssue(''); }}><option value="optional">No video URL required</option><option value="required">Video URL required</option></select></Field>
      <Field label="Product video URL"><input className={styles.input} value={product.videoUrl} onChange={(e) => { setProduct({ ...product, videoUrl: e.target.value }); setProductIssue(''); }} placeholder="https://…" /></Field>
      <Field label="Price label"><input className={styles.input} value={product.price} onChange={(e) => setProduct({ ...product, price: e.target.value })} placeholder="₹1,299" /></Field>
      <div className={styles.fieldWide}>
        <button type="button" className={styles.primary} disabled={busy || sharedProductCount >= 10} onClick={() => void createProduct()}>{busy ? <Loader2 size={15} className={styles.spin} /> : <Plus size={15} />} {sharedProductCount >= 10 ? 'Pool is full' : busy ? 'Preparing and publishing…' : 'Save and configure'}</button>
        {msg && <p className={productIssue ? styles.error : styles.okMsg} role={productIssue ? 'alert' : 'status'}>{msg}</p>}
      </div>
    </FormSection>
    <section className={styles.block}><div className={styles.sectionToolbar}><h2 className={styles.blockTitle}>Commission pool</h2><button type="button" className={styles.secondary} disabled={productsLoading} onClick={() => void loadProducts()}>{productsLoading ? 'Loading…' : 'Reload products'}</button></div>{productsError && <p className={styles.error}>{productsError}</p>}{!productsLoading && !productsError && products.length === 0 && <p className={styles.caption}>No commission products have been added.</p>}<ul className={styles.list}>{products.map((item) => <li className={styles.userRow} key={item.id}><span className={styles.rowText}><strong>{item.title || 'Untitled commission media'}</strong><span>{item.animeId ? `Pinned to ${item.animeTitle || 'an anime'}` : 'Shared pool'} · {item.enabled ? 'Enabled' : 'Disabled'}</span></span>{item.url ? <a href={item.url} target="_blank" rel="noreferrer" className={styles.inlineLink}><ExternalLink size={14} /> Open</a> : <span className={styles.caption}>No URL required</span>}<button className={styles.secondary} type="button" onClick={() => void toggle('products', item)}>{item.enabled ? 'Disable' : 'Enable'}</button><button className={styles.iconBtn} type="button" onClick={() => void remove('products', item.id)} aria-label="Delete product"><Trash2 size={15} /></button></li>)}</ul></section>
  </div>;
}
