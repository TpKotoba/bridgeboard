import { ChevronRight } from 'lucide-react';

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return <nav className="breadcrumb" aria-label="所在位置">
    <a className="breadcrumb-root" href="/">首頁</a>
    {items.map((item, index) => <span className="breadcrumb-step" key={index}>
      <ChevronRight size={14} aria-hidden="true" />
      {item.href ? <a href={item.href} title={item.label}>{item.label}</a> : <span aria-current="page" title={item.label}>{item.label}</span>}
    </span>)}
  </nav>;
}
