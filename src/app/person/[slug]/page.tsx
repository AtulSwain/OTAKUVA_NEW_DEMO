import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CalendarDays, Droplet, ExternalLink, Languages, MapPin, Sparkles, User } from 'lucide-react';
import { ageFrom, formatFuzzyDate, getCreatorProfile } from '../../../lib/people/creatorProfile';
import { SectionHead } from '../../../components/ui/SectionHead';
import { CreatorPhoto } from '../../../components/entity/CreatorPhoto';
import { PeopleRail } from '../../../components/entity/PeopleRail';
import { StudioLogo } from '../../../components/entity/StudioLogo';
import { WorksGrid } from '../../../components/entity/WorksGrid';
import { GenreChips, PosterRow, StatTiles } from '../../../components/entity/EntityBlocks';
import styles from '../../../components/entity/Entity.module.css';
import { ViewBeacon } from '../../../components/analytics/ViewBeacon';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await getCreatorProfile(params.slug);
  // notFound() here (not only in the page): metadata resolves before the
  // loading skeleton streams, so the response is a real 404, not a 200.
  if (!p) notFound();
  const role = p.occupations[0] || p.topRoles[0]?.role;
  const known = p.knownFor.slice(0, 3).map((c) => c.anime.title).join(', ');
  return {
    title: p.name,
    description: [role, known && `Known for ${known}`].filter(Boolean).join(' · ') || `${p.name} on OTAKUVA`,
  };
}

function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Creator page (2026-10-19 redesign) — same design as the studio page and
 * homepage: hero, about, known for, credits over the years, genres, frequent
 * collaborators, studios worked with, every project, voice roles.
 */
