import sandwiches from "../data/menu/sandwiches.json";
import curryBowls from "../data/menu/curry-bowls.json";
import localSite from "../data/site.json";
import {
  PREFERRED_MENUS,
  getToastCatalog,
  isToastOutOfStock,
  normalizeDishName,
  resolveToastEntry,
  toastGroupLabel,
  type ToastCatalog,
  type ToastMenuRow,
} from "./toast";

export type SiteData = typeof localSite;

export type MenuItem = {
  name: string;
  price: string;
  description: string;
  image?: string;
  dietary?: string[];
  options?: string[];
  hidden?: boolean;
  toastGuid?: string;
  preferLocalDescription?: boolean;
  group?: string;
  fallback?: {
    name: boolean;
    price: boolean;
    description: boolean;
    image: boolean;
  };
};

export type MenuItemGroup = {
  group?: string;
  items: MenuItem[];
};

export function groupedItems(items: MenuItem[]): MenuItemGroup[] {
  const groups: MenuItemGroup[] = [];

  for (const item of items) {
    const group = item.group?.trim() || undefined;
    const last = groups[groups.length - 1];
    if (last && last.group === group) {
      last.items.push(item);
    } else {
      groups.push({ group, items: [item] });
    }
  }

  return groups;
}

export type MenuCategory = {
  category: string;
  description?: string;
  items: MenuItem[];
};

const localCategories = [sandwiches, curryBowls];

const TOAST_FOOD_GROUP_TO_CATEGORY: Record<string, string> = {
  sandwiches: "Vietnamese Sandwiches",
  "vietnamese sandwiches": "Vietnamese Sandwiches",
  "banh mi": "Vietnamese Sandwiches",
  "banh mi sandwiches": "Vietnamese Sandwiches",
  curry: "Curry Bowls",
  "curry bowl": "Curry Bowls",
  "curry bowls": "Curry Bowls",
};

function toastGroupParts(group?: string) {
  const label = toastGroupLabel(group);
  if (!label) return [];
  return label
    .split(/\s*(?:>|\|)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function mappedFoodCategory(group?: string) {
  for (const part of toastGroupParts(group)) {
    const mapped = TOAST_FOOD_GROUP_TO_CATEGORY[normalizeDishName(part)];
    if (mapped) return mapped;
  }
  return undefined;
}

function matchToastRowToCategory(row: ToastMenuRow, categoryNames: string[]) {
  if (row.menu === "Drinks" || row.menu === "Drinks Menu") {
    return categoryNames.find((name) => name === "Drinks") || "Drinks";
  }

  return mappedFoodCategory(row.group);
}

function foodGroupFromToast(row: ToastMenuRow, categoryName: string) {
  const label = toastGroupLabel(row.group);
  if (!label) return undefined;

  const rest = label
    .split(" > ")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const alts = part.split("|").map((alt) => alt.trim()).filter(Boolean);
      return !alts.some((alt) => TOAST_FOOD_GROUP_TO_CATEGORY[normalizeDishName(alt)] === categoryName);
    });

  return rest.length ? rest.join(" > ") : undefined;
}

function withFallbackFlags(
  item: MenuItem,
  used: { name: boolean; price: boolean; description: boolean; image: boolean },
): MenuItem {
  return {
    ...item,
    fallback: {
      name: !used.name,
      price: !used.price,
      description: !used.description,
      image: !used.image,
    },
  };
}

function menuItemFromToastRow(row: ToastMenuRow, categoryName: string): MenuItem {
  const description = String(row.description || "").trim();
  const image = row.image || "";
  const group = foodGroupFromToast(row, categoryName);

  return withFallbackFlags(
    {
      name: row.name,
      price: row.formattedPrice,
      description,
      image,
      toastGuid: row.guid,
      ...(group ? { group } : {}),
    },
    {
      name: true,
      price: Boolean(row.formattedPrice),
      description: Boolean(description),
      image: Boolean(image),
    },
  );
}

function preferredFoodRows(catalog: ToastCatalog): ToastMenuRow[] {
  const rows: ToastMenuRow[] = [];
  for (const menu of PREFERRED_MENUS) {
    for (const row of catalog.rows) {
      if (row.menu !== menu) continue;
      if (!toastGroupLabel(row.group)) continue;
      if (!row.formattedPrice || row.formattedPrice === "$0") continue;
      rows.push(row);
    }
  }
  return rows;
}

function hideHiddenItems(categories: MenuCategory[]): MenuCategory[] {
  return categories.map((category) => ({
    ...category,
    items: category.items.filter((item) => !item.hidden),
  }));
}

function hideOutOfStockItems(
  categories: MenuCategory[],
  catalog: ToastCatalog | null,
): MenuCategory[] {
  if (!catalog?.outOfStockIds.size) return categories;

  return categories.map((category) => ({
    ...category,
    items: category.items.filter((item) => !isToastOutOfStock(item, catalog)),
  }));
}

