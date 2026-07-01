import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
// Deep-import to avoid pulling in expo-three's index barrel, which re-exports
// loaders from `three/examples/jsm/loaders/<Name>` (extensionless). Modern
// three.js's `exports` field rejects those paths, and Metro logs a warning per
// loader. We only need `Renderer`, so bypass the barrel.
import Renderer from 'expo-three/build/Renderer';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import * as THREE from 'three';

import type { Component, EntityId, World } from '../../core/types';

export type Transform3DComponent = Component<{
  x: 'f32';
  y: 'f32';
  z: 'f32';
  rx: 'f32';
  ry: 'f32';
  rz: 'f32';
  sx: 'f32';
  sy: 'f32';
  sz: 'f32';
}>;

export type MeshComponent = Component<{ mesh: 'u32' }>;

export type CameraComponent = Component<{
  fov: 'f32';
  near: 'f32';
  far: 'f32';
  active: 'u8';
}>;

export type AmbientLightComponent = Component<{
  color: 'u32';
  intensity: 'f32';
}>;

export type DirectionalLightComponent = Component<{
  color: 'u32';
  intensity: 'f32';
}>;

export type PointLightComponent = Component<{
  color: 'u32';
  intensity: 'f32';
  distance: 'f32';
  decay: 'f32';
}>;

export interface MeshDef {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
}

export interface ThreeRendererProps {
  readonly world: World;
  readonly transform: Transform3DComponent;
  readonly mesh?: MeshComponent;
  readonly meshes?: ReadonlyArray<MeshDef>;
  readonly camera?: CameraComponent;
  readonly ambientLight?: AmbientLightComponent;
  readonly directionalLight?: DirectionalLightComponent;
  readonly pointLight?: PointLightComponent;
  readonly setupScene?: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void;
  readonly clearColor?: number | string;
}

interface LiveMesh {
  obj: THREE.Mesh;
  meshIdx: number;
}

interface LiveLight<L extends THREE.Light> {
  obj: L;
}

