export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET." });
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "PAYPAL_CLIENT_ID is not configured in Vercel." });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ clientId });
}
