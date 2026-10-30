const VARIANTS = {
  "5586793338": "6ad8a1ec107593",
  "5586793339": "6ad8a1ec1075b7",
  "5586793340": "6ad8a1ec1075d1",
  "5586793341": "6ad8a1ec1075f5",
  "5586793342": "6ad8a1ec107607",
  "5586793343": "6ad8a1ec107615",
  "5586793344": "6ad8a1ec107638",
  "5586793345": "6ad8a1ec107641",
  "5586793346": "6ad8a1ec107656",
  "5586793347": "6ad8a1ec107663",
  "5586793348": "6ad8a1ec107673"
};

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

async function readJson(response) {
  try { return await response.json(); } catch (_) { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const orderID = req.body && req.body.orderID;
  if (typeof orderID !== "string" || !/^[A-Z0-9]+$/.test(orderID)) {
    return res.status(400).json({ error: "A valid PayPal order ID is required." });
  }

  try {
    const accessToken = await getPayPalToken();
    const headers = { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" };
    const orderResponse = await fetch("https://api-m.paypal.com/v2/checkout/orders/" + encodeURIComponent(orderID), { headers });
    const order = await readJson(orderResponse);
    if (!orderResponse.ok || !order.purchase_units || !order.purchase_units[0]) {
      return res.status(404).json({ error: "PayPal order could not be verified." });
    }

    const unit = order.purchase_units[0];
    const parts = String(unit.custom_id || "").split(":");
    const variantId = parts[0];
    const quantity = Number(parts[1]);
    let shippingId;
    try { shippingId = decodeURIComponent(parts.slice(2).join(":")); } catch (_) { shippingId = ""; }
    const externalVariantId = VARIANTS[variantId];
    if (!externalVariantId || !Number.isInteger(quantity) || quantity < 1 || quantity > 5 || !shippingId) {
      return res.status(400).json({ error: "The paid order does not contain valid product details." });
    }

    let capture = order;
    if (order.status !== "COMPLETED") {
      if (order.status !== "APPROVED") {
        return res.status(409).json({ error: "PayPal has not approved this order yet.", status: order.status || "UNKNOWN" });
      }
      const captureResponse = await fetch("https://api-m.paypal.com/v2/checkout/orders/" + encodeURIComponent(orderID) + "/capture", {
        method: "POST",
        headers,
        body: "{}"
      });
      capture = await readJson(captureResponse);
      if (!captureResponse.ok) {
        console.error("PayPal capture failed:", capture);
        return res.status(502).json({ error: "PayPal could not capture the approved payment." });
      }
    }

    if (capture.status !== "COMPLETED") {
      return res.status(409).json({ error: "PayPal has not confirmed a completed payment.", status: capture.status || "UNKNOWN" });
    }

    const capturedUnit = (capture.purchase_units && capture.purchase_units[0]) || unit;
    const captured = capturedUnit.payments && capturedUnit.payments.captures && capturedUnit.payments.captures[0];
    const expectedAmount = Number(unit.amount && unit.amount.value);
    const capturedAmount = Number(captured && captured.amount && captured.amount.value);
    if (!captured || captured.amount.currency_code !== "USD" ||
        !Number.isFinite(expectedAmount) || Math.abs(capturedAmount - expectedAmount) > 0.001) {
      return res.status(409).json({ error: "The captured payment amount could not be verified. Fulfillment was not submitted." });
    }

    const shipping = unit.shipping || capturedUnit.shipping;
    const address = shipping && shipping.address;
    const fullName = shipping && shipping.name && shipping.name.full_name;
    if (!address || !fullName || !address.address_line_1 || !address.admin_area_2 || !address.country_code) {
      return res.status(409).json({ error: "Payment is complete, but the shipping address is incomplete. Contact support with order " + orderID + "." });
    }

    const printfulToken = process.env.PRINTFUL_API_KEY;
    if (!printfulToken) {
      return res.status(202).json({ status: "COMPLETED", fulfillment: "PENDING_CONFIGURATION", orderID });
    }

    const externalId = "paypal_" + orderID;
    const printfulHeaders = { Authorization: "Bearer " + printfulToken, "Content-Type": "application/json" };

    // Printful external IDs are unique per store. Check first so retries do not create a second order.
    const existingResponse = await fetch("https://api.printful.com/orders/@" + encodeURIComponent(externalId), {
      headers: printfulHeaders
    });
    let printfulOrder = null;
    if (existingResponse.ok) {
      const existing = await readJson(existingResponse);
      printfulOrder = existing.result || existing.data || null;
    } else if (existingResponse.status !== 404) {
      const details = await readJson(existingResponse);
      console.error("Printful order lookup failed:", details);
      return res.status(202).json({ status: "COMPLETED", fulfillment: "PENDING_RETRY", orderID });
    }

    if (!printfulOrder) {
      const email = order.payer && order.payer.email_address;
      const phone = order.payer && order.payer.phone && order.payer.phone.phone_number &&
        order.payer.phone.phone_number.national_number;
      const printfulBody = {
        external_id: externalId,
        shipping: shippingId,
        recipient: {
          name: fullName,
          address1: address.address_line_1,
          ...(address.address_line_2 ? { address2: address.address_line_2 } : {}),
          city: address.admin_area_2,
          ...(address.admin_area_1 ? { state_code: address.admin_area_1 } : {}),
          ...(address.postal_code ? { zip: address.postal_code } : {}),
          country_code: address.country_code,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {})
        },
        items: [{ external_variant_id: externalVariantId, quantity }]
      };

      const createResponse = await fetch("https://api.printful.com/orders?confirm=true&update_existing=true", {
        method: "POST",
        headers: printfulHeaders,
        body: JSON.stringify(printfulBody)
      });
      const created = await readJson(createResponse);
      if (!createResponse.ok) {
        console.error("Printful order submission failed:", createResponse.status, created);
        // Recover from a duplicate-external-ID race by reading the unique Printful order.
        const retryResponse = await fetch("https://api.printful.com/orders/@" + encodeURIComponent(externalId), {
          headers: printfulHeaders
        });
        if (retryResponse.ok) {
          const retry = await readJson(retryResponse);
          printfulOrder = retry.result || retry.data || null;
        } else {
          return res.status(202).json({ status: "COMPLETED", fulfillment: "PENDING_RETRY", orderID });
        }
      } else {
        printfulOrder = created.result || created.data || null;
      }
    }

    return res.status(200).json({
      status: "COMPLETED",
      fulfillment: printfulOrder && printfulOrder.status ? printfulOrder.status : "SUBMITTED",
      orderID,
      printfulOrderID: printfulOrder && printfulOrder.id ? printfulOrder.id : null
    });
  } catch (error) {
    console.error("Capture/fulfillment error:", error);
    return res.status(500).json({ error: "Payment or fulfillment status could not be confirmed. Contact support before retrying payment." });
  }
}
