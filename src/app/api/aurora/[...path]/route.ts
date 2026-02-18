import { NextRequest, NextResponse } from "next/server";

const AURORA_HOST = "https://kilterboardapp.com";
const AURORA_USER_AGENT =
  "Kilter%20Board/202 CFNetwork/1568.100.1 Darwin/24.0.0";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetPath = path.join("/");
  const targetUrl = `${AURORA_HOST}/${targetPath}`;

  try {
    const contentType =
      request.headers.get("Content-Type") || "application/json";
    const body = await request.text();

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": contentType,
      "User-Agent": AURORA_USER_AGENT,
    };

    // Forward auth token as cookie
    const token = request.headers.get("X-Aurora-Token");
    if (token) {
      headers["Cookie"] = `token=${token}`;
    }

    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body,
    });

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`Aurora proxy error [${targetPath}]:`, error);
    return NextResponse.json(
      { error: "Failed to reach Aurora API" },
      { status: 502 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetPath = path.join("/");
  const targetUrl = `${AURORA_HOST}/${targetPath}`;

  try {
    const body = await request.text();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": AURORA_USER_AGENT,
    };

    const token = request.headers.get("X-Aurora-Token");
    if (token) {
      headers["Cookie"] = `token=${token}`;
    }

    const response = await fetch(targetUrl, {
      method: "PUT",
      headers,
      body,
    });

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`Aurora proxy error [${targetPath}]:`, error);
    return NextResponse.json(
      { error: "Failed to reach Aurora API" },
      { status: 502 }
    );
  }
}
