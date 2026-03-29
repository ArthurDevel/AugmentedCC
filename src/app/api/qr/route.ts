/**
 * QR Code API Route
 *
 * Generates a QR code PNG image for the current server URL. The Quest scans
 * this to open the VR shell page.
 *
 * - GET /api/qr -> PNG image of QR code pointing to the server URL
 */

import { networkInterfaces } from "os";
import QRCode from "qrcode";

// ============================================================================
// CONSTANTS
// ============================================================================

const PORT = 3000;
const QR_WIDTH = 512;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Finds the first non-internal IPv4 address on the machine.
 * @returns The LAN IP address, or "localhost" if none found
 */
function getLanIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// ============================================================================
// ENDPOINT
// ============================================================================

/**
 * Generates a QR code PNG for the LAN server URL.
 * @returns PNG image response
 */
export async function GET(): Promise<Response> {
  const url = `https://${getLanIp()}:${PORT}`;
  const pngBuffer = await QRCode.toBuffer(url, {
    width: QR_WIDTH,
    margin: 2,
    type: "png",
  });

  return new Response(new Uint8Array(pngBuffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-cache",
    },
  });
}
