
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Use GET" });
  }

  const token = process.env.PRINTFUL_API_KEY;

  if (!token) {
    return res.status(500).json({
      error: "PRINTFUL_API_KEY is missing in Vercel"
    });
  }

  try {
    const response = await fetch(
      "https://api.printful.com/sync/products",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Printful API request failed",
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Printful products error:", error.message);
    return res.status(500).json({
      error: "Could not retrieve Printful products"
    });
  }
}
