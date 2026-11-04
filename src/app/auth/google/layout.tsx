import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Continue with Google',
  robots: { index: false, follow: false },
};

export default function GoogleAuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
