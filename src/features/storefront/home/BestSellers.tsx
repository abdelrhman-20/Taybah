import { Container } from '../../shared/components/Container';
import { RevealItem } from '../../shared/components/Reveal';
import { ProductCard } from '../components/ProductCard';
import { productIsPublic, useCatalog } from '../catalog/catalogStore';
import { HomeSectionHeader } from './HomeSectionHeader';
import type { HomeContent } from './homeStore';

// There is no real sales metric in the catalog, so this renders the
// admin-curated product selection (in the order chosen) and never claims
// anything about sales volume.
export function BestSellers({ content }: { content: HomeContent['bestSellers'] }) {
  const catalog = useCatalog();
  const products = content.productIds
    .map((id) => catalog.products.find((p) => p.id === id))
    .filter((p): p is (typeof catalog.products)[number] => Boolean(p) && productIsPublic(p!, catalog));
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="best-sellers" className="py-6 sm:py-7">
      <Container>
        <HomeSectionHeader
          id="best-sellers"
          eyebrow={content.eyebrow}
          title={content.title}
          subtitle={content.subtitle}
          actionLabel={content.actionLabel}
          actionTo={content.actionTo}
          ornament
        />
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5">
          {products.map((product, index) => (
            <li key={product.id} className="h-full">
              <RevealItem variant="up" delay={Math.min(index, 7) * 60} className="h-full">
                <ProductCard product={product} card compact />
              </RevealItem>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
