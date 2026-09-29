import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'سیمرغ ERP',
  description: 'SIMORGH ERP — AI-Native Industrial ERP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
