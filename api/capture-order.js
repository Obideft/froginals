async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are not configured.");
  }

  const baseUrl = "https://api-m.sandbox.paypal.com";
  const credentials = Buffer.from(clientId + ":" + clientSecret).toString("base64");

  const response = await fetch(baseUrl + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error("Could not authenticate with PayPal.");
  }

  return { accessToken: data.access_token, baseUrl };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const orderID = req.body && req.body.orderID;
  if (typeof orderID !== "string" || !/^[A-Z0-9]+$/.test(orderID)) {
    return res.status(400).json({ error: "A valid PayPal orderID is required." });
  }

  try {
    const { accessToken, baseUrl } = await getPayPalAccessToken();

    const response = await fetch(baseUrl + "/v2/checkout/orders/" + encodeURIComponent(orderID) + "/capture", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: "{}"
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data && data.message ? data.message : "PayPal could not capture this order."
      });
    }

    if (data.status !== "COMPLETED") {
      return res.status(409).json({
        error: "PayPal has not confirmed a completed capture.",
        status: data.status || "UNKNOWN"
      });
    }

    // Important: this confirms payment capture only. Printful fulfillment is not implemented here.
    return res.status(200).json({
      status: "COMPLETED",
      orderID: data.id
    });
  } catch (error) {
    console.error("PayPal capture error:", error);
    return res.status(500).json({ error: "Server error while capturing PayPal order." });
  }
}
