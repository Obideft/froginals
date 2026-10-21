
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Use GET" });
  }

  const token = process.env.PRINTFUL_API_KEY;

  if (!token) {
    return res.status(500).json({
      error: "Printful API key is missing"
    });
  }

  try {
    const response = await fetch(
      "https://api.printful.com/sync/products/483655251",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Printful variant lookup failed:",
        response.status
      );

      return res.status(response.status).json({
        error: "Printful variant lookup failed",
        details: data
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("Variant lookup error:", error.message);

    return res.status(500).json({
      error: "Could not retrieve variants"
    });
  }
}