export function ThreeRenderer(props: ThreeRendererProps) {
  // Capture the latest props in a ref so the GL callback (which only fires
  // once on context creation) sees current values without re-running.
  const propsRef = useRef(props);
  propsRef.current = props;

  const cleanupRef = useRef<(() => void) | null>(null);

  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const initial = propsRef.current;
    const clearColor = initial.clearColor ?? 0x000000;

    const renderer = new Renderer({ gl, width, height });
    renderer.setClearColor(new THREE.Color(clearColor as THREE.ColorRepresentation));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    initial.setupScene?.(scene, camera);

    const liveMeshes = new Map<EntityId, LiveMesh>();
    const liveAmbient = new Map<EntityId, LiveLight<THREE.AmbientLight>>();
    const liveDirectional = new Map<EntityId, LiveLight<THREE.DirectionalLight>>();
    const livePoint = new Map<EntityId, LiveLight<THREE.PointLight>>();

    let rafId = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      rafId = requestAnimationFrame(tick);

      const p = propsRef.current;
      const w = p.world;
      const t = p.transform;
      const n = w.nextId;
      const alive = w.alive;
      const maskArr = w.mask;
      const tx = t.data.x as Float32Array;
      const ty = t.data.y as Float32Array;
      const tz = t.data.z as Float32Array;
      const rx = t.data.rx as Float32Array;
      const ry = t.data.ry as Float32Array;
      const rz = t.data.rz as Float32Array;
      const sx = t.data.sx as Float32Array;
      const sy = t.data.sy as Float32Array;
      const sz = t.data.sz as Float32Array;

      // 1. Camera reconciliation. The first alive entity carrying both
      //    Transform3D and Camera with `active === 1` wins. If none match,
      //    the default camera (configured in setupScene or the (0,0,5)
      //    factory default) is used as-is.
      const camComp = p.camera;
      if (camComp) {
        const required = t.bit | camComp.bit;
        const fov = camComp.data.fov as Float32Array;
        const near = camComp.data.near as Float32Array;
        const far = camComp.data.far as Float32Array;
        const activeArr = camComp.data.active as Uint8Array;
        for (let i = 0; i < n; i++) {
          if (
            alive[i] !== 1 ||
            (maskArr[i] & required) !== required ||
            activeArr[i] !== 1
          ) {
            continue;
          }
          camera.position.set(tx[i], ty[i], tz[i]);
          camera.rotation.set(rx[i], ry[i], rz[i]);
          if (
            camera.fov !== fov[i] ||
            camera.near !== near[i] ||
            camera.far !== far[i]
          ) {
            camera.fov = fov[i];
            camera.near = near[i];
            camera.far = far[i];
            camera.updateProjectionMatrix();
          }
          break;
        }
      }

      // 2. Mesh reconciliation.
      const meshComp = p.mesh;
      const meshDefs = p.meshes;
      if (meshComp && meshDefs) {
        const required = t.bit | meshComp.bit;
        const meshIdx = meshComp.data.mesh as Uint32Array;

        for (let i = 0; i < n; i++) {
          if (alive[i] !== 1 || (maskArr[i] & required) !== required) continue;
          const idx = meshIdx[i];
          const def = meshDefs[idx];
          let entry = liveMeshes.get(i);
          if (!def) {
            if (entry) {
              scene.remove(entry.obj);
              liveMeshes.delete(i);
            }
            continue;
          }
          if (!entry) {
            const obj = new THREE.Mesh(def.geometry, def.material);
            scene.add(obj);
            entry = { obj, meshIdx: idx };
            liveMeshes.set(i, entry);
          } else if (entry.meshIdx !== idx) {
            entry.obj.geometry = def.geometry;
            entry.obj.material = def.material;
            entry.meshIdx = idx;
          }
          entry.obj.position.set(tx[i], ty[i], tz[i]);
          entry.obj.rotation.set(rx[i], ry[i], rz[i]);
          entry.obj.scale.set(sx[i], sy[i], sz[i]);
        }

        liveMeshes.forEach((entry, id) => {
          if (alive[id] !== 1 || (maskArr[id] & required) !== required) {
            scene.remove(entry.obj);
            liveMeshes.delete(id);
          }
        });
      }

      // 3. Ambient light reconciliation. No transform required — ambient
      //    light is positionless.
      const ambComp = p.ambientLight;
      if (ambComp) {
        const required = ambComp.bit;
        const color = ambComp.data.color as Uint32Array;
        const intensity = ambComp.data.intensity as Float32Array;
        for (let i = 0; i < n; i++) {
          if (alive[i] !== 1 || (maskArr[i] & required) !== required) continue;
          let entry = liveAmbient.get(i);
          if (!entry) {
            const obj = new THREE.AmbientLight(color[i], intensity[i]);
            scene.add(obj);
            entry = { obj };
            liveAmbient.set(i, entry);
          } else {
            if (entry.obj.color.getHex() !== color[i]) entry.obj.color.setHex(color[i]);
            entry.obj.intensity = intensity[i];
          }
        }
        liveAmbient.forEach((entry, id) => {
          if (alive[id] !== 1 || (maskArr[id] & required) !== required) {
            scene.remove(entry.obj);
            liveAmbient.delete(id);
          }
        });
      }

      // 4. Directional light reconciliation. Position comes from Transform3D;
      //    the light points at its `target` (default the scene origin).
      const dirComp = p.directionalLight;
      if (dirComp) {
        const required = t.bit | dirComp.bit;
        const color = dirComp.data.color as Uint32Array;
        const intensity = dirComp.data.intensity as Float32Array;
        for (let i = 0; i < n; i++) {
          if (alive[i] !== 1 || (maskArr[i] & required) !== required) continue;
          let entry = liveDirectional.get(i);
          if (!entry) {
            const obj = new THREE.DirectionalLight(color[i], intensity[i]);
            scene.add(obj);
            entry = { obj };
            liveDirectional.set(i, entry);
          } else if (entry.obj.color.getHex() !== color[i]) {
            entry.obj.color.setHex(color[i]);
          }
          entry.obj.intensity = intensity[i];
          entry.obj.position.set(tx[i], ty[i], tz[i]);
        }
        liveDirectional.forEach((entry, id) => {
          if (alive[id] !== 1 || (maskArr[id] & required) !== required) {
            scene.remove(entry.obj);
            liveDirectional.delete(id);
          }
        });
      }

      // 5. Point light reconciliation. Position from Transform3D; distance/
      //    decay from the component.
      const pointComp = p.pointLight;
      if (pointComp) {
        const required = t.bit | pointComp.bit;
        const color = pointComp.data.color as Uint32Array;
        const intensity = pointComp.data.intensity as Float32Array;
        const distance = pointComp.data.distance as Float32Array;
        const decay = pointComp.data.decay as Float32Array;
        for (let i = 0; i < n; i++) {
          if (alive[i] !== 1 || (maskArr[i] & required) !== required) continue;
          let entry = livePoint.get(i);
          if (!entry) {
            const obj = new THREE.PointLight(color[i], intensity[i], distance[i], decay[i]);
            scene.add(obj);
            entry = { obj };
            livePoint.set(i, entry);
          } else if (entry.obj.color.getHex() !== color[i]) {
            entry.obj.color.setHex(color[i]);
          }
          entry.obj.intensity = intensity[i];
          entry.obj.distance = distance[i];
          entry.obj.decay = decay[i];
          entry.obj.position.set(tx[i], ty[i], tz[i]);
        }
        livePoint.forEach((entry, id) => {
          if (alive[id] !== 1 || (maskArr[id] & required) !== required) {
            scene.remove(entry.obj);
            livePoint.delete(id);
          }
        });
      }

      renderer.render(scene, camera);
      gl.endFrameEXP();
    };

    rafId = requestAnimationFrame(tick);

    cleanupRef.current = () => {
      stopped = true;
      if (rafId !== 0) cancelAnimationFrame(rafId);
      liveMeshes.forEach(({ obj }) => scene.remove(obj));
      liveMeshes.clear();
      liveAmbient.forEach(({ obj }) => scene.remove(obj));
      liveAmbient.clear();
      liveDirectional.forEach(({ obj }) => scene.remove(obj));
      liveDirectional.clear();
      livePoint.forEach(({ obj }) => scene.remove(obj));
      livePoint.clear();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return <GLView style={styles.canvas} onContextCreate={onContextCreate} />;
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
