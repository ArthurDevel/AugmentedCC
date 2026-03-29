# Quest 3 AR Desktop — Architecture Plan

## Project Overview

A mixed reality desktop for Meta Quest 3. The user sees floating browser panels in their real environment via AR passthrough. A headless Chrome browser renders a desktop page (with iframes for web content), and the server streams transparent PNG screenshots to the Quest over WebSocket. The Quest renders these as a curved panel texture in Three.js WebXR. Interaction flows back: controller clicks are sent to the server and forwarded to headless Chrome as real mouse events. Audio from the Quest mic is streamed to the server, decoded with ffmpeg, and visualized on the desktop.

## File Tree

```
amsterdam/
├── app/
│   ├── VRShell.tsx              # Three.js WebXR client — curved panel, WS frame receiver, input sender, mic capture
│   ├── page.tsx                 # Landing page with QR code for Quest to scan
│   ├── layout.tsx               # Root layout
│   ├── globals.css
│   ├── desktop/
│   │   └── page.tsx             # Virtual desktop — dynamic iframe panels, audio meter, rendered by headless Chrome
│   ├── api/
│   │   ├── qr/route.ts          # QR code generator for the tunnel/local URL
│   │   └── tunnel/route.ts      # Returns the current tunnel or local HTTPS URL
│   └── test/
│       └── page.tsx             # Test page
├── server/
│   └── server.ts                # Custom Node.js server: Next.js + Puppeteer + WebSocket + audio pipeline
├── certs/
│   ├── cert.pem                 # mkcert TLS certificate (localhost + LAN IP)
│   └── key.pem                  # mkcert TLS key
├── .docs/
│   ├── summary.md               # System diagram and technical docs
│   └── learnings.md             # Quest 3 WebXR gotchas and debugging notes
├── package.json
├── next.config.ts
├── tsconfig.json
└── CLAUDE.md
```

## System Architecture

`server/server.ts` is a single process on a single port that does three things:

1. **Serves the Next.js app** — all HTTP requests (pages, API routes, static assets) go through Next.js. The Quest browser loads the app from here.
2. **Runs headless Chrome** — on startup, Puppeteer launches Chrome and navigates to the server's own `/desktop` route. The server is both serving the desktop page AND consuming it as a headless browser client.
3. **Bridges VR ↔ Chrome** — two WebSocket endpoints (`/ws/screencast`, `/ws/audio`) on the same port relay screenshots, input events, and audio between the Quest and headless Chrome.

### Data Flow

```
Quest 3 Browser (VRShell.tsx)
    │                    ▲
    │ click/mouse JSON   │ binary PNG frames (with alpha)
    │ audio binary       │ audio level JSON
    ▼                    │
Node.js Server (server.ts)
    │                    ▲
    │ CDP Input.dispatch │ CDP Page.captureScreenshot
    │ ffmpeg stdin       │ ffmpeg stdout (PCM → RMS)
    ▼                    │
Headless Chrome (Puppeteer)
    │
    └── renders /desktop (React page with iframes)
```

### Component Responsibilities

| Component | File | Role |
|---|---|---|
| **VR Client** | `app/VRShell.tsx` | Three.js + WebXR `immersive-ar`. Renders curved CylinderGeometry panel with CanvasTexture. Receives PNG frames over WS, sends input events back. Captures mic and streams audio. |
| **Server** | `server/server.ts` | Runs Next.js, Puppeteer, and two WebSocket servers (screencast + audio). Bridges VR input to Chrome via CDP. Decodes audio with ffmpeg. |
| **Desktop Page** | `app/desktop/page.tsx` | React page with dynamic add/remove iframe panels. Transparent background for AR passthrough. Audio level meter. This is what headless Chrome renders. |
| **Landing Page** | `app/page.tsx` | Shows QR code so the Quest can scan and open the app URL. |

## Screenshot Streaming Pipeline

