import type { AABB, OBB2D } from './math';

const STATIC_CELL_SIZE = 32;
const STATIC_INV_CELL = 1 / STATIC_CELL_SIZE;

function cellKey(cx: number, cz: number): number {
  // Supports cell coords in [-32768..32767] without string allocation!
  return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
}

interface StaticGrid<T> {
  length: number;
  cells: Map<number, T[]>;
  stamp: Uint32Array;
  items: readonly T[];
  itemIndex: Map<T, number>;
  queryId: number;
}

const aabbGridCache = new WeakMap<readonly AABB[], StaticGrid<AABB>>();
const obbGridCache = new WeakMap<readonly OBB2D[], StaticGrid<OBB2D>>();

function buildAabbGrid(items: readonly AABB[]): StaticGrid<AABB> {
  const cells = new Map<number, AABB[]>();
  const itemIndex = new Map<AABB, number>();
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    itemIndex.set(b, i);
    const minCx = Math.floor(b.minX * STATIC_INV_CELL);
    const maxCx = Math.floor(b.maxX * STATIC_INV_CELL);
    const minCz = Math.floor(b.minZ * STATIC_INV_CELL);
    const maxCz = Math.floor(b.maxZ * STATIC_INV_CELL);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const k = cellKey(cx, cz);
        let bucket = cells.get(k);
        if (!bucket) {
          bucket = [];
          cells.set(k, bucket);
        }
        bucket.push(b);
      }
    }
  }
  return { length: items.length, cells, stamp: new Uint32Array(items.length), items, itemIndex, queryId: 0 };
}

function buildObbGrid(items: readonly OBB2D[]): StaticGrid<OBB2D> {
  const cells = new Map<number, OBB2D[]>();
  const itemIndex = new Map<OBB2D, number>();
  for (let i = 0; i < items.length; i++) {
    const o = items[i];
    itemIndex.set(o, i);
    const r = Math.hypot(o.halfW, o.halfD);
    const minCx = Math.floor((o.cx - r) * STATIC_INV_CELL);
    const maxCx = Math.floor((o.cx + r) * STATIC_INV_CELL);
    const minCz = Math.floor((o.cz - r) * STATIC_INV_CELL);
    const maxCz = Math.floor((o.cz + r) * STATIC_INV_CELL);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const k = cellKey(cx, cz);
        let bucket = cells.get(k);
        if (!bucket) {
          bucket = [];
          cells.set(k, bucket);
        }
        bucket.push(o);
      }
    }
  }
  return { length: items.length, cells, stamp: new Uint32Array(items.length), items, itemIndex, queryId: 0 };
}

/**
 * Visits every AABB in `colliders` whose spatial-grid cells overlap `[x - radius, x + radius] x [z - radius, z + radius]`.
 * Automatically caches a uniform 2D grid per array instance via WeakMap for O(1) lookups with zero caller API changes.
 */
export function forEachNearbyAABB(
  colliders: readonly AABB[],
  x: number,
  z: number,
  radius: number,
  visitor: (box: AABB) => void,
): void {
  const len = colliders.length;
  if (len === 0) return;
  if (len <= 16) {
    for (let i = 0; i < len; i++) visitor(colliders[i]);
    return;
  }
  let grid = aabbGridCache.get(colliders);
  if (!grid || grid.length !== len) {
    grid = buildAabbGrid(colliders);
    aabbGridCache.set(colliders, grid);
  }
  const minCx = Math.floor((x - radius) * STATIC_INV_CELL);
  const maxCx = Math.floor((x + radius) * STATIC_INV_CELL);
  const minCz = Math.floor((z - radius) * STATIC_INV_CELL);
  const maxCz = Math.floor((z + radius) * STATIC_INV_CELL);

  // Fast path: single cell (common case!) requires no dedup stamp check
  if (minCx === maxCx && minCz === maxCz) {
    const bucket = grid.cells.get(cellKey(minCx, minCz));
    if (!bucket) return;
    for (let i = 0; i < bucket.length; i++) visitor(bucket[i]);
    return;
  }

  let qid = ++grid.queryId;
  if (qid === 0xffffffff) {
    grid.stamp.fill(0);
    grid.queryId = qid = 1;
  }
  const stamp = grid.stamp;
  const itemIndex = grid.itemIndex;
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const bucket = grid.cells.get(cellKey(cx, cz));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const box = bucket[i];
        const idx = itemIndex.get(box)!;
        if (stamp[idx] === qid) continue;
        stamp[idx] = qid;
        visitor(box);
      }
    }
  }
}

