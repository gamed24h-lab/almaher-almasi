exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server Supabase environment variables are missing" }) };
  }
  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_with_passengers`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ p_payload: payload })
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
    if (!response.ok) {
      console.error("Supabase booking error", response.status, data);
      return { statusCode: response.status, headers, body: JSON.stringify({ error: data.message || data.details || data.hint || `Supabase ${response.status}` }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (e) {
    console.error("Booking function error", e);
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message || "Supabase request failed" }) };
  }
};