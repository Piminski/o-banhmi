/**
 * Shared Toast Menus API helpers for Node scripts.
 */
const PREFERRED_MENUS = ["Food", "Drinks", "Drinks Menu"];

export function getToastConfig() {
  const host = (process.env.TOAST_API_HOST || "https://ws-api.toasttab.com").replace(/\/$/, "");
  const clientId = process.env.TOAST_CLIENT_ID;
  const clientSecret = process.env.TOAST_CLIENT_SECRET;
  const restaurantGuid = process.env.TOAST_RESTAURANT_GUID;

  const missing = [];
  if (!clientId?.trim()) missing.push("TOAST_CLIENT_ID");
  if (!clientSecret?.trim()) missing.push("TOAST_CLIENT_SECRET");
  if (!restaurantGuid?.trim()) missing.push("TOAST_RESTAURANT_GUID");

  return { host, clientId, clientSecret, restaurantGuid, missing };
}

export async function getToastAccessToken() {
  const { host, clientId, clientSecret, missing } = getToastConfig();
  if (missing.length) {
    throw new Error(`Missing Toast env: ${missing.join(", ")}`);
  }

  const res = await fetch(`${host}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId,
      clientSecret,
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token?.accessToken) {
    throw new Error(`Toast auth failed (${res.status}): ${data.message || "no access token"}`);
  }

  return data.token.accessToken;
}

export async function fetchToastMenus(token) {
  const { host, restaurantGuid } = getToastConfig();
  const res = await fetch(`${host}/menus/v2/menus`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Toast-Restaurant-External-ID": restaurantGuid,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Toast menus failed (${res.status}): ${data.message || "unknown error"}`);
  }

  return data;
}

export function normalizeDishName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lookupRef(map, ref) {
  if (!map || ref == null) return undefined;
  return map[ref] ?? map[String(ref)];
}

function formatToastPrice(price) {
  if (price == null || price === "") return "";
  const n = Number(price);
  if (Number.isNaN(n)) return String(price);
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function formatItemPrice(item, modifierGroups, modifierOptions) {
  if (item.price != null && item.price !== "") {
    return formatToastPrice(item.price);
  }

  const sizes = [];
  for (const ref of item.modifierGroupReferences || []) {
    const group = lookupRef(modifierGroups, ref);
    for (const optionRef of group?.modifierOptionReferences || []) {
      const option = lookupRef(modifierOptions, optionRef);
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

export function flattenToastMenus(menusPayload) {
  const rows = [];
  const modifierGroups = menusPayload?.modifierGroupReferences || {};
  const modifierOptions = menusPayload?.modifierOptionReferences || {};

  for (const menu of menusPayload?.menus || []) {
    const walk = (groups, trail) => {
      for (const group of groups || []) {
        const next = [...trail, group.name];
        for (const item of group.menuItems || []) {
          const images = Array.isArray(item.images) ? item.images.filter(Boolean) : [];
          rows.push({
            menu: menu.name,
            group: next.join(" > "),
            name: item.name,
            guid: item.guid,
            price: item.price,
            formattedPrice: formatItemPrice(item, modifierGroups, modifierOptions),
            pricingStrategy: item.pricingStrategy,
            visibility: item.visibility || [],
            description: item.description || "",
            image: item.image || images[0] || "",
            images,
          });
        }
        walk(group.menuGroups, next);
      }
    };
    walk(menu.menuGroups, []);
  }

  return rows;
}

export function buildToastPriceIndex(menusPayload) {
  const rows = flattenToastMenus(menusPayload);
  const byGuid = new Map();
  const byName = new Map();

  const menuRank = (menuName) => {
    const idx = PREFERRED_MENUS.indexOf(menuName);
    return idx === -1 ? PREFERRED_MENUS.length + 1 : idx;
  };

  const score = (row) => {
    let s = menuRank(row.menu) * 100;
    if ((row.visibility || []).includes("POS")) s -= 10;
    if (row.pricingStrategy === "BASE_PRICE") s -= 1;
    if (row.price == null) s += 50;
    return s;
  };

  const preferredRows = rows.filter((row) => PREFERRED_MENUS.includes(row.menu));
  const bestByGuid = new Map();
  for (const row of preferredRows) {
    if (!row.guid) continue;
    const prev = bestByGuid.get(row.guid);
    if (!prev || score(row) < score(prev)) bestByGuid.set(row.guid, row);
  }
  for (const row of bestByGuid.values()) {
    byGuid.set(row.guid, {
      name: row.name,
      price: row.formattedPrice || formatToastPrice(row.price),
      description: row.description || "",
      menu: row.menu,
      group: row.group,
    });
  }

  const sorted = [...preferredRows].sort((a, b) => score(a) - score(b));
  for (const row of sorted) {
    const key = normalizeDishName(row.name);
    if (!key || byName.has(key)) continue;
    byName.set(key, {
      guid: row.guid,
      name: row.name,
      price: row.formattedPrice || formatToastPrice(row.price),
      description: row.description || "",
      menu: row.menu,
      group: row.group,
    });
  }

  return { byGuid, byName, rows, preferredMenus: PREFERRED_MENUS };
}
