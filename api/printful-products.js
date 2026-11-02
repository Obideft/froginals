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
    variants: "https://api.printful.com/sync/products/483655251"
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

    return res.status(200).json(data);
  } catch (error) {
    console.error("Printful catalogue request failed:", resource, error.message);
    return res.status(500).json({
      error: resource === "variants" ? "Could not retrieve variants" : "Could not retrieve Printful products"
    });
  }
}
