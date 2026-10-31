import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireControl } from '@control/lib/access';
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireControl(request); if (auth instanceof NextResponse) return auth;
  const b = await request.json();
  if (typeof b.enabled !== 'boolean') return NextResponse.json({ error: 'Enabled must be a boolean.' }, { status: 400 });
  const [product] = await prisma.$queryRaw<any[]>`UPDATE "CommissionProduct" SET enabled = ${b.enabled}, "updatedAt" = NOW() WHERE id = ${params.id} RETURNING *`;
  if (!product) return NextResponse.json({ error: 'Commission product not found.' }, { status: 404 });
  return NextResponse.json({ product });
}
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireControl(request); if (auth instanceof NextResponse) return auth;
  const deleted = await prisma.$executeRaw`DELETE FROM "CommissionProduct" WHERE id = ${params.id}`;
  if (!deleted) return NextResponse.json({ error: 'Commission product not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
