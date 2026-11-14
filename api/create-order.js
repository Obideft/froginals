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
  "5586793348": { name: "GOOD MATE Shirt - White 4XL", externalId: "6ad8a1ec107673", price: 22.00 },
  "5626427516": { name: "FROGINAL DEGEN CLUB - M", externalId: "6aef6be4297445", price: 23.50 },
  "5626427517": { name: "FROGINAL DEGEN CLUB - 2XL", externalId: "6aef6be4297468", price: 26.00 },
  "5626425606": { name: "THE SWAMP IS CALLING - M", externalId: "6aef6b58463de5", price: 23.50 },
  "5626425607": { name: "THE SWAMP IS CALLING - 2XL", externalId: "6aef6b58463e03", price: 26.00 },
  "5626423150": { name: "THE SWAMP LEGEND - M", externalId: "6aef6aa183f419", price: 29.99 },
  "5626423151": { name: "THE SWAMP LEGEND - 2XL", externalId: "6aef6aa183f433", price: 29.99 }
};



import crypto from "node:crypto";
function decodeBase58(value) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of value) { const digit = alphabet.indexOf(ch); if (digit < 0) throw new Error("Invalid wallet address."); n = n * 58n + BigInt(digit); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of value) { if (ch !== "1") break; bytes.unshift(0); }
  return Buffer.from(bytes);
}
function verifyHolderSignature(wallet, message, signature) {
  if (typeof message !== "string" || typeof signature !== "string" || signature.length > 256) return false;
  const expectedPrefix = "FROGINALS GOOD MATE HOLDER DISCOUNT\nDomain: froginals-nu.vercel.app\nWallet: " + wallet + "\nTimestamp: ";
  if (!message.startsWith(expectedPrefix)) return false;
  const timestampText = message.slice(expectedPrefix.length);
  if (!/^\d{13}$/.test(timestampText)) return false;
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) return false;
  try {
    const publicKey = decodeBase58(wallet);
    const sig = Buffer.from(signature, "base64");
    if (publicKey.length !== 32 || sig.length !== 64) return false;
    const derPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const key = crypto.createPublicKey({ key: Buffer.concat([derPrefix, publicKey]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(message, "utf8"), key, sig);
  } catch (_) { return false; }
}

const FROGINAL_COLLECTION_ADDRESS = process.env.FROGINAL_COLLECTION_ADDRESS || "DEADY34TucemEebp6PJwmggAGDUmpSMoS4CcESKNBPRh";
const GOOD_MATE_VARIANTS = new Set([
  "5586793338","5586793339","5586793340","5586793341","5586793342",
  "5586793343","5586793344","5586793345","5586793346","5586793347","5586793348"
]);
function isWalletAddress(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of value) { const digit = alphabet.indexOf(ch); if (digit < 0) return false; n = n * 58n + BigInt(digit); }
  let bytes = 0; while (n > 0n) { n >>= 8n; bytes++; }
  for (const ch of value) { if (ch !== "1") break; bytes++; }
  return bytes === 32;
}
async function countFroginalDogs(wallet) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error("NFT verification is not configured.");
  let count = 0;
  const maxPages = 10, pageSize = 1000;
  for (let page = 1; page <= maxPages; page++) {
    const response = await fetch("https://mainnet.helius-rpc.com/?api-key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "froginals-good-mate-discount",
        method: "getAssetsByOwner",
        params: { ownerAddress: wallet, page, limit: pageSize,
          displayOptions: { showFungible: false, showUnverifiedCollections: true, showCollectionMetadata: true } }
      })
    });
    if (!response.ok) throw new Error("NFT ownership service is unavailable.");
    const payload = await response.json();
    const result = payload.result;
    if (payload.error || !result) throw new Error("NFT ownership could not be verified.");
    const items = Array.isArray(result.items) ? result.items : (Array.isArray(result) ? result : null);
    if (!items) throw new Error("NFT ownership response was incomplete.");
    for (const asset of items) {
      const collection = (Array.isArray(asset?.grouping) ? asset.grouping : []).find(g => g?.group_key === "collection");
      if (asset && asset.burnt !== true && asset.ownership?.owner === wallet &&
          collection?.group_value === FROGINAL_COLLECTION_ADDRESS && collection?.verified === true) count++;
    }
    if (items.length < pageSize || (Number.isFinite(result.total) && page * pageSize >= result.total)) return count;
  }
  throw new Error("NFT ownership check reached its page limit; discount cannot be confirmed.");
}
function holderDiscount(count) {
  return count >= 5 ? 0.20 : count >= 2 ? 0.15 : count >= 1 ? 0.10 : 0;
}

