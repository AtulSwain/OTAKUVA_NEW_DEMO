import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { fetchDanbooruArtistAbout } from '../../../../lib/providers/danbooruProvider';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params;
    const normalizedName = decodeURIComponent(slug).replace(/-/g, ' ').trim();

    const producer = await prisma.producer.findFirst({
      where: {
        OR: [
          { slug },
          { id: slug },
          { name: slug },
          { name: { contains: normalizedName, mode: 'insensitive' } },
        ],
      },
      include: {
        animeProducers: {
          include: {
            anime: {
              include: {
                titles: true,
                animeGenres: { include: { genre: true } },
              },
            },
          },
        },
      },
    });

    if (!producer) {
      return NextResponse.json({ error: 'Producer not found' }, { status: 404 });
    }

    const animes = producer.animeProducers.map((ap) => ({
      id: ap.anime.id,
      slug: ap.anime.slug,
      title: ap.anime.canonicalTitle,
      englishTitle: ap.anime.titles.find((t) => t.type === 'english')?.title || null,
      posterImage: ap.anime.posterUrl,
      posterUrl: ap.anime.posterUrl,
      score: ap.anime.score,
      episodes: ap.anime.episodes,
      type: ap.anime.type,
      status: ap.anime.status,
      year: ap.anime.year || ap.anime.startYear,
      genres: ap.anime.animeGenres.map((ag) => ag.genre.name),
    }));

    const popularWorks = [...animes].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6);
    const recentWorks = [...animes].sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, 6);

    let about = producer.about;
    let artistWiki = null;
    try {
      const booruInfo = await fetchDanbooruArtistAbout(producer.name);
      if (booruInfo) {
        artistWiki = booruInfo;
        if (!about && booruInfo.wikiBody) {
          about = booruInfo.wikiBody;
        }
      }
    } catch (e) {
      // Non-blocking
    }

    return NextResponse.json({
      producer: {
        id: producer.id,
        name: producer.name,
        slug: producer.slug || producer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        about,
        artistWiki,
        website: producer.website,
        imageUrl: producer.imageUrl,
        totalWorks: animes.length,
        animes,
        popularWorks,
        recentWorks,
      },
    });
  } catch (error: any) {
    console.error('Error fetching producer details:', error);
    return NextResponse.json({ error: 'Failed to fetch producer' }, { status: 500 });
  }
}
