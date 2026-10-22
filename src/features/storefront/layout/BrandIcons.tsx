import type { SVGProps } from 'react';

// Lightweight inline glyphs for brands lucide-react doesn't ship (it dropped
// trademarked logos). Simple recognizable shapes, not official brand marks.

export function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M14 9.5V7.6c0-.7.5-1.1 1.2-1.1H17V3.1L14.3 3c-2.7 0-3.8 1.8-3.8 4.1v2.4H8v3.2h2.5V21h3.5v-8.3H17l.5-3.2H14z" />
    </svg>
  );
}

export function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.1" cy="6.9" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function WhatsappIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2.5a9.3 9.3 0 0 0-8 14l-1.1 4 4.2-1.1a9.3 9.3 0 1 0 4.9-16.9Zm0 1.9a7.4 7.4 0 1 1 0 14.8 7.3 7.3 0 0 1-3.8-1.1l-.3-.2-2.5.7.7-2.4-.2-.3a7.4 7.4 0 0 1 6.1-11.5Zm-3.3 4a.9.9 0 0 0-.6.3c-.2.2-.8.8-.8 1.9s.8 2.2.9 2.4c.1.1 1.6 2.6 4.1 3.6 2 .8 2.4.6 2.9.6.4 0 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1-.1-.1-.3-.2-.5-.3l-1.9-.9c-.2-.1-.4-.1-.5.1l-.8 1c-.1.1-.3.2-.5.1-.5-.2-1.3-.6-2.1-1.4-.6-.6-1-1.3-1.2-1.6-.1-.2 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.1c-.1-.3-.3-.3-.5-.3Z" />
    </svg>
  );
}

export function YoutubeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M21.6 7.7a2.5 2.5 0 0 0-1.8-1.8C18.1 5.5 12 5.5 12 5.5s-6.1 0-7.8.4A2.5 2.5 0 0 0 2.4 7.7 25.8 25.8 0 0 0 2 12a25.8 25.8 0 0 0 .4 4.3 2.5 2.5 0 0 0 1.8 1.8c1.7.4 7.8.4 7.8.4s6.1 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A25.8 25.8 0 0 0 22 12a25.8 25.8 0 0 0-.4-4.3ZM10 15.2V8.8l5.3 3.2-5.3 3.2Z" />
    </svg>
  );
}

export function TiktokIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M16.5 2h-2.7v13.4a2.6 2.6 0 1 1-1.9-2.5v-2.8a5.4 5.4 0 1 0 4.6 5.3v-6a7 7 0 0 0 4.2 1.4V8a4.3 4.3 0 0 1-4.2-4.3V2Z" />
    </svg>
  );
}

export function TelegramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M21.4 3.5 2.9 10.8c-.9.4-.9 1.6.1 1.9l4.6 1.5 1.8 5.6c.2.7 1.1.9 1.6.4l2.5-2.4 4.5 3.3c.8.6 1.9.1 2.1-.8l3-14.6c.2-1-.8-1.8-1.7-1.2ZM9.3 14.4l-1-3.2 9.3-6-7.3 6.9Z" />
    </svg>
  );
}
