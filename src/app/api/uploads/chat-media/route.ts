import { NextRequest, NextResponse } from 'next/server';
import { requireVerifiedUser } from '../../../../lib/auth';
import { RateLimiter } from '../../../../lib/security/rateLimiter';
import { uploadChatMedia, CHAT_MEDIA_MAX_BYTES, ChatMediaError } from '../../../../lib/media/chatMediaUpload';

export const dynamic = 'force-dynamic';

/**
 * POST /api/uploads/chat-media  (multipart: file)
 * Uploads a chat message image attachment and returns its stored URL. The
 * caller still has to POST the message itself (with this url as mediaUrl) —
 * this route only handles the upload half.
 */
export async function POST(request: NextRequest) {
  const authUser = await requireVerifiedUser(request);
  if (authUser instanceof NextResponse) return authUser;

  const rate = await RateLimiter.check('MEDIA_UPLOAD', authUser.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many uploads. Please wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec || 60) } }
    );
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get('file');
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json({ error: 'Send the image as multipart form data' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  if (file.size > CHAT_MEDIA_MAX_BYTES) {
    return NextResponse.json({ error: 'Images must be 10 MB or smaller' }, { status: 400 });
  }

  try {
    const media = await uploadChatMedia(authUser.id, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ success: true, media }, { status: 201 });
  } catch (error) {
    if (error instanceof ChatMediaError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Chat media upload failed', error);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
