import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Bridgeboard｜橋牌賽事記分', description: '隊制賽與雙人賽，即時成績、逐副比較與主辦收分。' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