function clean(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function getLivePrintfulVariant(variantId) {
  const token = process.env.PRINTFUL_API_KEY;
  if (!token) throw new Error("PRINTFUL_API_KEY is not configured.");
  const response = await fetch("https://api.printful.com/sync/variant/" + encodeURIComponent(variantId), {
    headers: { Authorization: "Bearer " + token }
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  const info = data.result && (data.result.sync_variant || data.result);
  const externalId = info && info.external_id;
  const price = Number(info && info.retail_price);
  if (!response.ok || !info || !externalId || !Number.isFinite(price) || price <= 0 ||
      info.availability_status !== "active") {
    throw new Error("This Printful product option is unavailable for checkout.");
  }
  return {
    name: info.name || (info.product && info.product.name) || ("FROGINALS product " + variantId),
    externalId: String(externalId),
    price
  };
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


async function createCartPayPalOrder(body, res) {
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 5) return res.status(400).json({ error: "Your cart must contain between 1 and 5 different products." });
  const shippingId = clean(body.shippingId, 40);
  const raw = body.recipient || {};
  const recipient = {
    name: clean(raw.name, 100), address1: clean(raw.address1, 120), address2: clean(raw.address2, 120),
    city: clean(raw.city, 80), state_code: clean(raw.state_code, 30).toUpperCase(),
    country_code: clean(raw.country_code, 2).toUpperCase(), zip: clean(raw.zip, 20)
  };
  if (!shippingId || !recipient.name || !recipient.address1 || !recipient.city || !/^[A-Z]{2}$/.test(recipient.country_code)) return res.status(400).json({ error: "Complete your shipping address and select a shipping method." });
  if (["US", "CA", "AU"].includes(recipient.country_code) && !recipient.state_code) return res.status(400).json({ error: "A state or province code is required for this destination." });

  const items = [];
  let totalQuantity = 0;
  for (const rawItem of rawItems) {
    const variantId = String(rawItem && rawItem.variantId || "");
    const quantity = Number(rawItem && rawItem.quantity || 1);
    if (!/^\d{1,20}$/.test(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 5) return res.status(400).json({ error: "A cart item has an invalid product option or quantity." });
    totalQuantity += quantity;
    if (totalQuantity > 10) return res.status(400).json({ error: "Your cart can contain up to 10 items in total." });
    let variant = VARIANTS[variantId];
    if (!variant) {
      try { variant = await getLivePrintfulVariant(variantId); }
      catch (error) { return res.status(400).json({ error: error.message || "A cart product is unavailable." }); }
    }
    items.push({ variantId, quantity, name: variant.name, externalId: String(variant.externalId), price: Number(variant.price) });
  }

  const walletAddress = clean(body.wallet_address, 44);
  const walletMessage = typeof body.wallet_message === "string" ? body.wallet_message : "";
  const walletSignature = typeof body.wallet_signature === "string" ? body.wallet_signature : "";
  let nftCount = 0, discountRate = 0;
  if (walletAddress) {
    if (!isWalletAddress(walletAddress)) return res.status(400).json({ error: "Reconnect a valid Solana wallet to verify your holder discount." });
    if (!verifyHolderSignature(walletAddress, walletMessage, walletSignature)) return res.status(401).json({ error: "Wallet signature is missing or expired. Reconnect your wallet and approve the holder verification message." });
    if (items.some(item => GOOD_MATE_VARIANTS.has(item.variantId))) {
      try { nftCount = await countFroginalDogs(walletAddress); discountRate = holderDiscount(nftCount); }
      catch (error) { console.error("Holder discount verification failed:", error.message); return res.status(503).json({ error: "FROGINAL DOGS ownership could not be verified. Please try again or checkout without the holder discount." }); }
    }
  }

  const printfulResponse = await fetch("https://api.printful.com/shipping/rates", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.PRINTFUL_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient, items: items.map(item => ({ external_variant_id: item.externalId, quantity: item.quantity, value: item.price.toFixed(2) })), currency: "USD", locale: "en_US" })
  });
  const printfulData = await printfulResponse.json();
  if (!printfulResponse.ok || !Array.isArray(printfulData.result)) {
    console.error("Printful cart requote failed:", printfulResponse.status, printfulData);
    return res.status(502).json({ error: "Shipping could not be reconfirmed. Please calculate shipping again." });
  }
  const selectedRate = printfulData.result.find(rate => String(rate.id) === shippingId && rate.currency === "USD" && Number.isFinite(Number(rate.rate)));
  if (!selectedRate) return res.status(409).json({ error: "That shipping option has changed. Please calculate shipping again." });

  let subtotal = 0, discountAmount = 0;
  const paypalItems = items.map(item => {
    const lineSubtotal = item.price * item.quantity;
    const lineDiscount = GOOD_MATE_VARIANTS.has(item.variantId) ? Number((lineSubtotal * discountRate).toFixed(2)) : 0;
    subtotal += lineSubtotal;
    discountAmount += lineDiscount;
    const unitPrice = Number((item.price * (1 - (GOOD_MATE_VARIANTS.has(item.variantId) ? discountRate : 0))).toFixed(2));
    return { name: String(item.name || "FROGINALS product").slice(0, 127), quantity: String(item.quantity), unit_amount: { currency_code: "USD", value: unitPrice.toFixed(2) } };
  });
  discountAmount = Number(discountAmount.toFixed(2));
  const discountedSubtotal = Number((subtotal - discountAmount).toFixed(2));
  const shippingTotal = Number(selectedRate.rate);
  const total = (discountedSubtotal + shippingTotal).toFixed(2);
  const compactItems = items.map(item => item.variantId + "." + item.quantity).join(",");
  const customId = "C1~" + compactItems + "~" + encodeURIComponent(shippingId);
  if (customId.length > 127) return res.status(400).json({ error: "Your cart is too large to process. Remove an item and try again." });

  const accessToken = await getPayPalToken();
  const paypalResponse = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
    method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{
      custom_id: customId, description: "FROGINALS cart — " + totalQuantity + " item(s)",
      amount: { currency_code: "USD", value: total, breakdown: {
        item_total: { currency_code: "USD", value: discountedSubtotal.toFixed(2) },
        shipping: { currency_code: "USD", value: shippingTotal.toFixed(2) }
      }},
      shipping: { name: { full_name: recipient.name }, address: {
        address_line_1: recipient.address1, ...(recipient.address2 ? { address_line_2: recipient.address2 } : {}),
        admin_area_2: recipient.city, ...(recipient.state_code ? { admin_area_1: recipient.state_code } : {}),
        ...(recipient.zip ? { postal_code: recipient.zip } : {}), country_code: recipient.country_code
      }}
    }]})
  });
  const paypalData = await paypalResponse.json();
  if (!paypalResponse.ok || !paypalData.id) {
    console.error("PayPal LIVE cart create-order failed:", paypalData);
    return res.status(502).json({ error: "PayPal could not create the payment. No charge was made." });
  }
  return res.status(200).json({ id: paypalData.id, total, shipping: shippingTotal.toFixed(2), subtotal: subtotal.toFixed(2),
    discount: discountAmount.toFixed(2), discountRate, nftCount, discountedSubtotal: discountedSubtotal.toFixed(2), shippingName: selectedRate.name });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const body = req.body || {};
    if (Array.isArray(body.items)) return await createCartPayPalOrder(body, res);
    const variantId = String(body.variantId || "");
    let variant = VARIANTS[variantId];
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
    const walletAddress = clean(body.wallet_address, 44);
    const walletMessage = typeof body.wallet_message === "string" ? body.wallet_message : "";
    const walletSignature = typeof body.wallet_signature === "string" ? body.wallet_signature : "";
    const phone = clean(raw.phone, 40);

    if (!variant) {
      try {
        variant = await getLivePrintfulVariant(variantId);
      } catch (error) {
        return res.status(400).json({ error: error.message || "Invalid or unavailable product option." });
      }
    }
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

    // Holder discounts apply only to the FROGINALS GOOD MATE shirt. Verify the wallet on the server.
    let nftCount = 0;
    let discountRate = 0;
    if (walletAddress) {
      if (!isWalletAddress(walletAddress)) return res.status(400).json({ error: "Reconnect a valid Solana wallet to verify your holder discount." });
      if (!verifyHolderSignature(walletAddress, walletMessage, walletSignature)) return res.status(401).json({ error: "Wallet signature is missing or expired. Reconnect your wallet and approve the holder verification message." });
      if (GOOD_MATE_VARIANTS.has(variantId)) {
        try { nftCount = await countFroginalDogs(walletAddress); discountRate = holderDiscount(nftCount); }
        catch (error) { console.error("Holder discount verification failed:", error.message); return res.status(503).json({ error: "FROGINAL DOGS ownership could not be verified. Please try again or disconnect your wallet to checkout without a holder discount." }); }
      }
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
    const discountAmount = Number((itemTotal * discountRate).toFixed(2));
    const discountedItemTotal = Number((itemTotal - discountAmount).toFixed(2));
    const shippingTotal = Number(selectedRate.rate);
    const total = (discountedItemTotal + shippingTotal).toFixed(2);
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
          custom_id: [variantId, quantity, encodeURIComponent(shippingId), encodeURIComponent(variant.externalId)].join(":"),
          description: variant.name,
          amount: {
            currency_code: "USD",
            value: total,
            breakdown: {
              item_total: { currency_code: "USD", value: discountedItemTotal.toFixed(2) },
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
      subtotal: itemTotal.toFixed(2),
      discount: discountAmount.toFixed(2),
      discountRate,
      nftCount,
      discountedSubtotal: discountedItemTotal.toFixed(2),
      shippingName: selectedRate.name
    });
  } catch (error) {
    console.error("Create-order error:", error);
    return res.status(500).json({ error: "Unable to start secure checkout." });
  }
}
