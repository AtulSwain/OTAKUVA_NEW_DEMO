import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '../../../../lib/auth';
import { RateLimiter } from '../../../../lib/security/rateLimiter';
import { uploadCommentMedia, COMMENT_MEDIA_MAX_BYTES } from '../../../../lib/media/commentMediaUpload';
import { CommentError } from '../../../../lib/engine/community/commentError';

export const dynamic = 'force-dynamic';

/**
 * POST /api/uploads/comment-media  (multipart: file)
 * Stores an image/meme/GIF for a comment the user is about to post and
 * returns a pending attachment id. Owner is the session user; the file is
 * validated by content, not by the client's type or name.
 */
export async function POST(request: NextRequest) {
  const authUser = await getAuthUserFromRequest(request);
  if (!authUser) {
    return NextResponse.json({ error: 'Authentication required to upload' }, { status: 401 });
  }

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
  if (file.size > COMMENT_MEDIA_MAX_BYTES) {
    return NextResponse.json({ error: 'Images must be 10 MB or smaller' }, { status: 400 });
  }

  try {
    const media = await uploadCommentMedia(authUser.id, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ success: true, media }, { status: 201 });
  } catch (error) {
    if (error instanceof CommentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Comment media upload failed', error);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
