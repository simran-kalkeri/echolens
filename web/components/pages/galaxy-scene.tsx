"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import type { GalaxyResponse } from "@/lib/types";
import { clusterColor, sentimentScale } from "@/lib/colors";
import { prefersReducedMotion } from "@/components/common/motion";

export type GalaxyColorMode = "cluster" | "sentiment";

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();
const DIM = new THREE.Color("#1c1f25");
const TARGET_RADIUS = 14; // world units the cloud is scaled to, whatever the UMAP output range

/** Centre the cloud and scale it so 98% of points fall within TARGET_RADIUS. */
function normalise(data: GalaxyResponse): GalaxyResponse {
  const n = data.points.length;
  if (!n) return data;
  let cx = 0, cy = 0, cz = 0;
  for (const p of data.points) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= n; cy /= n; cz /= n;
  const d = data.points.map((p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz)).sort((a, b) => a - b);
  const r = d[Math.floor(0.98 * (n - 1))] || 1;
  const k = TARGET_RADIUS / r;
  return {
    ...data,
    points: data.points.map((p) => ({ ...p, x: (p.x - cx) * k, y: (p.y - cy) * k, z: (p.z - cz) * k })),
    clusters: data.clusters.map((c) => ({
      ...c,
      centroid: [(c.centroid[0] - cx) * k, (c.centroid[1] - cy) * k, (c.centroid[2] - cz) * k] as typeof c.centroid,
    })),
  };
}


