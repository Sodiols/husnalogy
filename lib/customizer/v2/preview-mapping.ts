import type { PerspectivePoints } from "./mockups";

export type Point = { x: number; y: number };

function solveLinear(matrix: number[][], values: number[]): number[] | null {
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < matrix.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-10) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    rows[column] = rows[column].map((value) => value / divisor);
    for (let row = 0; row < rows.length; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      rows[row] = rows[row].map((value, index) => value - factor * rows[column][index]);
    }
  }
  return rows.map((row) => row[row.length - 1]);
}

export function homographyFromUnitSquare(points: PerspectivePoints): number[] | null {
  const source = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const target = [points.topLeft, points.topRight, points.bottomRight, points.bottomLeft];
  const a: number[][] = [];
  const b: number[] = [];
  source.forEach((point, index) => {
    const mapped = target[index];
    a.push([point.x, point.y, 1, 0, 0, 0, -point.x * mapped.x, -point.y * mapped.x]);
    b.push(mapped.x);
    a.push([0, 0, 0, point.x, point.y, 1, -point.x * mapped.y, -point.y * mapped.y]);
    b.push(mapped.y);
  });
  const solved = solveLinear(a, b);
  return solved ? [...solved, 1] : null;
}

export function invertHomography(matrix: number[]): number[] | null {
  if (matrix.length !== 9) return null;
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const D = c * h - b * i;
  const E = a * i - c * g;
  const F = b * g - a * h;
  const G = b * f - c * e;
  const H = c * d - a * f;
  const I = a * e - b * d;
  const determinant = a * A + b * B + c * C;
  if (Math.abs(determinant) < 1e-10) return null;
  return [A, D, G, B, E, H, C, F, I].map((value) => value / determinant);
}

export function applyHomography(matrix: number[], point: Point): Point | null {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(denominator) < 1e-10) return null;
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}

export function mapMockupPointToCanvas(point: Point, points: PerspectivePoints, canvasWidth: number, canvasHeight: number): Point | null {
  const forward = homographyFromUnitSquare(points);
  const inverse = forward && invertHomography(forward);
  const normalized = inverse && applyHomography(inverse, point);
  if (!normalized || normalized.x < 0 || normalized.x > 1 || normalized.y < 0 || normalized.y > 1) return null;
  return { x: normalized.x * canvasWidth, y: normalized.y * canvasHeight };
}