1. Puppeteer opens `/desktop` at **3840×1080** in headless Chrome
2. `Emulation.setDefaultBackgroundColorOverride` sets `rgba(0,0,0,0)` for true transparency
3. Tight loop: `Page.captureScreenshot` with `format: "png"` and `omitBackground: true`
4. Base64 → Buffer, skip identical frames, send as binary WebSocket to VR clients
5. VR client: `createImageBitmap()` → draw to offscreen canvas → `texture.needsUpdate = true`

**Transparency chain**: Chrome transparent background + `omitBackground: true` → PNG with alpha channel → Three.js material with `transparent: true` → passthrough shows through alpha=0 areas.

## Curved Panel Rendering

The VR panel is a `CylinderGeometry` rendered from the inside (`BackSide`):
- **Radius**: 1.6m (distance from user)
- **Arc**: ~144° (`Math.PI * 0.8`)
- **Height**: 0.9m
- **Segments**: 64
- **UV flip**: inside face has mirrored UVs — manually flip with `uvAttr.setX(i, 1 - uvAttr.getX(i))`
- **Centering**: `thetaStart = Math.PI - arc/2` places the panel in front (-Z)

Texture must be created **before** XR session starts (Quest Browser drops textures created after XR init).

## Input Forwarding

1. VR controller raycasts against the curved mesh
2. Hit UV coordinates → pixel coordinates (u × 3840, v × 1080)
3. Sent as JSON `{ type: "click"|"mousemove"|"scroll", x, y }` over screencast WS
4. Server calls CDP `Input.dispatchMouseEvent` on headless Chrome
5. Chrome processes as real mouse events — clicks, hovers, scrolls work natively

## Audio Pipeline

1. **Quest**: `getUserMedia({ audio: true })` → `MediaRecorder` (webm/opus, 64kbps) → binary chunks every 100ms over `/ws/audio?role=producer`
2. **Server**: each producer spawns its own **ffmpeg** process: `webm/opus → pcm_f32le, mono, 16kHz`. RMS computed from PCM samples, broadcast as JSON `{ type: "level", rms }` at 10Hz to consumers.
3. **Desktop**: `AudioMeter` component connects as consumer, reads JSON levels, renders live meter bar.

## Desktop Page (Virtual Monitor)

The desktop page is a normal React page. It renders at whatever viewport Puppeteer gives it (currently 3840×1080). Features:
- **Dynamic panels**: add/remove iframe panels via buttons
- **Auto-layout**: flex with `flex: 1 1 0` and `maxWidth: 1400px` — panels shrink to fit as more are added
- **Transparent gaps**: `html, body { background: transparent }` + gap between panels → alpha=0 in screenshots → AR passthrough
- **Audio meter**: bottom-right corner, shows live mic level from the Quest

Any React component works here — it's rendered by a real Chrome browser.

## HTTPS for WebXR

Quest Browser requires HTTPS for WebXR. Two options:

1. **Local mkcert** (preferred): generate certs for `localhost + LAN IP`, push root CA to Quest via ADB. All traffic stays on LAN.
2. **Cloudflare Quick Tunnel** (fallback): `cloudflared tunnel --url http://localhost:3000`. Public URL, valid TLS, but bandwidth-limited for large PNG frames.

## Key Constraints

1. **CanvasTexture timing**: textures must exist before XR session starts. Update existing canvas pixels + `needsUpdate = true` works fine mid-XR.
2. **PNG transparency**: requires three things aligned — `omitBackground: true`, CSS `background: transparent` on html/body, and `transparent: true` on Three.js material.
3. **CylinderGeometry params**: 8 positional args, no named params. Double-check order: `(radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength)`.
4. **Per-producer ffmpeg**: each audio producer needs its own ffmpeg instance. Sharing one corrupts the WebM stream.
5. **Node.js Buffer alignment**: copy to fresh `Uint8Array` before creating `Float32Array` from PCM data.
