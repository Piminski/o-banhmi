export type ToastPriceEntry = {
  name: string;
  price: string;
  description?: string;
  menu?: string;
  group?: string;
  guid?: string;
  image?: string;
  multiLocationId?: string;
};

export type ToastPriceIndex = {
  byGuid: Map<string, ToastPriceEntry>;
  byName: Map<string, ToastPriceEntry>;
};

export type ToastMenuRow = {
  menu: string;
  group: string;
  name: string;
  guid: string;
  multiLocationId?: string;
  price: unknown;
  formattedPrice: string;
  description: string;
  image: string;
  images: string[];
  pricingStrategy: string;
  visibility: string[];
};

export type ToastCatalog = {
  fetchedAt: string;
  menus: string[];
  rows: ToastMenuRow[];
  index: ToastPriceIndex;
  outOfStockIds: Set<string>;
  stockError?: string;
};

export const PREFERRED_MENUS = ["Food", "Drinks", "Drinks Menu"];

function env(name: string) {
  return process.env[name] || import.meta.env[name] || "";
}

export function hasToastConfig() {
  return Boolean(env("TOAST_CLIENT_ID") && env("TOAST_CLIENT_SECRET") && env("TOAST_RESTAURANT_GUID"));
}

function toastHost() {
  return String(env("TOAST_API_HOST") || "https://ws-api.toasttab.com").replace(/\/$/, "");
}

export function normalizeDishName(name: string) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Website name → Toast name when labels differ slightly. Add entries after toast:dump. */
const NAME_ALIASES: Record<string, string> = {};

export function aliasDishName(name: string) {
  const key = normalizeDishName(name);
  return NAME_ALIASES[key] || key;
}

