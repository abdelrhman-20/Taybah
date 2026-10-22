import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { buttonStyles, type ButtonSize, type ButtonVariant } from './buttonStyles';

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button className={`${buttonStyles(variant, size)} ${className}`} {...props} />;
}

export function ButtonLink({
  to,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={`${buttonStyles(variant, size)} ${className}`}>
      {children}
    </Link>
  );
}
