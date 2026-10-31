'use client';
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import styles from './monetization.module.css';
type Product = { id: string; title: string | null; merchant: string | null; url: string | null; imageUrl: string | null; videoUrl: string | null; price: string | null; disclosure: string | null };
export function CommissionProducts({ animeId }: { animeId: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    let active = true;
    fetch(`/api/anime/${encodeURIComponent(animeId)}/commission-products`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load commission products.');
        return response.json();
      })
      .then((data) => { if (active) setProducts(Array.isArray(data.products) ? data.products : []); })
      .catch(() => { if (active) setProducts([]); });
    return () => { active = false; };
  }, [animeId]);
  if (!products.length) return null;
  const withMedia = products.filter((product) => Boolean(product.imageUrl || product.videoUrl));
  if (!withMedia.length) return null;
  return (
    <section className={styles.products} aria-labelledby="commission-products-title">
      <header className={styles.productsHead}>
        <p className={styles.productsKicker}>Commission</p>
        <h2 id="commission-products-title" className={styles.productsTitle}>Partner picks</h2>
      </header>
      <div className={styles.productGrid}>
        {withMedia.map((product) => {
          const label = product.title || 'Commission media';
          const media = product.videoUrl ? (
            <video src={product.videoUrl} poster={product.imageUrl || undefined} autoPlay muted loop playsInline aria-label={label} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            product.imageUrl ? <img src={product.imageUrl} alt={label} loading="lazy" /> : null
          );
          return (
            <article className={styles.productCard} key={product.id}>
              <div className={styles.productArt}>{media}</div>
              {(product.title || product.price || product.url) && (
                <div className={styles.productInfo}>
                  {product.title && <strong>{product.title}</strong>}
                  {product.price && <span>{product.price}</span>}
                  {product.url && (
                    <a href={product.url} target="_blank" rel="sponsored noopener noreferrer">
                      <ExternalLink size={14} /> Visit {product.merchant || 'product'}
                    </a>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {withMedia.some((product) => Boolean(product.url)) && <p className={styles.disclosure}>{withMedia.find((product) => product.url)?.disclosure || 'OTAKUVA may earn a commission from qualifying purchases.'}</p>}
    </section>
  );
}
