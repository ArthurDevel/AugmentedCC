/**
 * VRShell -- Quest 3 AR Desktop Client
 *
 * Three.js WebXR component that renders the headless Chrome desktop as a curved
 * panel in augmented reality. Uses Three.js XRButton for session management.
 *
 * - WebXR session via XRButton (handles availability, lifecycle, errors)
 * - Curved CylinderGeometry panel textured from an offscreen canvas
 * - WebSocket receiver for PNG screenshot frames (with reconnect)
 * - Two controllers with visible rays and cursor dot
 * - Input forwarding: controller raycast hits converted to mouse events
 * - Mic capture and audio streaming to the server via WebSocket
 */
"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { XRButton } from "three/addons/webxr/XRButton.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const CANVAS_W = 3840;
const CANVAS_H = 1080;
const PANEL_RADIUS = 1.6;
const PANEL_HEIGHT = 0.9;
const PANEL_ARC = Math.PI * 0.8;
const PANEL_SEGMENTS = 64;
const PANEL_CENTER_Y = 1.3;

const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 10000;

// ============================================================================
// DEBUG
// ============================================================================

const _dbg: string[] = [];
function dbg(msg: string) { _dbg.push(msg); console.log("[VR]", msg); }
if (typeof window !== "undefined") (window as unknown as Record<string, unknown>).__vrDbg = _dbg;

// ============================================================================
// HELPERS
// ============================================================================

function drawPlaceholder(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(13, 17, 23, 0.8)";
  ctx.font = "bold 48px system-ui, monospace";
  ctx.textAlign = "center";
  ctx.fillText("Connecting to desktop…", canvas.width / 2, canvas.height / 2);
  ctx.textAlign = "start";
}

function getWsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function VRShell(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Three.js scene ──────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local-floor");
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.left = "0";
    renderer.domElement.style.zIndex = "0";
    container.appendChild(renderer.domElement);

    // ── Controllers with visible rays ───────────────────────────────────
    const controller1 = renderer.xr.getController(0);
    const controller2 = renderer.xr.getController(1);
    scene.add(controller1);
    scene.add(controller2);

    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -3),
    ]);
    const rayMat = new THREE.LineBasicMaterial({ color: 0x4a6cf7 });
    controller1.add(new THREE.Line(rayGeo, rayMat));
    controller2.add(new THREE.Line(rayGeo.clone(), rayMat));

    // ── Raycaster for panel interaction ─────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const tempMatrix = new THREE.Matrix4();

    // ── Desktop panel ───────────────────────────────────────────────────
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    drawPlaceholder(canvas);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const thetaStart = Math.PI - PANEL_ARC / 2;
    const geometry = new THREE.CylinderGeometry(
      PANEL_RADIUS, PANEL_RADIUS, PANEL_HEIGHT,
      PANEL_SEGMENTS, 1, true, thetaStart, PANEL_ARC,
    );

    // Flip UVs horizontally — inside face of cylinder has mirrored UVs
    const uvAttr = geometry.attributes.uv;
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setX(i, 1 - uvAttr.getX(i));
    }
    uvAttr.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, PANEL_CENTER_Y, 0);
    scene.add(mesh);

    // Force GPU upload before XR session starts (Quest texture timing bug)
    renderer.initTexture(texture);
    dbg("panel created, texture uploaded");

    // ── Cursor dot ──────────────────────────────────────────────────────
    const cursorGeo = new THREE.CircleGeometry(0.008, 16);
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0x4a6cf7, depthTest: false });
    const cursor = new THREE.Mesh(cursorGeo, cursorMat);
    cursor.visible = false;
    cursor.renderOrder = 999;
    scene.add(cursor);

    // ── Raycast helper ──────────────────────────────────────────────────
    function raycastPanel(controller: THREE.Group): { x: number; y: number } | null {
      tempMatrix.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

      const hits = raycaster.intersectObject(mesh);
      if (hits.length === 0 || !hits[0].uv) return null;

      return {
        x: Math.round(hits[0].uv.x * CANVAS_W),
        y: Math.round((1 - hits[0].uv.y) * CANVAS_H),
      };
    }

    function wsSend(msg: Record<string, unknown>) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    }

    // Controller click → forward to Chrome
    function onSelect(ev: { target: THREE.Group }) {
      const hit = raycastPanel(ev.target as THREE.Group);
      if (hit) {
        dbg(`click at (${hit.x}, ${hit.y})`);
        wsSend({ type: "click", x: hit.x, y: hit.y });
      }
    }
    controller1.addEventListener("select", onSelect as unknown as (ev: THREE.Event) => void);
    controller2.addEventListener("select", onSelect as unknown as (ev: THREE.Event) => void);

    // ── XR Button ───────────────────────────────────────────────────────
    const xrButton = XRButton.createButton(renderer, {
      requiredFeatures: ["local-floor"],
      optionalFeatures: ["hand-tracking"],
    });
    xrButton.style.cssText = `
      position: relative;
      padding: 16px 32px;
      font-size: 18px;
      font-weight: bold;
      color: #fff;
      background: #4a6cf7;
      border: none;
      border-radius: 12px;
      cursor: pointer;
    `;
    const slot = container.querySelector("#xr-button-slot");
    if (slot) {
      slot.appendChild(xrButton);
    } else {
      dbg("WARN: #xr-button-slot not found, appending to container");
      container.appendChild(xrButton);
    }

    // ── Screencast WebSocket (with reconnect) ───────────────────────────
    let ws: WebSocket | null = null;
    let wsReconnectDelay = WS_RECONNECT_BASE_MS;
    let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const ctx = canvas.getContext("2d")!;
    let decodingFrame = false;

    function connectWs() {
      if (disposed) return;
      const url = getWsUrl("/ws/screencast");
      dbg(`WS connecting to ${url}`);
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        dbg("WS connected");
        wsReconnectDelay = WS_RECONNECT_BASE_MS;
      };

      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer) || decodingFrame) return;
        decodingFrame = true;
        const blob = new Blob([ev.data], { type: "image/png" });
        createImageBitmap(blob).then((bmp) => {
          ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
          ctx.drawImage(bmp, 0, 0, CANVAS_W, CANVAS_H);
          texture.needsUpdate = true;
          bmp.close();
          decodingFrame = false;
        }).catch(() => { decodingFrame = false; });
      };

      ws.onclose = () => {
        dbg(`WS closed, reconnecting in ${wsReconnectDelay}ms`);
        ws = null;
        if (!disposed) {
          wsReconnectTimer = setTimeout(connectWs, wsReconnectDelay);
          wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_RECONNECT_MAX_MS);
        }
      };

      ws.onerror = () => {
        dbg("WS error");
        ws?.close();
      };
    }

    connectWs();

    // ── Microphone capture → audio WebSocket ────────────────────────────
    let audioWs: WebSocket | null = null;
    let mediaRecorder: MediaRecorder | null = null;
    let micStarted = false;

    async function startMic() {
      if (micStarted) {
        dbg("startMic called again, skipping (already started)");
        return;
      }
      micStarted = true;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        dbg("Mic access granted");

        // If cleanup ran while we were awaiting mic permission, abort
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const audioUrl = getWsUrl("/ws/audio?role=producer");
        audioWs = new WebSocket(audioUrl);
        audioWs.binaryType = "arraybuffer";

        audioWs.onopen = () => {
          dbg("Audio WS connected");
          mediaRecorder = new MediaRecorder(stream, {
            mimeType: "audio/webm;codecs=opus",
            audioBitsPerSecond: 64000,
          });
          let chunkCount = 0;
          mediaRecorder.ondataavailable = (ev) => {
            if (ev.data.size > 0 && audioWs?.readyState === WebSocket.OPEN) {
              chunkCount++;
              if (chunkCount <= 5 || chunkCount % 50 === 0) {
                dbg(`[audio-timing] chunk #${chunkCount} size=${ev.data.size} t=${Date.now()}`);
              }
              ev.data.arrayBuffer().then((buf) => audioWs!.send(buf));
            }
          };
          mediaRecorder.start(100);
          dbg(`MediaRecorder started t=${Date.now()}`);
        };

        audioWs.onclose = () => { dbg("Audio WS closed"); };
        audioWs.onerror = () => { dbg("Audio WS error"); };
      } catch (err) {
        dbg(`Mic error: ${err}`);
      }
    }

    startMic();

    // ── Render loop ─────────────────────────────────────────────────────
    let lastMoveX = -1;
    let lastMoveY = -1;
    let moveThrottle = 0;

    renderer.setAnimationLoop((_time, frame) => {
      if (frame) {
        let cursorVisible = false;
        for (const ctrl of [controller1, controller2]) {
          tempMatrix.identity().extractRotation(ctrl.matrixWorld);
          raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
          raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
          const hits = raycaster.intersectObject(mesh);
          if (hits.length > 0) {
            cursor.position.copy(hits[0].point);
            cursor.position.addScaledVector(hits[0].face!.normal, 0.002);
            cursor.lookAt(
              cursor.position.x + hits[0].face!.normal.x,
              cursor.position.y + hits[0].face!.normal.y,
              cursor.position.z + hits[0].face!.normal.z,
            );
            cursorVisible = true;

            if (hits[0].uv) {
              const px = Math.round(hits[0].uv.x * CANVAS_W);
              const py = Math.round((1 - hits[0].uv.y) * CANVAS_H);
              moveThrottle++;
              if (moveThrottle % 4 === 0 && (px !== lastMoveX || py !== lastMoveY)) {
                lastMoveX = px;
                lastMoveY = py;
                wsSend({ type: "mousemove", x: px, y: py });
              }
            }
            break;
          }
        }
        cursor.visible = cursorVisible;
      }

      renderer.render(scene, camera);
    });

    // ── Resize ──────────────────────────────────────────────────────────
    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener("resize", onResize);

    // ── Cleanup ─────────────────────────────────────────────────────────
    return () => {
      disposed = true;
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      ws?.close();
      mediaRecorder?.stop();
      audioWs?.close();
      window.removeEventListener("resize", onResize);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      xrButton.remove();
      texture.dispose();
      material.dispose();
      geometry.dispose();
      cursorGeo.dispose();
      cursorMat.dispose();
      controller1.removeEventListener("select", onSelect as unknown as (ev: THREE.Event) => void);
      controller2.removeEventListener("select", onSelect as unknown as (ev: THREE.Event) => void);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100vw", height: "100vh", position: "fixed", top: 0, left: 0, background: "#111" }}>
      <div style={{
        position: "absolute",
        top: 0, left: 0, width: "100%", height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "16px",
        zIndex: 10,
        pointerEvents: "none",
      }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", color: "#fff" }}>VR Desktop Stream</h1>
        <p style={{ color: "#888", fontSize: "14px" }}>
          Open this page on your Quest, then tap the button below.
        </p>
        <div id="xr-button-slot" style={{ pointerEvents: "auto" }} />
      </div>
    </div>
  );
}
