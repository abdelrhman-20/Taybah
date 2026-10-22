export function AdminPageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-8">
      <h2 className="font-display text-3xl text-espresso">{title}</h2>
      {description && <p className="mt-2 max-w-2xl text-sm text-espresso/60">{description}</p>}
    </header>
  );
}
