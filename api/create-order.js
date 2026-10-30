const VARIANTS = {
  "5586793338": { name: "GOOD MATE Shirt - Black L", externalId: "6ad8a1ec107593", price: 14.50 },
  "5586793339": { name: "GOOD MATE Shirt - Black 2XL", externalId: "6ad8a1ec1075b7", price: 17.00 },
  "5586793340": { name: "GOOD MATE Shirt - Black 4XL", externalId: "6ad8a1ec1075d1", price: 22.00 },
  "5586793341": { name: "GOOD MATE Shirt - Orange L", externalId: "6ad8a1ec1075f5", price: 14.50 },
  "5586793342": { name: "GOOD MATE Shirt - Orange 2XL", externalId: "6ad8a1ec107607", price: 17.00 },
  "5586793343": { name: "GOOD MATE Shirt - Orange 4XL", externalId: "6ad8a1ec107615", price: 22.00 },
  "5586793344": { name: "GOOD MATE Shirt - Cornsilk L", externalId: "6ad8a1ec107638", price: 14.50 },
  "5586793345": { name: "GOOD MATE Shirt - Cornsilk 2XL", externalId: "6ad8a1ec107641", price: 17.00 },
  "5586793346": { name: "GOOD MATE Shirt - White L", externalId: "6ad8a1ec107656", price: 14.50 },
  "5586793347": { name: "GOOD MATE Shirt - White 2XL", externalId: "6ad8a1ec107663", price: 17.00 },
  "5586793348": { name: "GOOD MATE Shirt - White 4XL", externalId: "6ad8a1ec107673", price: 22.00 }
};

function clean(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function getPayPalToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal LIVE credentials are not configured.");
  const credentials = Buffer.from(id + ":" + secret).toString("base64");
  const response = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("PayPal LIVE authentication failed.");
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const body = req.body || {};
    const variantId = String(body.variantId || "");
    const variant = VARIANTS[variantId];
    const quantity = Number(body.quantity || 1);
    const shippingId = clean(body.shippingId, 40);
    const raw = body.recipient || {};
    const recipient = {
      name: clean(raw.name, 100),
      address1: clean(raw.address1, 120),
      address2: clean(raw.address2, 120),
      city: clean(raw.city, 80),
      state_code: clean(raw.state_code, 30).toUpperCase(),
      country_code: clean(raw.country_code, 2).toUpperCase(),
      zip: clean(raw.zip, 20)
    };
    const email = clean(raw.email, 160);
    const phone = clean(raw.phone, 40);

    if (!variant) return res.status(400).json({ error: "Invalid shirt variant." });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) {
      return res.status(400).json({ error: "Quantity must be between 1 and 5." });
    }
    if (!shippingId || !recipient.name || !recipient.address1 || !recipient.city ||
        !/^[A-Z]{2}$/.test(recipient.country_code)) {
      return res.status(400).json({ error: "Complete your shipping address and select a shipping method." });
    }
    if (["US", "CA", "AU"].includes(recipient.country_code) && !recipient.state_code) {
      return res.status(400).json({ error: "A state or province code is required for this destination." });
    }

    // Requote on the server immediately before creating the payment.
    const printfulResponse = await fetch("https://api.printful.com/shipping/rates", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.PRINTFUL_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient,
        items: [{
          external_variant_id: variant.externalId,
          quantity,
          value: variant.price.toFixed(2)
        }],
        currency: "USD",
        locale: "en_US"
      })
    });
    const printfulData = await printfulResponse.json();
    if (!printfulResponse.ok || !Array.isArray(printfulData.result)) {
      console.error("Printful requote failed:", printfulResponse.status, printfulData);
      return res.status(502).json({ error: "Shipping could not be reconfirmed. Please calculate shipping again." });
    }
    const selectedRate = printfulData.result.find(rate =>
      String(rate.id) === shippingId && rate.currency === "USD" && Number.isFinite(Number(rate.rate))
    );
    if (!selectedRate) {
      return res.status(409).json({ error: "That shipping option has changed. Please calculate shipping again." });
    }

    const itemTotal = variant.price * quantity;
    const shippingTotal = Number(selectedRate.rate);
    const total = (itemTotal + shippingTotal).toFixed(2);
    const accessToken = await getPayPalToken();
    const paypalResponse = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          custom_id: [variantId, quantity, encodeURIComponent(shippingId)].join(":"),
          description: variant.name,
          amount: {
            currency_code: "USD",
            value: total,
            breakdown: {
              item_total: { currency_code: "USD", value: itemTotal.toFixed(2) },
              shipping: { currency_code: "USD", value: shippingTotal.toFixed(2) }
            }
          },
          shipping: {
            name: { full_name: recipient.name },
            address: {
              address_line_1: recipient.address1,
              ...(recipient.address2 ? { address_line_2: recipient.address2 } : {}),
              admin_area_2: recipient.city,
              ...(recipient.state_code ? { admin_area_1: recipient.state_code } : {}),
              ...(recipient.zip ? { postal_code: recipient.zip } : {}),
              country_code: recipient.country_code
            }
          }
        }]
      })
    });
    const paypalData = await paypalResponse.json();
    if (!paypalResponse.ok || !paypalData.id) {
      console.error("PayPal LIVE create-order failed:", paypalData);
      return res.status(502).json({ error: "PayPal could not create the payment. No charge was made." });
    }

    return res.status(200).json({
      id: paypalData.id,
      total,
      shipping: shippingTotal.toFixed(2),
      shippingName: selectedRate.name
    });
  } catch (error) {
    console.error("Create-order error:", error);
    return res.status(500).json({ error: "Unable to start secure checkout." });
  }
}
