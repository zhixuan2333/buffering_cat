interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const FIRMWARE_PATH =
  /^\/zhixuan2333\/buffering_cat\/releases\/download\/[A-Za-z0-9._-]+\/(buffering-cat-v1\.[01]-[A-Za-z0-9._-]+\.bin)$/;
const MAX_FIRMWARE_BYTES = 16 * 1024;

function errorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function downloadFirmware(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  const source = new URL(request.url).searchParams.get("url");
  let assetUrl: URL;
  try {
    assetUrl = new URL(source ?? "");
  } catch {
    return errorResponse("Invalid firmware asset", 400);
  }
  const pathMatch = assetUrl.pathname.match(FIRMWARE_PATH);
  if (
    assetUrl.origin !== "https://github.com" ||
    assetUrl.search ||
    assetUrl.hash ||
    !pathMatch
  ) {
    return errorResponse("Asset is not a Buffering Cat firmware image", 400);
  }

  const firmwareResponse = await fetch(assetUrl);
  if (!firmwareResponse.ok || !firmwareResponse.body) {
    return errorResponse("Firmware download failed", firmwareResponse.status || 502);
  }
  const contentLength = Number(firmwareResponse.headers.get("content-length"));
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > MAX_FIRMWARE_BYTES
  ) {
    await firmwareResponse.body.cancel();
    return errorResponse("Invalid firmware size", 502);
  }

  return new Response(firmwareResponse.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(contentLength),
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": `attachment; filename="${pathMatch[1]}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/api/firmware") {
      return downloadFirmware(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export default worker;
