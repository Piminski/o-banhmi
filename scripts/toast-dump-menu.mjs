#!/usr/bin/env node
/**
 * Dump Toast menu items (guid, name, price) for mapping into local JSON.
 *
 * Usage: npm run toast:dump
 * Writes: src/data/toast-menu.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./load-env.mjs";
import {
  buildToastPriceIndex,
  fetchToastMenus,
  flattenToastMenus,
  getToastAccessToken,
  getToastConfig,
} from "./toast-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFiles(root);

const { missing } = getToastConfig();
if (missing.length) {
  console.error("Missing Toast credentials in .env:\n");
  for (const key of missing) console.error(`  - ${key}`);
  process.exit(1);
}

const token = await getToastAccessToken();
const payload = await fetchToastMenus(token);
const rows = flattenToastMenus(payload);
const index = buildToastPriceIndex(payload);

const outPath = join(root, "src/data/toast-menu.json");
mkdirSync(dirname(outPath), { recursive: true });

const output = {
  fetchedAt: new Date().toISOString(),
  restaurantGuid: process.env.TOAST_RESTAURANT_GUID,
  preferredMenus: index.preferredMenus,
  menus: (payload.menus || []).map((m) => m.name),
  itemCount: rows.length,
  items: rows.map((r) => ({
    guid: r.guid,
    name: r.name,
    price: r.formattedPrice || r.price,
    description: r.description || "",
    image: r.image || "",
    images: r.images || [],
    menu: r.menu,
    group: r.group,
    pricingStrategy: r.pricingStrategy,
    visibility: r.visibility,
  })),
  preferredByName: Object.fromEntries(
    [...index.byName.entries()].map(([key, value]) => [key, value]),
  ),
};

writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${rows.length} Toast items → ${outPath}`);
console.log(`Preferred-menu name index: ${index.byName.size} dishes`);
