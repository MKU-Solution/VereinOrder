export interface ProductWithDeposit {
  deposit?: number | null;
  category?: { deposit?: number | null } | null;
}

/** Produktpfand überschreibt die Vorgabe der Kategorie, 0 erbt sie. */
export const resolveProductDeposit = (product: ProductWithDeposit): number => {
  if (Number.isInteger(product.deposit) && (product.deposit ?? 0) > 0) {
    return product.deposit as number;
  }
  const categoryDeposit = product.category?.deposit;
  return Number.isInteger(categoryDeposit) && (categoryDeposit ?? 0) > 0
    ? (categoryDeposit as number)
    : 0;
};
