
const VARIANTS = {
  "5586793338": { name: "GOOD MATE Shirt - Black L", price: 14.50 },
  "5586793339": { name: "GOOD MATE Shirt - Black 2XL", price: 17.00 },
  "5586793340": { name: "GOOD MATE Shirt - Black 4XL", price: 22.00 },

  "5586793341": { name: "GOOD MATE Shirt - Orange L", price: 14.50 },
  "5586793342": { name: "GOOD MATE Shirt - Orange 2XL", price: 17.00 },
  "5586793343": { name: "GOOD MATE Shirt - Orange 4XL", price: 22.00 },

  "5586793344": { name: "GOOD MATE Shirt - Cornsilk L", price: 14.50 },
  "5586793345": { name: "GOOD MATE Shirt - Cornsilk 2XL", price: 17.00 },

  "5586793346": { name: "GOOD MATE Shirt - White L", price: 14.50 },
  "5586793347": { name: "GOOD MATE Shirt - White 2XL", price: 17.00 },
  "5586793348": { name: "GOOD MATE Shirt - White 4XL", price: 22.00 }
};

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal environment variables are missing.");
  }

  const credentials = Buffer
    .from(`${clientId}:${clientSecret}`)
    .toString("base64");

  const response = await fetch(
    "https://api-m.sandbox.paypal.com/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error("Could not authenticate with PayPal Sandbox.");
  }

  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Use POST."
    });
  }

  try {
    const { variantId, quantity = 1 } = req.body || {};
    const variant = VARIANTS[String(variantId)];

    if (!variant) {
      return res.status(400).json({
        error: "Invalid shirt variant."
      });
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 5
    ) {
      return res.status(400).json({
        error: "Quantity must be between 1 and 5."
      });
    }

    // Calculate the amount on the server, never trust a browser price.
    const total = (variant.price * quantity).toFixed(2);
    const token = await getAccessToken();

    const paypalResponse = await fetch(
      "https://api-m.sandbox.paypal.com/v2/checkout/orders",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              custom_id: `${variantId}:${quantity}`,
              description: variant.name,
              amount: {
                currency_code: "USD",
                value: total
              }
            }
          ]
        })
      }
    );

    const data = await paypalResponse.json();

    if (!paypalResponse.ok || !data.id) {
      console.error("PayPal create-order failed:", data);
      return res.status(502).json({
        error: "PayPal could not create the test order."
      });
    }

    return res.status(200).json({
      id: data.id
    });
  } catch (error) {
    console.error("Create-order error:", error.message);

    return res.status(500).json({
      error: "Unable to create PayPal test order."
    });
  }
}
