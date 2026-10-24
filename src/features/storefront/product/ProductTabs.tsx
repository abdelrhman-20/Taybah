import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface ProductTab {
  id: string;
  label: string;
  content: ReactNode;
}

// Accessible tabs (WAI-ARIA tabs pattern): roving tabindex, arrow keys / Home /
// End move between tabs, the panel is labelled by its tab.
export function ProductTabs({ tabs, label }: { tabs: ProductTab[]; label: string }) {
  const base = useId();
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (tabs.length === 0) return null;
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === activeId));
  const active = tabs[activeIndex];

  const onKey = (e: KeyboardEvent) => {
    // Horizontal arrows follow the reading direction: in RTL the tab list
    // runs right-to-left, so ArrowLeft goes to the NEXT tab.
    const rtl = document.documentElement.dir === 'rtl';
    let target: number;
    if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) target = (activeIndex + 1) % tabs.length;
    else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) target = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = tabs.length - 1;
    else return;
    e.preventDefault();
    setActiveId(tabs[target].id);
    refs.current[target]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-espresso/15 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-6">
        {tabs.map((tab, i) => {
          const on = tab.id === active.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={on}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-3 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-burgundy ${
                on ? 'border-burgundy text-burgundy' : 'border-transparent text-espresso/60 hover:text-espresso'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel-${active.id}`}
        aria-labelledby={`${base}-tab-${active.id}`}
        tabIndex={0}
        className="pt-8 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy"
      >
        {active.content}
      </div>
    </div>
  );
}
