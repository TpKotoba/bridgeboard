'use client';

import { useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

export function EventCalendar({ dates, value, onChange, unrestricted = false }: {
  unrestricted?: boolean;
  dates: string[];
  value: string;
  onChange: (date: string) => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const calendarId = useId();
  const counts = new Map<string, number>();
  dates.forEach(date => counts.set(date, (counts.get(date) ?? 0) + 1));
  const months = [...new Set(dates.map(date => date.slice(0, 7)))].sort();
  const [month, setMonth] = useState('');
  const shown = unrestricted ? month || value.slice(0, 7) : months.includes(month) ? month : months.at(-1) || new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = shown.split('-').map(Number);
  const offset = new Date(year, monthNumber - 1, 1).getDay();
  const days = new Date(year, monthNumber, 0).getDate();
  const index = months.indexOf(shown);
  function shiftMonth(delta: number) {
    const next = new Date(year, monthNumber - 1 + delta, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  }
  function select(date: string) {
    onChange(date);
    popup.current?.hidePopover();
  }
  return <>
    <button type="button" className={unrestricted ? 'calendar-date-field' : 'hub-date-toggle'} aria-label="選擇賽事日期" popoverTarget={calendarId} onClick={() => setMonth(value.slice(0, 7) || months.at(-1) || '')}>{unrestricted && <span>{value.replaceAll('-', '/')}</span>}<CalendarDays size={20} /></button>
    <div ref={popup} id={calendarId} popover="auto" className="event-calendar" role="dialog" aria-label="選擇賽事日期">
      <div className="calendar-heading"><strong>賽事日曆</strong><button type="button" aria-label="關閉日曆" popoverTarget={calendarId} popoverTargetAction="hide"><X size={18} /></button></div>
      {(unrestricted || months.length > 0) ? <>
        <div className="calendar-month">
          <button type="button" aria-label={unrestricted ? '上一個月' : '上一個有賽事的月份'} disabled={!unrestricted && index <= 0} onClick={() => unrestricted ? shiftMonth(-1) : setMonth(months[index - 1])}><ChevronLeft size={20} /></button>
          {unrestricted ? <strong>{year} 年 {monthNumber} 月</strong> : <select aria-label="選擇月份" value={shown} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={m} value={m}>{Number(m.slice(0, 4))} 年 {Number(m.slice(5))} 月</option>)}</select>}
          <button type="button" aria-label={unrestricted ? '下一個月' : '下一個有賽事的月份'} disabled={!unrestricted && index >= months.length - 1} onClick={() => unrestricted ? shiftMonth(1) : setMonth(months[index + 1])}><ChevronRight size={20} /></button>
        </div>
        <div className="calendar-week" aria-hidden="true">{'日一二三四五六'.split('').map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-days">
          {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const day = i + 1;
            const date = `${shown}-${String(day).padStart(2, '0')}`;
            const count = counts.get(date) ?? 0;
            return <button type="button" key={date} disabled={!unrestricted && !count} className={unrestricted || count ? 'has-events' : ''} aria-pressed={value === date} aria-label={`${year} 年 ${monthNumber} 月 ${day} 日${unrestricted ? '' : `，${count ? `${count} 場賽事` : '無賽事'}`}`} onClick={() => select(date)}><span>{day}</span>{count > 0 && <i aria-hidden="true" />}</button>;
          })}
        </div>
        {!unrestricted && <p className="calendar-legend"><i />有賽事的日期可選取</p>}
      </> : <p>目前沒有可選的賽事日期。</p>}
      {value && !unrestricted && <button type="button" className="button subtle calendar-clear" onClick={() => select('')}>清除日期篩選</button>}
    </div>
  </>;
}
