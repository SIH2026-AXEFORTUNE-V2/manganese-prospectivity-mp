"use client";

// The globe centerpiece for the Explore lane. It's the cosmetic "where on Earth are we"
// view; the Globe/Map switch on the page flips between this and CommandMap (the real
// georeferenced belt map). This component is deliberately self-contained - it takes no
// data props, just renders the breathing-earth GLB and slowly spins it.
//
// The model (public/models/earth.glb) is the team's earth_breathing.glb with its twelve
// 2048x1024 PNG textures downscaled to 1024x512 JPEG (31 MB -> 2.7 MB) by
// scripts/shrink-earth.mjs. It carries one animation clip, "Earth breathing" (5s loop).
//
// Like CommandMap this only ever runs in the browser - the page loads it via
// next/dynamic with `ssr: false` because three.js touches `window`/WebGL on import.

import { Suspense, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { useGLTF, useAnimations, OrbitControls, Bounds } from "@react-three/drei";
import type { Group } from "three";

const MODEL_URL = "/models/earth.glb";

function Earth() {
  const group = useRef<Group>(null);
  const { scene, animations } = useGLTF(MODEL_URL);
  const { actions } = useAnimations(animations, group);

  // Play every clip the model ships with (there's just the one, "Earth breathing").
  useEffect(() => {
    for (const action of Object.values(actions)) action?.reset().play();
  }, [actions]);

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);

export default function EarthGlobe() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3], fov: 45 }}
      style={{ width: "100%", height: "100%" }}
      gl={{ antialias: true }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 3, 5]} intensity={1.6} />
      <directionalLight position={[-6, -2, -4]} intensity={0.35} color="#c8ff3d" />
      <Suspense fallback={null}>
        {/* Bounds auto-frames the model so we don't have to guess its radius; the
            margin leaves breathing room so it reads as a globe, not a backdrop. */}
        <Bounds fit clip observe margin={1.6}>
          <Earth />
        </Bounds>
      </Suspense>
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        autoRotate
        autoRotateSpeed={0.5}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={(2 * Math.PI) / 3}
      />
    </Canvas>
  );
}
