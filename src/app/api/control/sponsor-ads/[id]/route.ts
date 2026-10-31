import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireControl } from '@control/lib/access';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireControl(request); if (auth instanceof NextResponse) return auth;
  const b = await request.json();
  if (typeof b.enabled !== 'boolean') return NextResponse.json({ error: 'Enabled must be a boolean.' }, { status: 400 });
  const [ad] = await prisma.$queryRaw<any[]>`UPDATE "SponsorAd" SET enabled = ${Boolean(b.enabled)}, "updatedAt" = NOW() WHERE id = ${params.id} RETURNING *`;
  if (!ad) return NextResponse.json({ error: 'Sponsor ad not found.' }, { status: 404 });
  return NextResponse.json({ ad });
}
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireControl(request); if (auth instanceof NextResponse) return auth;
  await prisma.$executeRaw`DELETE FROM "SponsorAd" WHERE id = ${params.id}`; return NextResponse.json({ ok: true });
}
