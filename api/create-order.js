
export default async function handler(req, res) {
  try {
    // Allow POST requests only
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");

      return res.status(405).json({
        success: false,
        error: "Method not allowed. Use POST."
      });
    }

    // Confirm the API endpoint is working
    return res.status(200).json({
      success: true,
      message: "FROGINALS API is working!",
      endpoint: "/api/create-order",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("FROGINALS create-order error:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error."
    });
  }
}
