'use client';

import React, { useEffect } from 'react';
import { Film, X } from 'lucide-react';
import { trailerEmbedUrl } from '../../lib/media/trailer';
import styles from './TrailerModal.module.css';

interface TrailerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The anime's display title. */
  title: string;
  /** The anime's own recorded trailer link; null/unplayable → "no trailer" message. */
  trailerUrl?: string | null;
}

/**
 * Plays the anime's official trailer inside OTAKUVA (embedded player, no
 * redirect to YouTube). Only the trailer recorded for this anime is played —
 * there's no search-based stand-in, which used to play whatever YouTube
 * returned for the title. Without one, it says so.
 */
export const TrailerModal: React.FC<TrailerModalProps> = ({ isOpen, onClose, title, trailerUrl }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const embedUrl = trailerEmbedUrl(trailerUrl);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label={`${title} trailer`}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{embedUrl ? `${title} — Official Trailer` : title}</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close trailer">
            <X size={18} />
          </button>
        </div>

        {embedUrl ? (
          <div className={styles.videoWrapper}>
            <iframe
              src={embedUrl}
              title={`${title} trailer`}
              className={styles.iframe}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        ) : (
          <div className={styles.empty}>
            <Film size={28} aria-hidden="true" />
            <p className={styles.emptyText}>This anime doesn&apos;t have a trailer.</p>
          </div>
        )}
      </div>
    </div>
  );
};