/**
 * Visits every OBB2D in `obbs` whose spatial-grid cells overlap `[x - radius, x + radius] x [z - radius, z + radius]`.
 */
export function forEachNearbyOBB(
  obbs: readonly OBB2D[],
  x: number,
  z: number,
  radius: number,
  visitor: (obb: OBB2D) => void,
): void {
  const len = obbs.length;
  if (len === 0) return;
  if (len <= 16) {
    for (let i = 0; i < len; i++) visitor(obbs[i]);
    return;
  }
  let grid = obbGridCache.get(obbs);
  if (!grid || grid.length !== len) {
    grid = buildObbGrid(obbs);
    obbGridCache.set(obbs, grid);
  }
  const minCx = Math.floor((x - radius) * STATIC_INV_CELL);
  const maxCx = Math.floor((x + radius) * STATIC_INV_CELL);
  const minCz = Math.floor((z - radius) * STATIC_INV_CELL);
  const maxCz = Math.floor((z + radius) * STATIC_INV_CELL);

  if (minCx === maxCx && minCz === maxCz) {
    const bucket = grid.cells.get(cellKey(minCx, minCz));
    if (!bucket) return;
    for (let i = 0; i < bucket.length; i++) visitor(bucket[i]);
    return;
  }

  let qid = ++grid.queryId;
  if (qid === 0xffffffff) {
    grid.stamp.fill(0);
    grid.queryId = qid = 1;
  }
  const stamp = grid.stamp;
  const itemIndex = grid.itemIndex;
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const bucket = grid.cells.get(cellKey(cx, cz));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const obb = bucket[i];
        const idx = itemIndex.get(obb)!;
        if (stamp[idx] === qid) continue;
        stamp[idx] = qid;
        visitor(obb);
      }
    }
  }
}

/**
 * Reusable zero-allocation linked-list spatial hash for dynamic point entities (pedestrians, traffic cars).
 * Rebuilt in O(N) at the start of a tick using pre-allocated typed arrays!
 */
export class DynamicPointGrid {
  private readonly invCell: number;
  private readonly tableMask: number;
  private readonly heads: Int32Array;
  private next: Int32Array;
  private cellX: Int32Array;
  private cellZ: Int32Array;

  constructor(cellSize: number, initialCapacity = 256, tableSize = 1024) {
    this.invCell = 1 / cellSize;
    this.tableMask = tableSize - 1;
    this.heads = new Int32Array(tableSize);
    this.next = new Int32Array(initialCapacity);
    this.cellX = new Int32Array(initialCapacity);
    this.cellZ = new Int32Array(initialCapacity);
  }

  private hash(cx: number, cz: number): number {
    return ((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & this.tableMask);
  }

  public rebuild(items: readonly { x: number; z: number }[]): void {
    const n = items.length;
    if (this.next.length < n) {
      this.next = new Int32Array(n);
      this.cellX = new Int32Array(n);
      this.cellZ = new Int32Array(n);
    }
    this.heads.fill(-1);
    const inv = this.invCell;
    const heads = this.heads;
    const next = this.next;
    const cellX = this.cellX;
    const cellZ = this.cellZ;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const cx = Math.floor(it.x * inv);
      const cz = Math.floor(it.z * inv);
      cellX[i] = cx;
      cellZ[i] = cz;
      const h = this.hash(cx, cz);
      next[i] = heads[h];
      heads[h] = i;
    }
  }

  public forEachIndexInRadius(
    x: number,
    z: number,
    radius: number,
    visitor: (index: number) => boolean | void,
  ): void {
    const inv = this.invCell;
    const minCx = Math.floor((x - radius) * inv);
    const maxCx = Math.floor((x + radius) * inv);
    const minCz = Math.floor((z - radius) * inv);
    const maxCz = Math.floor((z + radius) * inv);
    const heads = this.heads;
    const next = this.next;
    const cellX = this.cellX;
    const cellZ = this.cellZ;
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        let idx = heads[this.hash(cx, cz)];
        while (idx !== -1) {
          if (cellX[idx] === cx && cellZ[idx] === cz) {
            if (visitor(idx) === false) return;
          }
          idx = next[idx];
        }
      }
    }
  }
}
