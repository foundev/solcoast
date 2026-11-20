import * as THREE from 'three';
import type { VehicleBodyStyle } from './vehicle';

interface LoftStation {
  z: number; // -2.45 (front nose) .. +2.45 (rear tail)
  halfWidthBottom: number;
  halfWidthMid: number;
  halfWidthTop: number;
  yBottom: number;
  yMid: number;
  yTop: number;
  crownHeight: number; // convex hood/roof dome height at centerline
}

/**
 * Generates a true 3D multi-station lofted automotive mesh with real plan-view taper
 * (narrower nose & tail, wider muscular fenders, tucked waist), curved hood/deck crown,
 * and sloped tumblehome sides — avoiding flat cookie-cutter extrusions!
 */
function buildLoftedShell(stations: LoftStation[]): THREE.BufferGeometry {
  // 14 points around a symmetric closed cross-section (bottom-center -> right -> top-center -> left -> bottom-center)
  const ringProfile = (st: LoftStation): [number, number][] => {
    const wb = st.halfWidthBottom;
    const wm = st.halfWidthMid;
    const wt = st.halfWidthTop;
    const yb = st.yBottom;
    const ym = st.yMid;
    const yt = st.yTop;
    const yc = yt + st.crownHeight;

    return [
      [0, yb],
      [wb * 0.72, yb],
      [wb, yb + (ym - yb) * 0.16],
      [wm, ym],
      [wm * 0.99, ym + (yt - ym) * 0.52],
      [wt, yt],
      [wt * 0.55, yt + st.crownHeight * 0.76],
      [0, yc],
      [-wt * 0.55, yt + st.crownHeight * 0.76],
      [-wt, yt],
      [-wm * 0.99, ym + (yt - ym) * 0.52],
      [-wm, ym],
      [-wb, yb + (ym - yb) * 0.16],
      [-wb * 0.72, yb],
    ];
  };

  const ringLen = 14;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    const pts = ringProfile(st);
    const vCoord = s / (stations.length - 1);
    for (let r = 0; r < ringLen; r++) {
      positions.push(pts[r][0], pts[r][1], st.z);
      uvs.push(r / ringLen, vCoord);
    }
  }

  // Connect adjacent rings with clean quad triangulation
  for (let s = 0; s < stations.length - 1; s++) {
    const rowA = s * ringLen;
    const rowB = (s + 1) * ringLen;
    for (let r = 0; r < ringLen; r++) {
      const rNext = (r + 1) % ringLen;
      const a = rowA + r;
      const b = rowA + rNext;
      const c = rowB + rNext;
      const d = rowB + r;
      indices.push(a, d, c);
      indices.push(a, c, b);
    }
  }

  // Cap front & rear ends with center vertices
  const addCap = (stationIdx: number, flip: boolean) => {
    const st = stations[stationIdx];
    const centerIdx = positions.length / 3;
    const cy = (st.yBottom + st.yTop) * 0.5;
    positions.push(0, cy, st.z);
    uvs.push(0.5, 0.5);
    const row = stationIdx * ringLen;
    for (let r = 0; r < ringLen; r++) {
      const rNext = (r + 1) % ringLen;
      if (flip) {
        indices.push(centerIdx, row + rNext, row + r);
      } else {
        indices.push(centerIdx, row + r, row + rNext);
      }
    }
  };

  addCap(0, false);
  addCap(stations.length - 1, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createSculptedCarBodyGeometry(style: VehicleBodyStyle): THREE.BufferGeometry {
  if (style === 'sedan') {
    return buildLoftedShell([
      { z: -2.42, halfWidthBottom: 0.72, halfWidthMid: 0.78, halfWidthTop: 0.66, yBottom: 0.28, yMid: 0.44, yTop: 0.58, crownHeight: 0.04 },
      { z: -2.18, halfWidthBottom: 0.88, halfWidthMid: 0.96, halfWidthTop: 0.86, yBottom: 0.25, yMid: 0.52, yTop: 0.74, crownHeight: 0.06 },
      { z: -1.45, halfWidthBottom: 0.94, halfWidthMid: 1.03, halfWidthTop: 0.92, yBottom: 0.26, yMid: 0.60, yTop: 0.86, crownHeight: 0.07 },
      { z: -0.75, halfWidthBottom: 0.92, halfWidthMid: 0.99, halfWidthTop: 0.90, yBottom: 0.26, yMid: 0.62, yTop: 0.93, crownHeight: 0.05 },
      { z: 0.35, halfWidthBottom: 0.92, halfWidthMid: 0.99, halfWidthTop: 0.90, yBottom: 0.26, yMid: 0.64, yTop: 0.95, crownHeight: 0.04 },
      { z: 1.42, halfWidthBottom: 0.94, halfWidthMid: 1.04, halfWidthTop: 0.91, yBottom: 0.28, yMid: 0.66, yTop: 0.97, crownHeight: 0.05 },
      { z: 2.15, halfWidthBottom: 0.86, halfWidthMid: 0.95, halfWidthTop: 0.84, yBottom: 0.32, yMid: 0.66, yTop: 0.92, crownHeight: 0.04 },
      { z: 2.40, halfWidthBottom: 0.74, halfWidthMid: 0.82, halfWidthTop: 0.72, yBottom: 0.36, yMid: 0.62, yTop: 0.82, crownHeight: 0.02 },
    ]);
  }

  if (style === 'spyder') {
    return buildLoftedShell([
      { z: -2.36, halfWidthBottom: 0.68, halfWidthMid: 0.76, halfWidthTop: 0.64, yBottom: 0.26, yMid: 0.42, yTop: 0.52, crownHeight: 0.04 },
      { z: -2.05, halfWidthBottom: 0.88, halfWidthMid: 0.98, halfWidthTop: 0.86, yBottom: 0.24, yMid: 0.50, yTop: 0.72, crownHeight: 0.07 },
      { z: -1.38, halfWidthBottom: 0.95, halfWidthMid: 1.05, halfWidthTop: 0.92, yBottom: 0.24, yMid: 0.56, yTop: 0.83, crownHeight: 0.06 },
      { z: -0.65, halfWidthBottom: 0.90, halfWidthMid: 0.97, halfWidthTop: 0.88, yBottom: 0.24, yMid: 0.56, yTop: 0.84, crownHeight: 0.03 },
      { z: 0.62, halfWidthBottom: 0.92, halfWidthMid: 1.00, halfWidthTop: 0.90, yBottom: 0.25, yMid: 0.58, yTop: 0.86, crownHeight: 0.03 },
      { z: 1.42, halfWidthBottom: 0.96, halfWidthMid: 1.07, halfWidthTop: 0.94, yBottom: 0.26, yMid: 0.62, yTop: 0.92, crownHeight: 0.05 },
      { z: 2.12, halfWidthBottom: 0.86, halfWidthMid: 0.96, halfWidthTop: 0.84, yBottom: 0.31, yMid: 0.62, yTop: 0.86, crownHeight: 0.04 },
      { z: 2.34, halfWidthBottom: 0.72, halfWidthMid: 0.82, halfWidthTop: 0.70, yBottom: 0.35, yMid: 0.58, yTop: 0.76, crownHeight: 0.02 },
    ]);
  }

  // Flagship mid-engine supercar / exotic widebody coupe (aggressive nose, pinched waist, wide rear haunches!)
  return buildLoftedShell([
    { z: -2.42, halfWidthBottom: 0.66, halfWidthMid: 0.76, halfWidthTop: 0.62, yBottom: 0.23, yMid: 0.38, yTop: 0.48, crownHeight: 0.04 },
    { z: -2.08, halfWidthBottom: 0.90, halfWidthMid: 1.01, halfWidthTop: 0.88, yBottom: 0.22, yMid: 0.48, yTop: 0.68, crownHeight: 0.06 },
    { z: -1.42, halfWidthBottom: 0.96, halfWidthMid: 1.07, halfWidthTop: 0.94, yBottom: 0.22, yMid: 0.54, yTop: 0.80, crownHeight: 0.06 },
    { z: -0.60, halfWidthBottom: 0.89, halfWidthMid: 0.96, halfWidthTop: 0.86, yBottom: 0.22, yMid: 0.54, yTop: 0.82, crownHeight: 0.04 },
    { z: 0.48, halfWidthBottom: 0.93, halfWidthMid: 1.02, halfWidthTop: 0.90, yBottom: 0.23, yMid: 0.58, yTop: 0.86, crownHeight: 0.04 },
    { z: 1.42, halfWidthBottom: 0.98, halfWidthMid: 1.11, halfWidthTop: 0.97, yBottom: 0.25, yMid: 0.64, yTop: 0.96, crownHeight: 0.06 },
    { z: 2.10, halfWidthBottom: 0.90, halfWidthMid: 1.00, halfWidthTop: 0.88, yBottom: 0.30, yMid: 0.64, yTop: 0.90, crownHeight: 0.04 },
    { z: 2.36, halfWidthBottom: 0.76, halfWidthMid: 0.86, halfWidthTop: 0.74, yBottom: 0.34, yMid: 0.60, yTop: 0.82, crownHeight: 0.02 },
  ]);
}

export function createSculptedCabinGeometry(style: VehicleBodyStyle): THREE.BufferGeometry {
  if (style === 'sedan') {
    return buildLoftedShell([
      { z: -1.06, halfWidthBottom: 0.82, halfWidthMid: 0.80, halfWidthTop: 0.72, yBottom: 0.88, yMid: 0.92, yTop: 0.96, crownHeight: 0.03 },
      { z: -0.35, halfWidthBottom: 0.84, halfWidthMid: 0.78, halfWidthTop: 0.66, yBottom: 0.90, yMid: 1.18, yTop: 1.38, crownHeight: 0.07 },
      { z: 0.55, halfWidthBottom: 0.84, halfWidthMid: 0.78, halfWidthTop: 0.65, yBottom: 0.92, yMid: 1.20, yTop: 1.40, crownHeight: 0.07 },
      { z: 1.24, halfWidthBottom: 0.82, halfWidthMid: 0.76, halfWidthTop: 0.62, yBottom: 0.94, yMid: 1.12, yTop: 1.24, crownHeight: 0.04 },
      { z: 1.72, halfWidthBottom: 0.78, halfWidthMid: 0.74, halfWidthTop: 0.62, yBottom: 0.94, yMid: 0.98, yTop: 1.01, crownHeight: 0.02 },
    ]);
  }

  // Low teardrop fighter-jet exotic glass canopy with strong inward tumblehome!
  return buildLoftedShell([
    { z: -1.05, halfWidthBottom: 0.78, halfWidthMid: 0.75, halfWidthTop: 0.66, yBottom: 0.78, yMid: 0.82, yTop: 0.85, crownHeight: 0.03 },
    { z: -0.25, halfWidthBottom: 0.81, halfWidthMid: 0.74, halfWidthTop: 0.59, yBottom: 0.80, yMid: 1.08, yTop: 1.26, crownHeight: 0.07 },
    { z: 0.52, halfWidthBottom: 0.82, halfWidthMid: 0.74, halfWidthTop: 0.58, yBottom: 0.82, yMid: 1.10, yTop: 1.26, crownHeight: 0.06 },
    { z: 1.18, halfWidthBottom: 0.78, halfWidthMid: 0.70, halfWidthTop: 0.54, yBottom: 0.86, yMid: 1.02, yTop: 1.10, crownHeight: 0.04 },
    { z: 1.74, halfWidthBottom: 0.70, halfWidthMid: 0.65, halfWidthTop: 0.52, yBottom: 0.90, yMid: 0.94, yTop: 0.96, crownHeight: 0.02 },
  ]);
}

export function createSculptedTrafficBodyGeometry(variant: 'sedan' | 'suv' | 'coupe'): {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
} {
  if (variant === 'suv') {
    return {
      body: buildLoftedShell([
        { z: -2.18, halfWidthBottom: 0.78, halfWidthMid: 0.85, halfWidthTop: 0.78, yBottom: 0.34, yMid: 0.60, yTop: 0.82, crownHeight: 0.05 },
        { z: -1.52, halfWidthBottom: 0.92, halfWidthMid: 0.99, halfWidthTop: 0.92, yBottom: 0.32, yMid: 0.66, yTop: 0.96, crownHeight: 0.05 },
        { z: 1.48, halfWidthBottom: 0.92, halfWidthMid: 0.99, halfWidthTop: 0.92, yBottom: 0.34, yMid: 0.68, yTop: 0.98, crownHeight: 0.05 },
        { z: 2.14, halfWidthBottom: 0.80, halfWidthMid: 0.88, halfWidthTop: 0.82, yBottom: 0.38, yMid: 0.68, yTop: 0.94, crownHeight: 0.03 },
      ]),
      cabin: buildLoftedShell([
        { z: -0.95, halfWidthBottom: 0.84, halfWidthMid: 0.80, halfWidthTop: 0.72, yBottom: 0.94, yMid: 1.00, yTop: 1.05, crownHeight: 0.03 },
        { z: -0.42, halfWidthBottom: 0.86, halfWidthMid: 0.80, halfWidthTop: 0.70, yBottom: 0.96, yMid: 1.34, yTop: 1.58, crownHeight: 0.06 },
        { z: 1.45, halfWidthBottom: 0.86, halfWidthMid: 0.80, halfWidthTop: 0.70, yBottom: 0.96, yMid: 1.34, yTop: 1.56, crownHeight: 0.05 },
        { z: 1.96, halfWidthBottom: 0.82, halfWidthMid: 0.78, halfWidthTop: 0.68, yBottom: 0.96, yMid: 1.12, yTop: 1.24, crownHeight: 0.03 },
      ]),
    };
  }

  return {
    body: buildLoftedShell([
      { z: -2.20, halfWidthBottom: 0.70, halfWidthMid: 0.78, halfWidthTop: 0.68, yBottom: 0.28, yMid: 0.45, yTop: 0.60, crownHeight: 0.04 },
      { z: -1.45, halfWidthBottom: 0.90, halfWidthMid: 0.97, halfWidthTop: 0.88, yBottom: 0.26, yMid: 0.56, yTop: 0.84, crownHeight: 0.05 },
      { z: 1.42, halfWidthBottom: 0.90, halfWidthMid: 0.98, halfWidthTop: 0.88, yBottom: 0.28, yMid: 0.62, yTop: 0.90, crownHeight: 0.04 },
      { z: 2.18, halfWidthBottom: 0.74, halfWidthMid: 0.82, halfWidthTop: 0.74, yBottom: 0.34, yMid: 0.58, yTop: 0.80, crownHeight: 0.02 },
    ]),
    cabin: buildLoftedShell([
      { z: -0.94, halfWidthBottom: 0.78, halfWidthMid: 0.76, halfWidthTop: 0.68, yBottom: 0.84, yMid: 0.88, yTop: 0.92, crownHeight: 0.02 },
      { z: -0.25, halfWidthBottom: 0.80, halfWidthMid: 0.74, halfWidthTop: 0.62, yBottom: 0.86, yMid: 1.14, yTop: 1.34, crownHeight: 0.06 },
      { z: 0.78, halfWidthBottom: 0.80, halfWidthMid: 0.74, halfWidthTop: 0.62, yBottom: 0.88, yMid: 1.14, yTop: 1.33, crownHeight: 0.05 },
      { z: 1.56, halfWidthBottom: 0.76, halfWidthMid: 0.72, halfWidthTop: 0.60, yBottom: 0.90, yMid: 0.96, yTop: 1.00, crownHeight: 0.02 },
    ]),
  };
}
