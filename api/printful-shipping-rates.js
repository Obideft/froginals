const VARIANTS = {
  "5586793338": { externalId: "6ad8a1ec107593", price: 14.50 },
  "5586793339": { externalId: "6ad8a1ec1075b7", price: 17.00 },
  "5586793340": { externalId: "6ad8a1ec1075d1", price: 22.00 },
  "5586793341": { externalId: "6ad8a1ec1075f5", price: 14.50 },
  "5586793342": { externalId: "6ad8a1ec107607", price: 17.00 },
  "5586793343": { externalId: "6ad8a1ec107615", price: 22.00 },
  "5586793344": { externalId: "6ad8a1ec107638", price: 14.50 },
  "5586793345": { externalId: "6ad8a1ec107641", price: 17.00 },
  "5586793346": { externalId: "6ad8a1ec107656", price: 14.50 },
  "5586793347": { externalId: "6ad8a1ec107663", price: 17.00 },
  "5586793348": { externalId: "6ad8a1ec107673", price: 22.00 }
};

function clean(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const token = process.env.PRINTFUL_API_KEY;
  if (!token) {
    return res.status(503).json({ error: "Printful shipping is not configured yet." });
  }

  try {
    const body = req.body || {};
    const variantId = String(body.variantId || "");
    const variant = VARIANTS[variantId];
    const quantity = Number(body.quantity || 1);
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

    if (!variant) return res.status(400).json({ error: "Invalid shirt variant." });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) {
      return res.status(400).json({ error: "Quantity must be between 1 and 5." });
    }
    if (!recipient.name || !recipient.address1 || !recipient.city || !/^[A-Z]{2}$/.test(recipient.country_code)) {
      return res.status(400).json({ error: "Enter your name, street address, city and 2-letter country code." });
    }
    if (["US", "CA", "AU"].includes(recipient.country_code) && !recipient.state_code) {
      return res.status(400).json({ error: "A state or province code is required for this destination." });
    }

    const response = await fetch("https://api.printful.com/shipping/rates", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
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

    const data = await response.json();
    if (!response.ok || !Array.isArray(data.result)) {
      console.error("Printful shipping-rate error:", response.status, data);
      return res.status(502).json({ error: "Printful could not calculate shipping for this address." });
    }

    const rates = data.result
      .filter(rate => rate && rate.id && Number.isFinite(Number(rate.rate)) && rate.currency === "USD")
      .map(rate => ({
        id: String(rate.id),
        name: String(rate.name || rate.id),
        rate: Number(rate.rate).toFixed(2),
        currency: "USD",
        minDeliveryDays: rate.minDeliveryDays || null,
        maxDeliveryDays: rate.maxDeliveryDays || null
      }));

    if (!rates.length) {
      return res.status(422).json({ error: "No USD shipping options are available for this destination." });
    }

    return res.status(200).json({ rates });
  } catch (error) {
    console.error("Printful shipping calculation failed:", error);
    return res.status(500).json({ error: "Unable to calculate shipping right now." });
  }
}
