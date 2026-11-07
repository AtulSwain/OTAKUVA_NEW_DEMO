import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params;
    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get('sortBy') || 'score';
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const skip = (page - 1) * limit;

    const theme = await prisma.theme.findFirst({
      where: {
        OR: [{ slug }, { name: { contains: slug, mode: 'insensitive' } }],
      },
    });

    if (!theme) {
      return NextResponse.json({ error: 'Theme not found' }, { status: 404 });
    }

    const where = {
      animeThemes: {
        some: { themeId: theme.id },
      },
    };

    let orderBy: any = [{ score: { sort: 'desc', nulls: 'last' } }, { popularity: 'desc' }];
    if (sortBy === 'popularity') orderBy = { popularity: 'asc' };
    if (sortBy === 'title') orderBy = { canonicalTitle: 'asc' };
    if (sortBy === 'year') orderBy = [{ year: 'desc' }, { startYear: 'desc' }];

    const [total, animes] = await Promise.all([
      prisma.anime.count({ where }),
      prisma.anime.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          titles: true,
          animeGenres: { include: { genre: true } },
          animeStudios: { include: { studio: true } },
        },
      }),
    ]);

    const formatted = animes.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.canonicalTitle,
      englishTitle: a.titles.find((t) => t.type === 'english')?.title || null,
      posterImage: a.posterUrl,
      posterUrl: a.posterUrl,
      score: a.score,
      episodes: a.episodes,
      type: a.type,
      status: a.status,
      year: a.year || a.startYear,
      genres: a.animeGenres.map((ag) => ag.genre.name),
      studios: a.animeStudios.map((as) => as.studio.name),
    }));

    return NextResponse.json({
      theme: {
        id: theme.id,
        name: theme.name,
        slug: theme.slug,
        totalAnime: total,
      },
      animes: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Error fetching theme details:', error);
    return NextResponse.json({ error: 'Failed to fetch theme' }, { status: 500 });
  }
}