function Points({
  data,
  mode,
  focus,
  onHover,
}: {
  data: GalaxyResponse;
  mode: GalaxyColorMode;
  focus: number | null;
  onHover: (i: number | null) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = data.points.length;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    data.points.forEach((p, i) => {
      const dim = focus !== null && p.cluster !== focus;
      const s = dim ? 0.55 : p.cluster < 0 ? 0.7 : 1;
      tmpObj.position.set(p.x, p.y, p.z);
      tmpObj.scale.setScalar(s);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);
      if (dim) tmpColor.copy(DIM);
      else tmpColor.set(mode === "cluster" ? clusterColor(p.cluster) : sentimentScale(p.sentiment * 1.2));
      mesh.setColorAt(i, tmpColor);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [data, mode, focus]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, count]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId != null) onHover(e.instanceId);
      }}
      onPointerOut={() => onHover(null)}
    >
      <icosahedronGeometry args={[0.07, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

function IntroCamera() {
  const { camera } = useThree();
  useEffect(() => {
    const target = { x: 0, y: 7, z: 30 };
    if (prefersReducedMotion()) {
      camera.position.set(target.x, target.y, target.z);
      return;
    }
    camera.position.set(0, 26, 60);
    const t = gsap.to(camera.position, { ...target, duration: 2.2, ease: "power3.out", onUpdate: () => camera.lookAt(0, 0, 0) });
    return () => {
      t.kill();
    };
  }, [camera]);
  return null;
}

function Halo() {
  // faint orbital rings for spatial reference
  const ref = useRef<THREE.Group>(null);
  useFrame((_, d) => {
    if (ref.current && !prefersReducedMotion()) ref.current.rotation.y += d * 0.01;
  });
  return (
    <group ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      {[7, 12, 17].map((r) => (
        <mesh key={r}>
          <ringGeometry args={[r, r + 0.012, 128]} />
          <meshBasicMaterial color="#2a2e36" transparent opacity={0.55} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

const tmpV = new THREE.Vector3();

/**
 * Projects 3D anchors to screen space every frame and moves plain DOM nodes there.
 * (Replaces drei <Html>, which mounts one React root per label and races React 19's unmount.)
 */
function Projector({
  anchors,
  nodes,
  hoverPos,
  tip,
}: {
  anchors: [number, number, number][];
  nodes: React.MutableRefObject<(HTMLElement | null)[]>;
  hoverPos: React.MutableRefObject<[number, number, number] | null>;
  tip: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const { camera, size } = useThree();
  useFrame(() => {
    const place = (el: HTMLElement | null, p: [number, number, number] | null) => {
      if (!el) return;
      if (!p) {
        el.style.visibility = "hidden";
        return;
      }
      tmpV.set(p[0], p[1], p[2]).project(camera);
      const behind = tmpV.z > 1 || Math.abs(tmpV.x) > 1.2 || Math.abs(tmpV.y) > 1.2;
      el.style.visibility = behind ? "hidden" : "visible";
      el.style.transform = `translate3d(${((tmpV.x + 1) / 2) * size.width}px, ${((1 - tmpV.y) / 2) * size.height}px, 0)`;
    };
    anchors.forEach((a, i) => place(nodes.current[i], a));
    place(tip.current, hoverPos.current);
  });
  return null;
}

export function GalaxyScene({
  data: raw,
  mode,
  focus,
  onFocus,
  showLabels,
}: {
  data: GalaxyResponse;
  mode: GalaxyColorMode;
  focus: number | null;
  onFocus: (c: number | null) => void;
  showLabels: boolean;
}) {
  const data = useMemo(() => normalise(raw), [raw]);
  const [hover, setHover] = useState<number | null>(null);
  const [interacting, setInteracting] = useState(false);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const hp = hover != null ? data.points[hover] : null;
  const hcluster = hp ? data.clusters.find((c) => c.id === hp.cluster) : null;

  const labelNodes = useRef<(HTMLElement | null)[]>([]);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const hoverPos = useRef<[number, number, number] | null>(null);
  hoverPos.current = hp ? [hp.x, hp.y, hp.z] : null;
  // label only the largest clusters (plus the focused one) so the scene stays readable
  const labelled = useMemo(() => {
    if (!showLabels) return [];
    const top = new Set([...data.clusters].sort((a, b) => b.count - a.count).slice(0, 12).map((c) => c.id));
    return data.clusters.filter((c) => top.has(c.id) || c.id === focus);
  }, [data, showLabels, focus]);
  labelNodes.current.length = labelled.length;
  const anchors = useMemo(() => labelled.map((c) => c.centroid as [number, number, number]), [labelled]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 7, 30], fov: 50, near: 0.05, far: 300 }}
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={() => onFocus(null)}
        style={{ cursor: hover != null ? "pointer" : "grab" }}
      >
        <IntroCamera />
        <Halo />
        <Points data={data} mode={mode} focus={focus} onHover={setHover} />
        <Projector anchors={anchors} nodes={labelNodes} hoverPos={hoverPos} tip={tipRef} />
        <OrbitControls
          enablePan
          screenSpacePanning
          enableDamping
          dampingFactor={0.08}
          minDistance={1.5}
          maxDistance={70}
          zoomSpeed={1.2}
          autoRotate={!reduced && !interacting && hover == null}
          autoRotateSpeed={0.35}
          onStart={() => setInteracting(true)}
          onEnd={() => setTimeout(() => setInteracting(false), 2500)}
        />
      </Canvas>
      <div className="pointer-events-none absolute inset-0">
        {labelled.map((c, i) => {
            const active = focus === null || focus === c.id;
            return (
              <div
                key={c.id}
                ref={(el) => {
                  labelNodes.current[i] = el;
                }}
                className="absolute top-0 left-0"
                style={{ visibility: "hidden", zIndex: focus === c.id ? 2 : 1 }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onFocus(focus === c.id ? null : c.id);
                  }}
                  className="pointer-events-auto flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm transition-opacity select-none"
                  style={{
                    borderColor: focus === c.id ? clusterColor(c.id) : "rgba(44,47,54,0.9)",
                    background: "rgba(16,17,20,0.78)",
                    color: "#e8e9ec",
                    opacity: active ? 1 : 0.25,
                  }}
                >
                  <span className="size-1.5 rounded-full" style={{ background: clusterColor(c.id) }} />
                  {c.name}
                </button>
              </div>
            );
          })}
        <div ref={tipRef} className="absolute top-0 left-0 z-10" style={{ visibility: "hidden" }}>
          <div
            className="ml-3 w-64 -translate-y-1/2 rounded-lg border border-[#2c2f36] bg-[#15171b]/95 p-2.5 text-xs shadow-xl shadow-black/50 transition-opacity duration-100"
            style={{ opacity: hp ? 1 : 0 }}
          >
            {hp && (
              <>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] text-[#a1a4ad]">
                  <span className="size-1.5 rounded-full" style={{ background: clusterColor(hp.cluster) }} />
                  <span className="truncate">{hcluster?.name ?? "Unclustered (noise)"}</span>
                  <span className="ml-auto tabular-nums" style={{ color: sentimentScale(hp.sentiment * 1.2) }}>
                    {hp.sentiment > 0 ? "+" : ""}
                    {hp.sentiment.toFixed(2)}
                  </span>
                </div>
                <p className="line-clamp-4 leading-[18px] text-[#e8e9ec]">{hp.text}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
