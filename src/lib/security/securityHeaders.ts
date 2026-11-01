/**
 * OTAKUVA SECURITY — PHASE 10.1
 * PRODUCTION SECURITY HEADERS & CORS ENGINE
 * 
 * Sets OWASP-compliant HTTP headers:
 * - Content-Security-Policy (CSP)
 * - Strict-Transport-Security (HSTS)
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: SAMEORIGIN
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Permissions-Policy (disables unneeded hardware APIs)
 * - Strict CORS policy with origin allowlisting
 */

import { NextResponse } from 'next/server';

export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js hydration & interactive charts
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https: data: blob:",
  "connect-src 'self' https:",
  "media-src 'self' https:",
  // Embedded players allowed inside our pages: the anime trailer window
  // (TrailerModal → src/lib/media/trailer.ts). Without this, frames fall
  // back to default-src 'self' and the browser shows "This content is blocked".
  "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://www.dailymotion.com https://geo.dailymotion.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function getSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': PRODUCTION_CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  };

  if (process.env.NODE_ENV === 'production') {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  }

  return headers;
}

export class SecurityHeaders {
  /**
   * Applies standard security headers to any NextResponse
   */
  static applyHeaders(response: NextResponse): NextResponse {
    const headers = getSecurityHeaders();
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  }

  /**
   * Applies explicit CORS configuration
   */
  static applyCors(
    response: NextResponse,
    requestOrigin: string | null = null,
    allowedOrigins: string[] = ['http://localhost:3000', 'https://otakuva.com']
  ): NextResponse {
    const origin = requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[0];

    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Max-Age', '86400');

    return response;
  }
}
