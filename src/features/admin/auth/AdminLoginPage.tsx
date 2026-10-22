import { useId, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../../lib/supabase/client';
import { FormField } from '../../shared/components/FormField';
import { Button } from '../../shared/components/Button';
import { useAdminSession } from './useAdminSession';

export function AdminLoginPage() {
  const { session, loading } = useAdminSession();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordId = useId();

  if (!loading && session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/admin';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-porcelain/60 px-4" dir="rtl">
      <div className="w-full max-w-sm rounded border border-taupe/70 bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl text-espresso">
          تسجيل دخول <span className="text-burgundy">الإدارة</span>
        </h1>
        <p className="mt-1 text-sm text-espresso/60">لوحة تحكم متجر طيبة — لفريق العمل فقط.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <FormField
            label="البريد الإلكتروني"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div>
            <label htmlFor={passwordId} className="mb-1.5 block text-xs font-semibold tracking-wide text-espresso">
              كلمة المرور
            </label>
            <div className="relative">
              <input
                id={passwordId}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-taupe bg-white px-4 py-2.5 pe-11 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                className="absolute end-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center text-espresso/50 hover:text-espresso focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                {showPassword ? <EyeOff className="size-4.5" aria-hidden="true" /> : <Eye className="size-4.5" aria-hidden="true" />}
              </button>
            </div>
          </div>
          {error && <p className="text-xs text-burgundy">{error}</p>}
          <Button type="submit" className="w-full justify-center" disabled={submitting}>
            {submitting ? 'جارٍ الدخول...' : 'تسجيل الدخول'}
          </Button>
        </form>
      </div>
    </div>
  );
}
