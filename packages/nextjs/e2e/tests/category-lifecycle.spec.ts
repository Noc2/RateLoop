import { addCategory, waitForPonderIndexed } from "../helpers/admin-helpers";
import { DEPLOYER } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { getCategories } from "../helpers/ponder-api";
import { expect, test } from "@playwright/test";

/**
 * Seed category metadata tests.
 * Triggers Ponder event: CategoryAdded.
 *
 * Account allocation:
 * - Account #9 (scaffold-eth-default deployer = governance in local dev) — has ADMIN_ROLE
 */
test.describe("Seed categories", () => {
  const CATEGORY_REGISTRY = CONTRACT_ADDRESSES.CategoryRegistry;

  test("admin adds seed metadata and Ponder indexes it", async () => {
    test.setTimeout(60_000);

    const uniqueId = Date.now();
    const name = `Seed Category ${uniqueId}`;
    const slug = `seed-${uniqueId}`;

    // Snapshot current categories.
    const initialCategories = (await getCategories()).items.map(c => c.id);

    // Add category metadata directly (account #0 has ADMIN_ROLE).
    const success = await addCategory(
      name,
      slug,
      ["Science", "Technology"],
      DEPLOYER.address,
      CATEGORY_REGISTRY,
    );
    expect(success).toBe(true);

    // Wait for Ponder to index the new category metadata.
    const indexed = await waitForPonderIndexed(async () => {
      const { items } = await getCategories();
      return items.some(c => c.name === name);
    });

    expect(indexed, "Ponder should index the category metadata added on-chain").toBe(true);

    const { items } = await getCategories();
    const added = items.find(c => c.name === name);
    expect(added).toBeTruthy();
    expect(added!.slug).toBe(slug);
    expect(initialCategories).not.toContain(added!.id);
  });

  test("multiple categories can be added and all appear in Ponder", async () => {
    test.setTimeout(60_000);

    const uniqueId = Date.now();
    const categories = [
      { name: `E2E Cat A ${uniqueId}`, slug: `cat-a-${uniqueId}` },
      { name: `E2E Cat B ${uniqueId}`, slug: `cat-b-${uniqueId}` },
    ];

    // Add both categories
    for (const cat of categories) {
      const success = await addCategory(cat.name, cat.slug, ["General"], DEPLOYER.address, CATEGORY_REGISTRY);
      expect(success).toBe(true);
    }

    // Wait for Ponder to index both
    const indexed = await waitForPonderIndexed(async () => {
      const { items } = await getCategories();
      return categories.every(cat => items.some(i => i.name === cat.name));
    });

    expect(indexed, "Ponder should index all category metadata added on-chain").toBe(true);

    const { items } = await getCategories();
    for (const cat of categories) {
      const found = items.find(i => i.name === cat.name);
      expect(found).toBeTruthy();
      expect(found!.slug).toBe(cat.slug);
    }
  });
});