export default async function PersonPage({ params }: { params: { slug: string } }) {
  const p = await getCreatorProfile(params.slug);
  if (!p) notFound();

  const born = formatFuzzyDate(p.birthday);
  const died = formatFuzzyDate(p.dateOfDeath);
  const age = ageFrom(p.birthday, p.dateOfDeath);
  const roles = p.occupations.length ? p.occupations : p.topRoles.slice(0, 3).map((r) => r.role);
  const span = p.stats.firstYear && p.stats.latestYear
    ? p.stats.firstYear === p.stats.latestYear ? String(p.stats.firstYear) : `${p.stats.firstYear}–${p.stats.latestYear}`
    : null;
  const links = [
    { label: 'Website', url: safeUrl(p.website) },
    { label: 'AniList', url: p.anilistId ? `https://anilist.co/staff/${p.anilistId}` : null },
    { label: 'MyAnimeList', url: p.malId ? `https://myanimelist.net/people/${p.malId}` : null },
  ].filter((l): l is { label: string; url: string } => Boolean(l.url));
  const stats = [
    ...(p.stats.works > 0 ? [{ value: String(p.stats.works), label: p.stats.works === 1 ? 'anime credited' : 'anime credited' }] : []),
    ...(span ? [{ value: span, label: 'years credited' }] : []),
    ...p.topRoles.slice(0, 2).map((r) => ({ value: String(r.count), label: `as ${r.role}` })),
    ...(p.stats.voiceRoles > 0 ? [{ value: String(p.stats.voiceRoles), label: 'voice roles' }] : []),
    ...(p.favourites ? [{ value: p.favourites.toLocaleString('en-US'), label: 'AniList favourites' }] : []),
  ];

  return (
    <div className={styles.page}>
      <ViewBeacon kind="person" id={p.id} />
      <header className={styles.hero}>
        <div className={styles.heroMedia}>
          <CreatorPhoto src={p.imageUrl} name={p.name} />
        </div>
        <div className={styles.heroText}>
          {roles.length > 0 && (
            <ul className={styles.badges} aria-label="Roles">
              {roles.map((r, i) => (
                <li key={r} className={i === 0 ? styles.badgeAccent : undefined}>{r}</li>
              ))}
            </ul>
          )}
          <h1 className={styles.name}>{p.name}</h1>
          {p.nameKanji && <p className={styles.native} lang="ja">{p.nameKanji}</p>}
          {p.alternativeNames.length > 0 && <p className={styles.native}>Also credited as {p.alternativeNames.slice(0, 4).join(', ')}</p>}
          {(born || died || p.homeTown || p.yearsActive || p.gender || p.bloodType || p.language) && (
            <ul className={styles.facts}>
              {born && (
                <li>
                  <CalendarDays size={14} aria-hidden="true" /> Born <strong>{born}{age !== null && !died ? ` (age ${age})` : ''}</strong>
                </li>
              )}
              {died && (
                <li>
                  Died <strong>{died}{age !== null ? ` (aged ${age})` : ''}</strong>
                </li>
              )}
              {p.homeTown && (
                <li>
                  <MapPin size={14} aria-hidden="true" /> <strong>{p.homeTown}</strong>
                </li>
              )}
              {p.yearsActive && (
                <li>
                  <Sparkles size={14} aria-hidden="true" /> Active <strong>{p.yearsActive}</strong>
                </li>
              )}
              {p.language && (
                <li>
                  <Languages size={14} aria-hidden="true" /> <strong>{p.language}</strong>
                </li>
              )}
              {p.gender && (
                <li>
                  <User size={14} aria-hidden="true" /> <strong>{p.gender}</strong>
                </li>
              )}
              {p.bloodType && (
                <li>
                  <Droplet size={14} aria-hidden="true" /> Blood type <strong>{p.bloodType}</strong>
                </li>
              )}
            </ul>
          )}
          {links.length > 0 && (
            <div className={styles.links}>
              {links.map((l) => (
                <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.label} <ExternalLink size={13} aria-hidden="true" />
                </a>
              ))}
            </div>
          )}
          <StatTiles stats={stats} />
        </div>
      </header>

      {p.about && (
        <section className={styles.section} aria-labelledby="person-about">
          <SectionHead kicker="Profile" title="About" id="person-about" />
          <div className={styles.prose}>
            {p.about.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
          <p className={styles.source}>Profile details from AniList{p.favourites ? ' · favourites count from AniList members' : ''}.</p>
        </section>
      )}

      {p.knownFor.length > 0 && (
        <section className={styles.section} aria-labelledby="person-known">
          <SectionHead kicker="Signature work" title="Known for" id="person-known" />
          <PosterRow
            items={p.knownFor.map((c) => ({
              id: c.anime.id,
              slug: c.anime.slug,
              title: c.anime.title,
              posterUrl: c.anime.posterUrl,
              score: c.anime.score,
              note: c.roles.slice(0, 2).join(' · '),
            }))}
          />
        </section>
      )}

      {p.genres.length > 0 && (
        <section className={styles.section} aria-labelledby="person-genres">
          <SectionHead kicker="Style" title="Genres" id="person-genres" />
          <GenreChips genres={p.genres} />
        </section>
      )}

      {p.collaborators.length > 0 && (
        <section className={styles.section} aria-labelledby="person-collab">
          <SectionHead kicker="Often credited together" title="Frequent collaborators" id="person-collab" href="/artists" linkLabel="All creators" />
          <PeopleRail people={p.collaborators.map((c) => ({ ...c, note: `${c.shared} shared ${c.shared === 1 ? 'work' : 'works'}` }))} />
        </section>
      )}

      {p.studiosWorkedWith.length > 0 && (
        <section className={styles.section} aria-labelledby="person-studios">
          <SectionHead kicker="Production" title="Studios worked with" id="person-studios" href="/studios" linkLabel="All studios" />
          <div className={styles.studioGrid}>
            {p.studiosWorkedWith.map((st) => (
              <Link key={st.id} href={`/studio/${st.slug || st.id}`} className={styles.studioCard}>
                <StudioLogo name={st.name} src={st.logoUrl} size="sm" />
                <span className={styles.studioText}>
                  <strong>{st.name}</strong>
                  <span>
                    {st.works} {st.works === 1 ? 'work' : 'works'} together
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {p.credits.length > 0 && (
        <section className={styles.section} aria-labelledby="person-credits">
          <SectionHead kicker="Filmography" title="Projects" id="person-credits" count={p.credits.length} />
          <WorksGrid
            works={p.credits.map((c) => ({ ...c.anime, tags: c.roles }))}
            filters={p.topRoles.slice(0, 8).map((r) => ({ value: r.role, count: r.count }))}
            filterBy="tags"
            filterLabel="Filter by role"
          />
        </section>
      )}

      {p.voiceRoles.length > 0 && (
        <section className={styles.section} aria-labelledby="person-voice">
          <SectionHead kicker="Cast" title="Voice roles" id="person-voice" count={p.voiceRoles.length} />
          <ul className={styles.voiceGrid}>
            {p.voiceRoles.slice(0, 60).map((v) => (
              <li key={`${v.characterId}-${v.language}`}>
                <Link href={`/character/${v.characterSlug || v.characterId}`} className={styles.voiceCard}>
                  <span className={styles.voiceImg}>
                    {v.characterImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.characterImage} alt="" loading="lazy" decoding="async" />
                    )}
                  </span>
                  <span className={styles.voiceText}>
                    <strong>{v.characterName}</strong>
                    {v.anime && <span>{v.anime.title}</span>}
                    <span>{[v.role, v.language].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {p.voiceRoles.length > 60 && <p className={styles.source}>Showing 60 of {p.voiceRoles.length}.</p>}
        </section>
      )}

      {p.credits.length === 0 && p.voiceRoles.length === 0 && !p.about && (
        <p className={`${styles.note} ${styles.section}`}>No credits or details for {p.name} yet.</p>
      )}
    </div>
  );
}
