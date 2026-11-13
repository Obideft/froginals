export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET" });
  }

  const token = process.env.PRINTFUL_API_KEY;
  if (!token) {
    return res.status(500).json({ error: "PRINTFUL_API_KEY is missing in Vercel" });
  }

  // Keep the original products and variants URLs working through one function.
  const resource = String(req.query?.resource || "products");
  const endpoints = {
    products: "https://api.printful.com/sync/products",
    variants: `https://api.printful.com/sync/products/${encodeURIComponent(String(req.query?.product_id || "483655251"))}`
  };
  const endpoint = endpoints[resource];
  if (!endpoint) {
    return res.status(400).json({ error: "Unknown Printful catalogue resource." });
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (!response.ok) {
      console.error("Printful catalogue API error:", resource, response.status);
      return res.status(response.status).json({
        error: resource === "variants" ? "Printful variant lookup failed" : "Printful API request failed",
        details: data
      });
    }

    if (resource === "products" && Array.isArray(data.result)) {
      // Fetch every page so the storefront does not silently omit products after page one.
      const products = [...data.result];
      const paging = data.paging || {};
      const total = Number(paging.total || products.length);
      const pageSize = Math.max(1, Number(paging.limit || products.length || 20));
      let offset = Number(paging.offset || 0) + pageSize;

      while (products.length < total && products.length < 500) {
        const pageResponse = await fetch(
          "https://api.printful.com/sync/products?offset=" + offset + "&limit=" + pageSize,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!pageResponse.ok) {
          console.error("Printful product catalogue pagination failed:", pageResponse.status);
          break;
        }
        const page = await pageResponse.json();
        const items = Array.isArray(page.result) ? page.result : [];
        if (!items.length) break;
        products.push(...items);
        const pagePaging = page.paging || {};
        offset = Number(pagePaging.offset || offset) + Number(pagePaging.limit || pageSize);
      }

      const detailed = await Promise.all(products.map(async item => {
        const detailResponse = await fetch("https://api.printful.com/sync/products/" + encodeURIComponent(String(item.id)), {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!detailResponse.ok) {
          console.error("Printful product detail failed:", item.id, detailResponse.status);
          return { sync_product: item, sync_variants: [] };
        }
        const detail = await detailResponse.json();
        return detail.result || { sync_product: item, sync_variants: [] };
      }));
      return res.status(200).json({ ...data, result: detailed, catalogue_count: products.length });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Printful catalogue request failed:", resource, error.message);
    return res.status(500).json({
      error: resource === "variants" ? "Could not retrieve variants" : "Could not retrieve Printful products"
    });
  }
}