function overlayToastGroup(
  item: MenuItem,
  categoryName: string,
  toast: { group?: string } | undefined,
) {
  const fromToast = toastGroupLabel(toast?.group);
  if (!fromToast) return item.group;
  if (item.group || categoryName === "Drinks") return fromToast;
  return item.group;
}

function applyToastOrder(
  categories: MenuCategory[],
  catalog: ToastCatalog | null,
): MenuCategory[] {
  if (!catalog) return categories;

  const storedByName = new Map(categories.map((category) => [category.category, category]));
  const byGuid = new Map<string, MenuItem>();
  const byName = new Map<string, MenuItem>();

  for (const category of categories) {
    for (const item of category.items) {
      if (item.toastGuid) byGuid.set(item.toastGuid, item);
      const key = normalizeDishName(item.name);
      if (key && !byName.has(key)) byName.set(key, item);
    }
  }

  const itemsByCategory = new Map<string, MenuItem[]>();
  const categoryOrder: string[] = [];
  const used = new Set<MenuItem>();
  const emittedGuids = new Set<string>();
  const emittedNames = new Set<string>();
  const categoryNames = categories.map((category) => category.category);

  const take = (categoryName: string, item: MenuItem) => {
    const list = itemsByCategory.get(categoryName);
    if (list) {
      list.push(item);
      return;
    }
    itemsByCategory.set(categoryName, [item]);
    categoryOrder.push(categoryName);
  };

  for (const row of preferredFoodRows(catalog)) {
    const nameKey = normalizeDishName(row.name);
    if (row.guid && emittedGuids.has(row.guid)) continue;
    if (nameKey && emittedNames.has(nameKey)) continue;

    const categoryName = matchToastRowToCategory(row, categoryNames);
    if (!categoryName) continue;

    const stored = (row.guid && byGuid.get(row.guid)) || (nameKey ? byName.get(nameKey) : undefined);
    if (stored) {
      used.add(stored);
      const group = foodGroupFromToast(row, categoryName);
      take(categoryName, group ? { ...stored, group } : stored);
    } else {
      take(categoryName, menuItemFromToastRow(row, categoryName));
    }

    if (row.guid) emittedGuids.add(row.guid);
    if (nameKey) emittedNames.add(nameKey);
  }

  for (const category of categories) {
    const leftovers = category.items.filter((item) => !used.has(item));
    if (!leftovers.length) continue;
    leftovers.forEach((item) => take(category.category, item));
  }

  const fromToast = categoryOrder.map((name) => ({
    category: name,
    description: storedByName.get(name)?.description,
    items: itemsByCategory.get(name) || [],
  }));

  const seen = new Set(fromToast.map((category) => category.category));
  for (const category of categories) {
    if (seen.has(category.category)) continue;
    fromToast.push(category);
  }

  return fromToast.filter((category) => category.items.length || category.description?.trim());
}

function applyToastFields(
  categories: MenuCategory[],
  catalog: ToastCatalog | null,
): MenuCategory[] {
  if (!catalog) return categories;

  return categories.map((category) => ({
    ...category,
    items: category.items.map((item) => {
      const toast = resolveToastEntry(item, catalog.index);
      if (!toast) {
        return withFallbackFlags(item, { name: false, price: false, description: false, image: false });
      }

      const row = catalog.rows.find(
        (candidate) => candidate.guid === toast.guid && PREFERRED_MENUS.includes(candidate.menu),
      );
      const toastImage = row?.image || toast.image || "";
      const usedName = Boolean(toast.name);
      const usedPrice = Boolean(toast.price);
      const usedDescription = Boolean(toast.description) && !item.preferLocalDescription;
      const usedImage = Boolean(toastImage);
      const group = overlayToastGroup(item, category.category, toast);

      return withFallbackFlags(
        {
          ...item,
          name: toast.name || item.name,
          ...(usedPrice ? { price: toast.price } : {}),
          ...(usedDescription ? { description: toast.description || "" } : {}),
          image: toastImage || item.image || "",
          ...(group ? { group } : {}),
        },
        {
          name: usedName,
          price: usedPrice,
          description: usedDescription,
          image: usedImage,
        },
      );
    }),
  }));
}

function localCategoriesMapped(): MenuCategory[] {
  return localCategories.map((category) => ({
    category: category.category,
    description: "description" in category ? category.description : undefined,
    items: category.items.filter((item) => !item.hidden),
  }));
}

export async function getSite(): Promise<SiteData> {
  return localSite;
}

export async function getMenu(): Promise<{ categories: MenuCategory[] }> {
  const catalog = await getToastCatalog();

  return {
    categories: hideOutOfStockItems(
      hideHiddenItems(applyToastOrder(applyToastFields(localCategoriesMapped(), catalog), catalog)),
      catalog,
    ),
  };
}
