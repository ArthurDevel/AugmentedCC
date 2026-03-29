"use client";

import dynamic from "next/dynamic";

const VRShell = dynamic(() => import("./VRShell"), { ssr: false });

export default function Home() {
  return <VRShell />;
}
