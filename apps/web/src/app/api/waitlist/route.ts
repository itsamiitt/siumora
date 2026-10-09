import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // Browsers submit only to our origin. The API URL stays on the server.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ message: "Invalid request origin." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Enter your name and email address." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ message: "Enter your name and email address." }, { status: 400 });
  }
  const { name, email } = body as Record<string, unknown>;
  if (typeof name !== "string" || typeof email !== "string" ||
      name.trim().length < 1 || name.trim().length > 100 ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ message: "Enter a valid name and email address." }, { status: 400 });
  }

  const medusa = process.env.COMMERCE_BACKEND === "medusa";
  const apiUrl = medusa ? process.env.MEDUSA_URL : process.env.API_URL;
  if (!apiUrl || (medusa && !process.env.MEDUSA_PUBLISHABLE_KEY)) {
    return NextResponse.json({ message: "Signups are unavailable right now. Please try again later." }, { status: 503 });
  }
  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, "")}${medusa ? "/store/siumora/waitlist" : "/waitlist"}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(medusa && process.env.MEDUSA_PUBLISHABLE_KEY
          ? { "x-publishable-api-key": process.env.MEDUSA_PUBLISHABLE_KEY }
          : {}),
      },
      body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      return NextResponse.json({ message: "You're on the list. We'll be in touch when Siumora opens." },
        { headers: { "Cache-Control": "no-store" } });
    }
    const status = response.status === 429 ? 429 : response.status === 400 ? 400 : 503;
    return NextResponse.json({ message: status === 429
      ? "Too many attempts. Please try again in a minute."
      : status === 400 ? "Enter a valid name and email address."
        : "Signups are unavailable right now. Please try again later." }, { status });
  } catch {
    return NextResponse.json({ message: "Signups are unavailable right now. Please try again later." }, { status: 503 });
  }
}
