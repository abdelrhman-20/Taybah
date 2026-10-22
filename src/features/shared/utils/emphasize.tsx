import type { ReactNode } from 'react';

// Section titles on the home page come from admin-editable content
// (homeStore) — their wording can change, so the "important word" to
// accent can't be hardcoded per string the way static page titles were.
// Emphasizing the last word is a simple rule that keeps working whatever
// the admin sets the heading to.
export function emphasizeLastWord(text: string, className = 'text-burgundy'): ReactNode {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) {
    return <span className={className}>{text}</span>;
  }
  const last = words.pop();
  return (
    <>
      {words.join(' ')} <span className={className}>{last}</span>
    </>
  );
}
