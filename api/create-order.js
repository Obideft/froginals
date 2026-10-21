
export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed. Use POST."
    });
  }

  return res.status(200).json({
    success: true,
    message: "FROGINALS API is working!"
  });
}

