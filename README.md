# Ổ Bánh Mì

Astro site for [o-banhmi.com](https://o-banhmi.com), modeled on the Speranza layout. Menu lives in local JSON. Toast prices, stock, and online ordering hook up when those credentials exist.

## Local development

```bash
npm install
npm run dev
```

Edit restaurant info in `src/data/site.json` and dishes in `src/data/menu/`.

Hours in `site.json` are a placeholder until the full schedule is confirmed.

## Ordering

`site.links.order` is empty for now. The Order bar and hero CTA call the shop phone. When Toast Online Ordering is live, put that URL in `site.links.order` (or later `https://order.o-banhmi.com/`).

## Toast (later)

Copy `.env.example` to `.env` and fill in:

```
TOAST_CLIENT_ID=
TOAST_CLIENT_SECRET=
TOAST_RESTAURANT_GUID=
TOAST_API_HOST=https://ws-api.toasttab.com
```

The API client also needs the `stock:read` scope so 86'd items can be hidden.

```bash
npm run toast:dump
```

That writes `src/data/toast-menu.json`. Copy matching `toastGuid` values onto items in `src/data/menu/*.json`. Add name aliases in `src/lib/toast.ts` if Toast labels differ from the website.

The homepage is server-rendered so Toast prices stay fresh once credentials are set on Vercel.

## Hosting

Deploy to Vercel first on a `*.vercel.app` URL. Leave the live Owner.com site on `o-banhmi.com` until this one is ready.

1. Create a Vercel project from this repo.
2. Add the domain `o-banhmi.com` and `www.o-banhmi.com` in Vercel.
3. At Dreamhost DNS (keep the domain registered there):
   - `@` A record → `76.76.21.21`
   - `www` CNAME → `cname.vercel-dns.com`
4. Optional later: `order.o-banhmi.com` CNAME to Toast’s Online Ordering host.
5. `/menu` redirects to `/#menu` so old Owner.com links still work.

Do not move the registrar off Dreamhost. Only change DNS records.
