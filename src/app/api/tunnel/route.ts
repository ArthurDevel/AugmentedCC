/**
 * Tunnel URL API Route
 *
 * Returns the current server URL (local HTTPS or tunnel) that the Quest
 * should use to connect. For now, returns the LAN HTTPS URL.
 *
 * - GET /api/tunnel -> { url: "https://<LAN_IP>:3000" }
 */

import { networkInterfaces } from "os";

// ============================================================================
// CONSTANTS
// ============================================================================

const PORT = 3000;

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
 * Returns the LAN HTTPS URL for VR clients to connect to.
 * @returns JSON response with the server URL using the real LAN IP
 */
export async function GET(): Promise<Response> {
  const ip = getLanIp();
  const url = `https://${ip}:${PORT}`;
  return Response.json({ url });
}
