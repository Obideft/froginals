
export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use POST."
    });
  }

  return res.status(200).json({
    success: true,
    message: "FROGINALS create-order API is working!",
    note: "Test endpoint only. No payment or Printful order has been created."
  });
}