export function toastGroupLabel(toastGroup?: string) {
  if (!toastGroup) return undefined;
  const parts = toastGroup
    .split(" > ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  return parts.join(" > ");
}

export function formatToastPrice(price: unknown) {
  if (price == null || price === "") return "";
  const n = Number(price);
  if (Number.isNaN(n)) return String(price);
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function lookupRef(map: Record<string, unknown> | undefined, ref: unknown) {
  if (!map || ref == null) return undefined;
  return map[String(ref)] ?? (map as Record<string | number, unknown>)[ref as number];
}

function formatItemPrice(item: Record<string, unknown>, modifierGroups: Record<string, unknown>, modifierOptions: Record<string, unknown>) {
  if (item.price != null && item.price !== "") {
    return formatToastPrice(item.price);
  }

  const sizes: { name: string; price: unknown }[] = [];
  for (const ref of (item.modifierGroupReferences as unknown[]) || []) {
    const group = lookupRef(modifierGroups, ref) as { modifierOptionReferences?: unknown[] } | undefined;
    for (const optionRef of group?.modifierOptionReferences || []) {
      const option = lookupRef(modifierOptions, optionRef) as { name?: string; price?: unknown } | undefined;
      if (option?.name && option.price != null && option.price !== "") {
        sizes.push({ name: String(option.name), price: option.price });
      }
    }
  }

  const glass = sizes.find((size) => /glass/i.test(size.name));
  const bottle = sizes.find((size) => /bottle/i.test(size.name));
  if (glass && bottle) {
    return `${formatToastPrice(glass.price)} / ${formatToastPrice(bottle.price)}`;
  }
  if (bottle) return formatToastPrice(bottle.price);
  if (glass) return formatToastPrice(glass.price);
  return "";
}

function itemImages(item: { image?: string | null; images?: string[] | null }) {
  const images = Array.isArray(item.images) ? item.images.map(String).filter(Boolean) : [];
  const image = String(item.image || images[0] || "").trim();
  return { image, images };
}

async function getAccessToken() {
  const res = await fetch(`${toastHost()}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: env("TOAST_CLIENT_ID"),
      clientSecret: env("TOAST_CLIENT_SECRET"),
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token?.accessToken) {
    throw new Error(`Toast auth failed (${res.status})`);
  }

  return data.token.accessToken as string;
}

function flattenMenus(menusPayload: {
  modifierGroupReferences?: Record<string, unknown>;
  modifierOptionReferences?: Record<string, unknown>;
  menus?: Array<{
    name: string;
    menuGroups?: unknown[];
  }>;
}): ToastMenuRow[] {
  const rows: ToastMenuRow[] = [];
  const modifierGroups = menusPayload?.modifierGroupReferences || {};
  const modifierOptions = menusPayload?.modifierOptionReferences || {};

  for (const menu of menusPayload?.menus || []) {
    const walk = (groups: unknown[] | undefined, trail: string[]) => {
      for (const group of groups || []) {
        const typed = group as {
          name?: string;
          menuItems?: Array<Record<string, unknown>>;
          menuGroups?: unknown[];
        };
        const next = [...trail, String(typed.name || "")];
        for (const item of typed.menuItems || []) {
          const { image, images } = itemImages(item as { image?: string | null; images?: string[] | null });
          rows.push({
            menu: menu.name,
            group: next.join(" > "),
            name: String(item.name || ""),
            guid: String(item.guid || ""),
            multiLocationId: item.multiLocationId ? String(item.multiLocationId) : undefined,
            price: item.price,
            formattedPrice: formatItemPrice(item, modifierGroups, modifierOptions),
            description: String(item.description || "").trim(),
            image,
            images,
            pricingStrategy: String(item.pricingStrategy || ""),
            visibility: (item.visibility as string[]) || [],
          });
        }
        walk(typed.menuGroups, next);
      }
    };
    walk(menu.menuGroups, []);
  }

  return rows;
}

function toPriceEntry(row: ToastMenuRow): ToastPriceEntry {
  return {
    name: row.name,
    price: row.formattedPrice,
    description: row.description || "",
    menu: row.menu,
    group: row.group,
    guid: row.guid,
    image: row.image,
    multiLocationId: row.multiLocationId,
  };
}

function buildIndex(rows: ToastMenuRow[]): ToastPriceIndex {
  const byGuid = new Map<string, ToastPriceEntry>();
  const byName = new Map<string, ToastPriceEntry>();

  const menuRank = (menuName: string) => {
    const idx = PREFERRED_MENUS.indexOf(menuName);
    return idx === -1 ? PREFERRED_MENUS.length + 1 : idx;
  };

  const score = (row: ToastMenuRow) => {
    let s = menuRank(row.menu) * 100;
    if ((row.visibility || []).includes("POS")) s -= 10;
    if (row.pricingStrategy === "BASE_PRICE") s -= 1;
    if (row.price == null) s += 50;
    return s;
  };

  const preferredRows = rows.filter((row) => PREFERRED_MENUS.includes(row.menu));
  const bestByGuid = new Map<string, ToastMenuRow>();
  for (const row of preferredRows) {
    if (!row.guid) continue;
    const prev = bestByGuid.get(row.guid);
    if (!prev || score(row) < score(prev)) bestByGuid.set(row.guid, row);
  }
  for (const row of bestByGuid.values()) {
    byGuid.set(row.guid, toPriceEntry(row));
  }

  for (const row of [...preferredRows].sort((a, b) => score(a) - score(b))) {
    const key = normalizeDishName(row.name);
    if (!key || byName.has(key)) continue;
    byName.set(key, toPriceEntry(row));
  }

  for (const [aliasKey, toastKey] of Object.entries(NAME_ALIASES)) {
    if (byName.has(aliasKey)) continue;
    const entry = byName.get(toastKey);
    if (entry) byName.set(aliasKey, entry);
  }

  return { byGuid, byName };
}

function buildCatalog(
  payload: Parameters<typeof flattenMenus>[0] & { menus?: Array<{ name: string }> },
  stock: { ids: Set<string>; error?: string },
): ToastCatalog {
  const rows = flattenMenus(payload);
  return {
    fetchedAt: new Date().toISOString(),
    menus: (payload?.menus || []).map((menu) => menu.name),
    rows,
    index: buildIndex(rows),
    outOfStockIds: stock.ids,
    stockError: stock.error,
  };
}

async function fetchOutOfStockIds(token: string): Promise<{ ids: Set<string>; error?: string }> {
  try {
    const res = await fetch(`${toastHost()}/stock/v1/inventory`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Toast-Restaurant-External-ID": env("TOAST_RESTAURANT_GUID"),
      },
    });

    if (res.status === 403) {
      console.warn(
        "Toast stock API 403 — add the stock:read scope to the Toast API client to hide 86'd items",
      );
      return { ids: new Set(), error: "stock:read" };
    }

    if (!res.ok) {
      console.warn(`Toast stock failed (${res.status}) — not filtering out-of-stock items`);
      return { ids: new Set(), error: `http-${res.status}` };
    }

    const rows = await res.json().catch(() => []);
    const ids = new Set<string>();

    for (const row of rows || []) {
      const quantity = Number(row.quantity);
      const outOfStock =
        row.status === "OUT_OF_STOCK" || (row.status === "QUANTITY" && !(quantity > 0));
      if (!outOfStock) continue;
      if (row.guid) ids.add(String(row.guid));
      if (row.multiLocationId) ids.add(String(row.multiLocationId));
    }

    return { ids };
  } catch (error) {
    console.warn("Toast stock fetch failed — not filtering out-of-stock items", error);
    return { ids: new Set(), error: "network" };
  }
}

export function resolveToastEntry(
  item: { name: string; toastGuid?: string },
  index: ToastPriceIndex | null,
): ToastPriceEntry | undefined {
  if (!index) return undefined;

  const byName = index.byName.get(aliasDishName(item.name));
  if (byName) return byName;

  if (item.toastGuid) {
    return index.byGuid.get(item.toastGuid);
  }

  return undefined;
}

export function isToastOutOfStock(
  item: { name: string; toastGuid?: string },
  catalog: ToastCatalog | null,
) {
  if (!catalog?.outOfStockIds.size) return false;

  const toast = resolveToastEntry(item, catalog.index);
  if (!toast) return false;

  if (toast.guid && catalog.outOfStockIds.has(toast.guid)) return true;
  if (toast.multiLocationId && catalog.outOfStockIds.has(toast.multiLocationId)) return true;
  return false;
}

let cachedCatalog: ToastCatalog | null = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

async function loadCatalog(): Promise<ToastCatalog | null> {
  if (!hasToastConfig()) return null;

  if (cachedCatalog && Date.now() - cachedAt < CACHE_MS) {
    return cachedCatalog;
  }

  try {
    const token = await getAccessToken();
    const res = await fetch(`${toastHost()}/menus/v2/menus`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Toast-Restaurant-External-ID": env("TOAST_RESTAURANT_GUID"),
      },
    });

    if (!res.ok) {
      console.warn(`Toast menus failed (${res.status}) — keeping local prices`);
      return cachedCatalog;
    }

    const payload = await res.json();
    const stock = await fetchOutOfStockIds(token);
    cachedCatalog = buildCatalog(payload, stock);
    cachedAt = Date.now();
    return cachedCatalog;
  } catch (error) {
    console.warn("Toast price fetch failed — keeping local prices", error);
    return cachedCatalog;
  }
}

export async function getToastCatalog(): Promise<ToastCatalog | null> {
  return loadCatalog();
}
