function xml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function plain(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function previewFor(variant, product) {
  const files = Array.isArray(variant.files) ? variant.files : [];
  const preview = files.find(file => file.type === "preview" && (file.preview_url || file.thumbnail_url)) ||
    files.find(file => file.visible && (file.preview_url || file.thumbnail_url));
  return (preview && (preview.preview_url || preview.thumbnail_url)) || product.thumbnail_url || "";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Use GET");
  }

  const token = process.env.PRINTFUL_API_KEY;
  if (!token) return res.status(503).send("Printful catalogue is not configured.");

  try {
    const headers = { Authorization: "Bearer " + token };
    const listResponse = await fetch("https://api.printful.com/sync/products", { headers });
    const listData = await listResponse.json();
    if (!listResponse.ok || !Array.isArray(listData.result)) {
      console.error("Meta feed: Printful product list failed", listResponse.status);
      return res.status(502).send("Unable to load the Printful product catalogue.");
    }

    const details = await Promise.all(listData.result.map(async item => {
      const response = await fetch("https://api.printful.com/sync/products/" + encodeURIComponent(String(item.id)), { headers });
      if (!response.ok) return null;
      const data = await response.json();
      return data.result || null;
    }));

    const site = "https://froginals-nu.vercel.app";
    const items = [];
    for (const detail of details) {
      if (!detail || !detail.sync_product) continue;
      const product = detail.sync_product;
      const variants = Array.isArray(detail.sync_variants) ? detail.sync_variants : [];
      for (const variant of variants) {
        if (!variant.external_id || !variant.id) continue;
        const price = Number(variant.retail_price || variant.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const image = previewFor(variant, product);
        if (!/^https?:\/\//i.test(image)) continue;

        const color = plain(variant.color);
        const size = plain(variant.size);
        const option = [color, size].filter(Boolean).join(" / ");
        const title = (plain(product.name) + (option ? " - " + option : "")).slice(0, 200);
        const description = (plain(product.description) ||
          (plain(product.name) + " — official FROGINALS merchandise, made to order by Printful.")).slice(0, 9000);
        const availability = variant.availability_status === "active" ? "in stock" : "out of stock";
        const category = /hoodie|sweatshirt|shirt|tee|t-shirt|tank|apparel/i.test(product.name || "")
          ? "FROGINALS > Apparel"
          : /mug|cup|tumbler|bottle/i.test(product.name || "")
            ? "FROGINALS > Drinkware"
            : /sticker|decal/i.test(product.name || "")
              ? "FROGINALS > Stickers"
              : "FROGINALS > Art & Prints";

        items.push(`    <item>
      <g:id>${xml(variant.id)}</g:id>
      <g:title>${xml(title)}</g:title>
      <g:description>${xml(description)}</g:description>
      <g:availability>${availability}</g:availability>
      <g:condition>new</g:condition>
      <g:price>${price.toFixed(2)} USD</g:price>
      <g:link>${xml(site + "/buy.html?product_id=" + encodeURIComponent(product.id))}</g:link>
      <g:image_link>${xml(image)}</g:image_link>
      <g:brand>FROGINALS</g:brand>
      <g:item_group_id>${xml(product.id)}</g:item_group_id>
      ${color ? "<g:color>" + xml(color) + "</g:color>" : ""}
      ${size ? "<g:size>" + xml(size) + "</g:size>" : ""}
      <g:product_type>${xml(category)}</g:product_type>
    </item>`);
      }
    }

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>FROGINALS Official Merch</title>
    <link>${site}/shop.html</link>
    <description>Official FROGINALS apparel and merchandise catalogue.</description>
${items.join("\n")}
  </channel>
</rss>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.setHeader("X-FROGINALS-Catalog-Items", String(items.length));
    return res.status(200).send(body);
  } catch (error) {
    console.error("Meta product feed error:", error);
    return res.status(500).send("Unable to generate the FROGINALS product feed.");
  }
}
