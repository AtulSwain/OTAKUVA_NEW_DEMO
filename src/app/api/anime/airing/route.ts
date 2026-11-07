import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { getAnimeDisplayTitle } from '../../../../lib/animeTitleResolver';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const day = searchParams.get('day'); // "MONDAY", "TUESDAY", etc.
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(50, parseInt(searchParams.get('limit') || '30', 10));
    const skip = (page - 1) * limit;

    const where: any = {
      status: { in: ['Airing', 'AIRING', 'Currently Airing', 'CURRENTLY_AIRING'] },
    };

    if (day && day !== 'All') {
      where.broadcastDay = { contains: day, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      prisma.anime.findMany({
        where,
        orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { popularity: 'asc' }],
        skip,
        take: limit,
        include: {
          animeGenres: { include: { genre: true } },
          animeStudios: { include: { studio: true } },
          titles: true,
        },
      }),
      prisma.anime.count({ where }),
    ]);

    const mapped = items.map((a) => {
      const displayTitle = getAnimeDisplayTitle(a);
      const enTitle = a.titles.find((t) => t.type === 'english')?.title;
      return {
        id: a.id,
        slug: a.slug,
        title: displayTitle,
        canonicalTitle: displayTitle,
        englishTitle: enTitle || displayTitle,
        posterImage: a.posterUrl,
        score: a.score,
        episodes: a.episodes,
        status: a.status,
        type: a.type,
        broadcastDay: a.broadcastDay || 'Unknown',
        broadcastTime: a.broadcastTime || null,
        broadcastTimezone: a.broadcastTimezone || 'JST',
        genres: a.animeGenres.map((g) => g.genre.name),
        studios: a.animeStudios.map((s) => s.studio.name),
      };
    });

    return NextResponse.json({
      day: day || 'All',
      items: mapped,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('Airing API error:', err);
    return NextResponse.json({ error: 'Failed to fetch airing anime' }, { status: 500 });
  }
}
